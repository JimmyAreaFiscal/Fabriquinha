// Serviço, agendador e reinício (F4 §2, §3, §4, §4.1, §7) contra banco real; demandas e tickets vão direto em SQL,
// porque o que importa aqui é o estado em que o serviço os encontra.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, type TestContext, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { fabricaDeBancosTemporarios } from "../../apoio-testes/banco_temporario.ts";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { escrever, migrar, novoId } from "../armazenamento/banco.ts";
import { MIGRACOES } from "../armazenamento/migracoes.ts";
import { registrarProjeto } from "../aplicacao/projeto/cadastro.ts";
import { salvarConfiguracao } from "../armazenamento/servico.ts";
import { criarUsuarioSimulado } from "../armazenamento/simulacao.ts";
import { iniciarServico, portaDoServico } from "./servico.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
/** Uma raiz com o banco já migrado e desligado, para o serviço abrir. */
const novaRaiz = () => {
  const { raiz, banco } = abrirBancoTemporario();
  banco.close();
  return raiz;
};

const AGORA = "2026-10-11T12:00:00.000Z";

/** Cadastra o projeto `nome` no repositório `repo`. */
function projeto(banco: DatabaseSync, nome: string, repo: string): void {
  registrarProjeto(banco, {
    nome,
    raiz_git: repo,
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: nome,
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
}

/** Cada teste do serviço numa porta livre, para não esbarrar numa Fabriquinha de verdade. */
beforeEach(async () => {
  const s = createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  process.env.FABRIQUINHA_PORTA = String((s.address() as { port: number }).port);
  s.close();
  await once(s, "close");
});

const subir = (raiz = novaRaiz()) => iniciarServico(raiz);

/** A porta do teste está livre: dá para escutar nela. */
async function portaLivre(): Promise<void> {
  const s = createServer().listen(portaDoServico(), "127.0.0.1");
  await once(s, "listening");
  s.close();
  await once(s, "close");
}

/** Espera a execução em segundo plano chegar a `condicao`, com o relógio real (o falso só move o setInterval). */
async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; !condicao() && i < 500; i++) await dormir(10);
  assert.ok(condicao(), "a condição não chegou em 5 s");
}

/** Relógio falso para o setInterval do agendador; devolve a batida de um minuto. */
function relogio(t: TestContext): () => void {
  t.mock.timers.enable({ apis: ["setInterval"] });
  return () => {
    t.mock.timers.tick(60_000);
  };
}

test("porta: $FABRIQUINHA_PORTA, padrão 4317", () => {
  assert.equal(portaDoServico({}), 4317);
  assert.equal(portaDoServico({ FABRIQUINHA_PORTA: "" }), 4317);
  assert.equal(portaDoServico({ FABRIQUINHA_PORTA: "5000" }), 5000);
});

test("porta 0: o serviço escuta numa porta livre, e o web.url leva a escolhida", async () => {
  process.env.FABRIQUINHA_PORTA = "0";
  const raiz = novaRaiz();
  const s = await subir(raiz);
  const link = new URL(readFileSync(join(raiz, "web.url"), "utf8"));
  assert.notEqual(link.port, "0");
  assert.equal((await fetch(link, { redirect: "manual" })).status, 303, "o link de entrada responde nela");
  await s.parar();
});

test("instância única: a porta é a trava, e a segunda instância sai com erro antes de abrir o banco", async () => {
  const raiz = novaRaiz();
  const s = await subir(raiz);
  const porta = String(portaDoServico());
  assert.match(await (await fetch(`http://127.0.0.1:${porta}/home`)).text(), /^<!doctype html>/, "a porta serve o web");

  // A raiz da segunda nem existe: ela recusa pela porta sem chegar a criá-la nem a migrar o banco.
  const outraRaiz = join(raiz, "nunca-criada");
  await assert.rejects(
    iniciarServico(outraRaiz),
    (erro: unknown) =>
      erro instanceof ErroDeRegra &&
      erro.message.startsWith(`a Fabriquinha não conseguiu abrir 127.0.0.1:${porta}: listen EADDRINUSE`),
  );
  assert.equal(existsSync(outraRaiz), false);
  await assert.rejects(subir(raiz), ErroDeRegra);

  await s.parar();
  const outra = await subir(raiz); // parada a primeira, a porta fica livre
  await outra.parar();
});

test("subida que falha ao publicar web.url fecha o banco e libera a porta", async () => {
  const raiz = novaRaiz();
  mkdirSync(join(raiz, "web.url"));
  await assert.rejects(subir(raiz), /EISDIR/);
  await portaLivre();
});

test("parar apaga o web.url: o abrir diz que o serviço não está rodando em vez de abrir um link morto", async () => {
  const raiz = novaRaiz();
  const s = await subir(raiz);
  assert.equal(existsSync(join(raiz, "web.url")), true);
  await s.parar();
  assert.equal(existsSync(join(raiz, "web.url")), false);
});

test("reinício: o pi de uma avaliação da instância anterior é morto pelo grupo_processo dela", async () => {
  const { raiz, banco } = abrirBancoTemporario();
  const pi = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const saiu = once(pi, "exit");
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('d', '/nao/existe', 'main', 'github', 'k')`);
  banco
    .prepare(
      `INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em, grupo_processo)
       VALUES ('11111111-1111-4111-8111-111111111111', 'd', '2026-10-01', '2026-10-02', '', ?, ?)`,
    )
    .run(AGORA, pi.pid ?? null);
  banco.close();

  const s = await subir(raiz);
  assert.deepEqual(await saiu, [null, "SIGKILL"]);
  assert.equal(s.banco.prepare("SELECT grupo_processo FROM avaliacao").get()?.grupo_processo, null);
  await s.parar();
});

test("CA-12: reinício encerra a execução aberta da demanda como falha e leva o ticket a falhou, sem mexer no estado", async () => {
  const { raiz, banco } = abrirBancoTemporario();
  const pi = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const saiu = once(pi, "exit");
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('d', '/nao/existe', 'main', 'github', 'k');
    INSERT INTO demanda VALUES ('I-1', 'd', 't', 'funcionalidade', 'd', 'em_execucao', '${AGORA}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'em_execucao', '${AGORA}');
    INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 's1');`);
  banco
    .prepare(
      "INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha, grupo_processo) VALUES ('e1', 's1', ?, 0, ?)",
    )
    .run(AGORA, pi.pid ?? null);
  banco.close();

  const s = await subir(raiz);
  assert.deepEqual(await saiu, [null, "SIGKILL"]);
  assert.partialDeepStrictEqual(s.banco.prepare("SELECT * FROM processo_do_trabalho").get(), {
    falha: 1,
  });
  assert.notEqual(s.banco.prepare("SELECT fim FROM processo_do_trabalho").get()?.fim, null);
  assert.partialDeepStrictEqual(s.banco.prepare("SELECT * FROM ticket_demanda").get(), {
    etapa: "implementar",
    estado: "falhou",
  });
  assert.partialDeepStrictEqual(s.banco.prepare("SELECT * FROM tentativa").get(), {
    ticket_id: 1,
    resultado_tipo: "falha_infraestrutura",
    causa: "servico_reiniciado",
    motivo: "serviço reiniciado",
  });
  assert.equal(s.banco.prepare("SELECT estado FROM demanda").get()?.estado, "em_execucao");
  await s.parar();
});

test("reinício: as execuções simuladas pendentes falham e o pi delas é morto; as terminadas ficam", async () => {
  const { raiz, banco } = abrirBancoTemporario();
  projeto(banco, "sim", "/nao/existe");
  criarUsuarioSimulado(banco, "sim", { nome: "Dona Maria", descricao: "d" });
  banco.exec(`INSERT INTO tarefa (id, projeto, texto, n, criada_em) VALUES (1, 'sim', 't', 1, 'x');
    INSERT INTO tarefa_usuario VALUES (1, 1)`);
  const pi = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const saiu = once(pi, "exit");
  banco
    .prepare(
      `INSERT INTO execucao_simulada (id, tarefa, usuario, status, relatorio, pgid) VALUES
         (1, 1, 1, 'em_andamento', NULL, ?), (2, 1, 1, 'na_fila', NULL, NULL), (3, 1, 1, 'concluida', '{}', NULL)`,
    )
    .run(pi.pid ?? null);
  banco.close();

  const s = await subir(raiz);
  assert.deepEqual(await saiu, [null, "SIGKILL"]);
  assert.deepEqual(
    s.banco
      .prepare("SELECT id, status, erro, pgid FROM execucao_simulada ORDER BY id")
      .all()
      .map((l) => ({ ...l })),
    [
      { id: 1, status: "falhou", erro: "serviço reiniciado", pgid: null },
      { id: 2, status: "falhou", erro: "serviço reiniciado", pgid: null },
      { id: 3, status: "concluida", erro: null, pgid: null },
    ],
  );
  await s.parar();
});

/** O banco da `raiz` na versão 36 (a linha de base), com a I-1 registrada. */
function bancoComDemanda(raiz: string): DatabaseSync {
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  migrar(banco, MIGRACOES);
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/nao/existe', 'main', 'github', 'p');
    INSERT INTO sequencia (nome, valor) VALUES ('demanda', 1);`);
  return banco;
}

test("subida que falha ao abrir o banco ou ao migrar libera a porta; o banco anterior à v36 é rejeitado sem alteração", async () => {
  const arquivo = join(novaRaiz(), "raiz-que-e-arquivo");
  writeFileSync(arquivo, "");
  await assert.rejects(subir(arquivo), /EEXIST|ENOTDIR/);
  await portaLivre();

  const raiz = novaRaiz();
  const antigo = new DatabaseSync(join(raiz, "fabriquinha.db"));
  antigo.exec("PRAGMA user_version = 35");
  antigo.close();
  await assert.rejects(
    subir(raiz),
    (erro: unknown) => erro instanceof ErroDeRegra && erro.message.startsWith("o banco está na versão 35"),
  );
  await portaLivre();
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, 35);
  banco.close();
});

test("subida sobre o banco migrado: sem backfill nem linha cutover no log, e a demanda nova recebe o próximo I-<n> (CA-10)", async (t) => {
  const erros = t.mock.method(console, "error", () => undefined);
  const raiz = novaRaiz();
  const legado = bancoComDemanda(raiz);
  legado.exec(`INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', '${AGORA}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO demanda_historico (demanda_id, criada_em) VALUES ('I-1', '${AGORA}');`);
  legado.close();
  for (const vez of [1, 2]) {
    const s = await subir(raiz);
    const tabelas = s.banco
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'iss%' OR name IN ('demanda_historico', 'sequencia') ORDER BY name",
      )
      .all()
      .map((l) => l.name);
    assert.deepEqual(tabelas, ["demanda_historico", "sequencia"], `subida ${String(vez)}`);
    await s.parar();
  }
  assert.deepEqual(
    erros.mock.calls.filter((c) => String(c.arguments[1]).startsWith("cutover")),
    [],
    "a subida não chama o backfill",
  );
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  assert.equal(
    escrever(banco, () => novoId(banco, "demanda")),
    2,
  );
  banco.close();
});

test("próxima busca: a batida em que o contador chega ao intervaloMin; desligado além dele, a batida seguinte", async (t) => {
  const inicio = Date.parse("2026-10-12T14:00:00.000Z");
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: inicio });
  const s = await subir();
  const proxima = () => s.proximaBusca().toISOString();
  assert.equal(proxima(), "2026-10-12T14:05:00.000Z", "padrão: 5 minutos depois da subida");
  t.mock.timers.tick(2 * 60_000);
  assert.equal(proxima(), "2026-10-12T14:05:00.000Z");
  salvarConfiguracao(s.banco, { intervaloMin: 1 });
  assert.equal(proxima(), "2026-10-12T14:03:00.000Z", "o contador já passou do intervalo: a batida seguinte");
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 3 });
  t.mock.timers.tick(60_000);
  assert.equal(proxima(), "2026-10-12T14:06:00.000Z", "buscou às 14:03; a próxima, 3 minutos depois");
  await s.parar();
});

test("o ciclo nunca trava nem lança: erro na batida vai para o log e a batida seguinte roda", async (t) => {
  const minuto = relogio(t);
  const erros = t.mock.method(console, "error", () => undefined);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });

  s.banco.exec("ALTER TABLE configuracao RENAME TO guardada");
  minuto();
  assert.equal(erros.mock.callCount(), 1);
  assert.match(String(erros.mock.calls[0]?.arguments[1]), /no such table: configuracao/);
  s.banco.exec("ALTER TABLE guardada RENAME TO configuracao");
  minuto();
  assert.equal(erros.mock.callCount(), 1);
  await s.parar();
});

test("agendador: varre em segundo plano a base dos projetos sem varredura há 24 horas, sem sobrepor varreduras", async (t) => {
  const minuto = relogio(t);
  const erros = t.mock.method(console, "error", () => undefined);
  const raiz = novaRaiz();
  const s = await subir(raiz);
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  // `q`: base real, com o upload-pack do `origin` lento e contando as buscas. `r`: o fetch falha.
  const dir = mkdtempSync(join(raiz, "repo-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
  git(dir, "init", "-q", "--bare", "origin.git");
  git(dir, "clone", "-q", "origin.git", "q");
  const q = join(dir, "q");
  git(q, "-c", "user.name=A", "-c", "user.email=a@exemplo.com", "commit", "-q", "--allow-empty", "-m", "início");
  git(q, "push", "-q", "origin", "HEAD:main");
  const buscas = join(dir, "buscas");
  git(q, "config", "remote.origin.uploadpack", `echo x >> '${buscas}'; sleep 0.3; git-upload-pack`);
  projeto(s.banco, "q", q);
  projeto(s.banco, "r", join(dir, "nao-existe"));
  const contadas = () => (existsSync(buscas) ? readFileSync(buscas, "utf8").length / 2 : 0);
  const varrido = () => s.banco.prepare("SELECT em FROM varredura_base WHERE projeto = 'q'").get()?.em;

  minuto();
  minuto();
  minuto();
  await ate(() => varrido() !== undefined && erros.mock.callCount() === 1);
  assert.equal(contadas(), 1, "uma varredura só começa quando a anterior terminou");
  assert.match(String(erros.mock.calls[0]?.arguments[1]), /git fetch .* falhou em .*nao-existe/);

  // Varrido agora, `q` só volta depois de 24 horas; `r`, que falhou, é tentado de novo.
  minuto();
  await ate(() => erros.mock.callCount() === 2);
  assert.equal(contadas(), 1);
  s.banco.prepare("UPDATE varredura_base SET em = ? WHERE projeto = 'q'").run("2000-01-01T00:00:00.000Z");
  minuto();
  await ate(() => erros.mock.callCount() === 3);
  assert.equal(contadas(), 2);
  await s.parar();
});

test("parar espera a varredura em andamento antes de fechar o banco", async (t) => {
  const minuto = relogio(t);
  const erros = t.mock.method(console, "error", () => undefined);
  const raiz = novaRaiz();
  const s = await subir(raiz);
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  const dir = mkdtempSync(join(raiz, "repo-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
  git(dir, "init", "-q", "--bare", "origin.git");
  git(dir, "clone", "-q", "origin.git", "q");
  const q = join(dir, "q");
  git(q, "-c", "user.name=A", "-c", "user.email=a@exemplo.com", "commit", "-q", "--allow-empty", "-m", "início");
  git(q, "push", "-q", "origin", "HEAD:main");
  git(q, "config", "remote.origin.uploadpack", "sleep 0.3; git-upload-pack");
  projeto(s.banco, "q", q);

  minuto();
  await s.parar();
  assert.equal(erros.mock.callCount(), 0);
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  assert.equal(
    banco.prepare("SELECT ultimo_sha FROM varredura_base WHERE projeto = 'q'").get()?.ultimo_sha,
    git(q, "rev-parse", "HEAD"),
  );
  banco.close();
});

/** Projeto `p` com configuração do SDLC (repositório inexistente) e a demanda I-`n` em execução com um `implementar` aberto. */
function demandaEmExecucao(banco: DatabaseSync, n: number): void {
  if (!banco.prepare("SELECT 1 FROM projeto WHERE nome = 'p'").get()) {
    projeto(banco, "p", "/nao/existe");
    banco.prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('p', ?, ?)").run("a".repeat(40), AGORA);
  }
  const id = `I-${String(n)}`;
  banco.exec(`INSERT INTO demanda VALUES ('${id}', 'p', 't', 'funcionalidade', 'd', 'em_execucao', '${AGORA}', 'f', 's', 1, 'fabriquinha/${id}');
    INSERT INTO rodada VALUES ('${id}', 1, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'fabriquinha/${id}-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('${id}', 1, 'implementar', 'aberto', '${AGORA}', 1)`);
}

const estadoDoTicketDaDemanda = (banco: DatabaseSync, id: string) =>
  banco.prepare("SELECT estado FROM ticket_demanda WHERE demanda_id = ? AND ticket_id = 1").get(id)?.estado;

test("o relógio bate e a demanda é despachada", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  demandaEmExecucao(s.banco, 1);
  minuto();
  assert.equal(estadoDoTicketDaDemanda(s.banco, "I-1"), "em_execucao");
  await ate(() => estadoDoTicketDaDemanda(s.banco, "I-1") === "falhou");
  await s.parar();
});

test("a etapa que termina antecipa a busca seguinte para a próxima batida, sem esperar o intervalo inteiro", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 5 });
  demandaEmExecucao(s.banco, 1);
  for (let i = 0; i < 5; i++) minuto();
  assert.equal(estadoDoTicketDaDemanda(s.banco, "I-1"), "em_execucao");
  await ate(() => estadoDoTicketDaDemanda(s.banco, "I-1") === "falhou");
  await dormir(10); // o fim da etapa chega ao agendador depois do status gravado

  demandaEmExecucao(s.banco, 2);
  assert.equal(s.proximaBusca().getTime() - Date.now() <= 60_000, true, "a próxima busca é a batida seguinte");
  minuto();
  assert.equal(estadoDoTicketDaDemanda(s.banco, "I-2"), "em_execucao", "buscou um minuto depois, não cinco");
  await ate(() => estadoDoTicketDaDemanda(s.banco, "I-2") === "falhou");
  await s.parar();
});

test("executarAgoraDemanda: inicia o ticket elegível já, sem o agendador, e recusa o que o ciclo não escolheria", async () => {
  const s = await subir();
  demandaEmExecucao(s.banco, 1);
  s.banco.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
    VALUES ('I-1', 2, 'implementar', 'aberto', '${AGORA}', 1)`);
  await assert.rejects(
    s.executarAgoraDemanda({ demanda_id: "I-1", ticket_id: 2 }),
    /o ticket T2 .*vem antes|vem antes/,
  );
  await s.executarAgoraDemanda({ demanda_id: "I-1", ticket_id: 1 });
  assert.equal(estadoDoTicketDaDemanda(s.banco, "I-1"), "em_execucao");
  await ate(() => estadoDoTicketDaDemanda(s.banco, "I-1") === "falhou");
  await s.parar();
});
