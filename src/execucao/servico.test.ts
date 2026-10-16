// Serviço, agendador e reinício (F4 §2, §3, §4, §4.1, §7) contra banco real; issues e tickets vão direto em SQL,
// porque o que importa aqui é o estado em que o serviço os encontra.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, type TestContext, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { ZodError } from "zod";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import {
  autonomasEmAndamento,
  configuracao,
  execucoesEmAndamento,
  salvarConfiguracao,
  ticketsElegiveis,
  ticketsAutonomosEmExecucao,
} from "../persistencia/servico.ts";
import { criarUsuarioSimulado } from "../persistencia/simulacao.ts";
import { iniciarServico, portaDoServico } from "./servico.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-servico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const novaRaiz = () => mkdtempSync(join(base, "raiz-"));

const AGORA = "2026-10-11T12:00:00.000Z";

/** Cadastra o projeto `nome` no repositório `repo`. */
function projeto(banco: DatabaseSync, nome: string, repo: string): void {
  registrarProjeto(banco, {
    nome,
    repo,
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: nome },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
}

/**
 * Issue `id` na `fase`, do projeto `p`, cujo repositório não existe: uma execução iniciada falha ao criar a worktree.
 * O projeto acabou de ser varrido (F6 §4.4), para o agendador não tentar buscar a base dele.
 */
function issue(banco: DatabaseSync, id: number, fase: string): void {
  if (!banco.prepare("SELECT 1 FROM projeto WHERE nome = 'p'").get()) {
    projeto(banco, "p", "/nao/existe");
    banco
      .prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('p', ?, ?)")
      .run("a".repeat(40), new Date().toISOString());
  }
  banco
    .prepare(
      "INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em) VALUES (?, 'p', ?, 'problema', ?, ?, ?)",
    )
    .run(id, `I-${String(id)}`, fase, AGORA, fase === "concluida" ? AGORA : null);
}

function ticket(banco: DatabaseSync, id: number, issue: number, etapa: string, status = "aberto"): void {
  banco
    .prepare(
      `INSERT INTO ticket (id, issue, etapa, titulo, status, origem, erro, criado_em, concluido_em)
       VALUES (?, ?, ?, ?, ?, 'fabriquinha', ?, ?, ?)`,
    )
    .run(
      id,
      issue,
      etapa,
      `T-${String(id)}`,
      status,
      status === "falhou" ? "erro" : null,
      AGORA,
      status === "concluido" ? AGORA : null,
    );
}

/** Execução `id`; a sequência anda junto, para o C5 nunca repetir o número. */
function execucao(
  banco: DatabaseSync,
  id: number,
  ticket: number,
  modo: string,
  resultado = "em_andamento",
  pgid: number | null = null,
): void {
  banco
    .prepare(
      `INSERT INTO execucao (id, ticket, modo, sessao_pi, pgid_pi, resultado, iniciada_em, terminada_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ticket, modo, crypto.randomUUID(), pgid, resultado, AGORA, resultado === "em_andamento" ? null : AGORA);
  banco
    .prepare(
      "INSERT INTO sequencia (nome, valor) VALUES ('execucao', ?) ON CONFLICT (nome) DO UPDATE SET valor = max(valor, excluded.valor)",
    )
    .run(id);
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

const estado = (banco: DatabaseSync, id: number) =>
  banco.prepare("SELECT status, erro FROM ticket WHERE id = ?").get(id) as { status: string; erro: string | null };

/** Espera a execução em segundo plano chegar a `condicao`, com o relógio real (o falso só move o setInterval). */
async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; !condicao() && i < 500; i++) await dormir(10);
  assert.ok(condicao(), "a condição não chegou em 5 s");
}

/** Um ticket que o agendador ou o "Executar agora" iniciou: C5 passou, e a worktree do repositório que não existe falhou. */
async function falhouNaWorktree(banco: DatabaseSync, id: number): Promise<void> {
  await ate(() => estado(banco, id).status === "falhou");
  assert.match(String(estado(banco, id).erro), /falhou em \/nao\/existe/);
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
  issue(s.banco, 1, "revisao");
  ticket(s.banco, 1, 1, "revisao", "em_execucao");
  execucao(s.banco, 1, 1, "autonomo");

  // A raiz da segunda nem existe: ela recusa pela porta sem chegar a criá-la nem a migrar o banco.
  const outraRaiz = join(base, "nunca-criada");
  await assert.rejects(
    iniciarServico(outraRaiz),
    (erro: unknown) =>
      erro instanceof ErroDeRegra &&
      erro.message.startsWith(`a Fabriquinha não conseguiu abrir 127.0.0.1:${porta}: listen EADDRINUSE`),
  );
  assert.equal(existsSync(outraRaiz), false);
  await assert.rejects(subir(raiz), ErroDeRegra);
  assert.equal(execucoesEmAndamento(s.banco).length, 1, "a segunda instância não encerrou a execução da primeira");

  await s.parar();
  const outra = await subir(raiz);
  assert.deepEqual(execucoesEmAndamento(outra.banco), [], "parada a primeira, a porta fica livre");
  await outra.parar();
});

test("parar apaga o web.url: o abrir diz que o serviço não está rodando em vez de abrir um link morto", async () => {
  const raiz = novaRaiz();
  const s = await subir(raiz);
  assert.equal(existsSync(join(raiz, "web.url")), true);
  await s.parar();
  assert.equal(existsSync(join(raiz, "web.url")), false);
});

test("reinício: o pi de uma auditoria da instância anterior é morto pelo pgid da pasta dela", async () => {
  const raiz = novaRaiz();
  abrir(raiz).close();
  const pi = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const saiu = once(pi, "exit");
  const dir = join(raiz, "auditorias", "11111111-1111-4111-8111-111111111111");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pgid"), String(pi.pid));

  await (await subir(raiz)).parar();
  assert.deepEqual(await saiu, [null, "SIGKILL"]);
  assert.equal(existsSync(join(dir, "pgid")), false);
});

test("reinício: as execuções da instância anterior são encerradas conforme o F4 §7 na subida", async () => {
  const raiz = novaRaiz();
  const banco = abrir(raiz);
  // O pi da instância anterior, num grupo próprio, ainda vivo.
  const pi = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const saiu = once(pi, "exit");
  issue(banco, 1, "revisao");
  ticket(banco, 1, 1, "revisao", "em_execucao");
  execucao(banco, 1, 1, "autonomo", "em_andamento", pi.pid);
  issue(banco, 2, "registro");
  ticket(banco, 2, 2, "registro", "em_execucao");
  execucao(banco, 2, 2, "interativo");
  issue(banco, 3, "desenvolvimento");
  ticket(banco, 3, 3, "desenvolvimento", "concluido");
  execucao(banco, 3, 3, "consulta");
  // Caiu durante a coleta depois do pi: C6 gravado, C7/C8 não, e nenhuma execução em andamento.
  issue(banco, 4, "desenvolvimento");
  ticket(banco, 4, 4, "desenvolvimento", "em_execucao");
  execucao(banco, 4, 4, "autonomo", "sucesso");
  // O desenho é interativo (F1 §3.6): como o registro, continua em execução, e a próxima mensagem o retoma.
  issue(banco, 5, "desenho");
  ticket(banco, 5, 5, "desenho", "em_execucao");
  execucao(banco, 5, 5, "interativo");
  // F6 §3.3: a sessão da interativa tem uma resposta; a da autônoma tem dois arquivos, e a coleta dela falha.
  const sessao = (e: number) => String(banco.prepare("SELECT sessao_pi FROM execucao WHERE id = ?").get(e)?.sessao_pi);
  mkdirSync(join(raiz, "sessoes"));
  const resposta = {
    type: "message",
    timestamp: AGORA,
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-5",
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5 } },
    },
  };
  writeFileSync(join(raiz, "sessoes", `a_${sessao(2)}.jsonl`), JSON.stringify(resposta));
  for (const copia of ["a", "b"]) writeFileSync(join(raiz, "sessoes", `${copia}_${sessao(1)}.jsonl`), "");
  mkdirSync(join(raiz, "execucoes", "E-1"), { recursive: true });
  banco.close();

  const s = await subir(raiz);
  assert.deepEqual(await saiu, [null, "SIGKILL"]);
  const ag = (n: number) => {
    const a = agregado(s.banco, n);
    assert.ok(a);
    return { ticket: a.tickets[0], execucao: a.execucoes[0] };
  };
  const falha = { resultado: "falha", erro: "serviço reiniciado" };
  assert.partialDeepStrictEqual(ag(1), { ticket: { status: "falhou", erro: "serviço reiniciado" }, execucao: falha });
  assert.partialDeepStrictEqual(ag(2), { ticket: { status: "em_execucao" }, execucao: falha });
  assert.partialDeepStrictEqual(ag(3), { ticket: { status: "concluido" }, execucao: falha });
  assert.partialDeepStrictEqual(ag(4), { ticket: { status: "falhou", erro: "serviço reiniciado" } });
  assert.partialDeepStrictEqual(ag(5), { ticket: { status: "em_execucao" }, execucao: falha });
  assert.equal(ag(2).ticket?.erro, undefined);
  assert.deepEqual(ticketsAutonomosEmExecucao(s.banco), []);
  assert.deepEqual(
    s.banco
      .prepare("SELECT * FROM uso")
      .all()
      .map((l) => ({ ...l })),
    [
      {
        execucao: 2,
        provedor: "openai",
        modelo: "gpt-5",
        chamadas: 1,
        input: 1,
        output: 2,
        cache_read: 3,
        cache_write: 4,
        custo: 0.5,
      },
    ],
  );
  assert.match(readFileSync(join(raiz, "execucoes", "E-1", "log"), "utf8"), /coleta de uso falhou: .* tem 2 arquivos/);
  await s.parar();
});

test("reinício: as execuções simuladas pendentes falham e o pi delas é morto; as terminadas ficam", async () => {
  const raiz = novaRaiz();
  const banco = abrir(raiz);
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

test("subida que falha ao abrir o banco ou ao recuperar libera a porta", async () => {
  const arquivo = join(base, "raiz-que-e-arquivo");
  writeFileSync(arquivo, "");
  await assert.rejects(subir(arquivo), /EEXIST|ENOTDIR/);
  await portaLivre();

  const raiz = novaRaiz();
  const banco = abrir(raiz);
  issue(banco, 1, "revisao");
  ticket(banco, 1, 1, "revisao", "em_execucao");
  execucao(banco, 1, 1, "autonomo");
  banco.exec("UPDATE execucao SET sessao_pi = 'nao-e-uuid'");
  banco.close();
  await assert.rejects(subir(raiz), ZodError);
  await portaLivre();
});

test("agendador: desligado por padrão; ligado, inicia a cada intervaloMin um ticket por issue elegível", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  for (const id of [1, 2, 3]) {
    issue(s.banco, id, "revisao");
    ticket(s.banco, id, id, "revisao");
  }
  for (let i = 0; i < 10; i++) minuto();
  await dormir(50);
  for (const id of [1, 2, 3]) assert.equal(estado(s.banco, id).status, "aberto", "CA-9: desligado, nada inicia");
  assert.deepEqual(autonomasEmAndamento(s.banco), []);

  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 3 });
  minuto(); // o intervalo já passou enquanto desligado: o primeiro ciclo vem na batida seguinte
  for (const id of [1, 2, 3]) assert.equal(estado(s.banco, id).status, "em_execucao", "CA-1: o C5 roda na batida");
  assert.partialDeepStrictEqual(
    autonomasEmAndamento(s.banco),
    [
      { execucao: 1, ticket: 1, issue: 1 },
      { execucao: 2, ticket: 2, issue: 2 },
      { execucao: 3, ticket: 3, issue: 3 },
    ],
    "uma execução por issue",
  );
  for (const id of [1, 2, 3]) await falhouNaWorktree(s.banco, id);

  issue(s.banco, 4, "revisao");
  ticket(s.banco, 4, 4, "revisao");
  minuto();
  minuto();
  assert.equal(estado(s.banco, 4).status, "aberto", "intervalo de 3 minutos");
  minuto();
  await falhouNaWorktree(s.banco, 4);
  await s.parar();
});

test("agendador e Executar agora abrem o desenho como sessão interativa, que espera o Auditor sem falhar", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  for (const id of [1, 2]) {
    issue(s.banco, id, "desenho");
    ticket(s.banco, id, id, "desenho");
  }
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  minuto();
  await s.executarAgora(2).catch(() => undefined); // a I-2 já começou na batida: o C5 recusa a segunda
  for (const id of [1, 2]) {
    assert.equal(estado(s.banco, id).status, "em_execucao");
    assert.equal(s.banco.prepare("SELECT modo FROM execucao WHERE ticket = ?").get(id)?.modo, "interativo");
  }
  assert.deepEqual(autonomasEmAndamento(s.banco), [], "nenhuma autônoma");
  // O repositório não existe: a execução termina com falha, e o ticket interativo continua em execução.
  await ate(() => execucoesEmAndamento(s.banco).length === 0);
  for (const id of [1, 2]) assert.equal(estado(s.banco, id).status, "em_execucao");
  issue(s.banco, 3, "desenho");
  ticket(s.banco, 3, 3, "desenho");
  await s.executarAgora(3);
  assert.equal(s.banco.prepare("SELECT modo FROM execucao WHERE ticket = 3").get()?.modo, "interativo");
  await ate(() => execucoesEmAndamento(s.banco).length === 0);
  await s.parar();
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

test("agendador inicia as issues livres e pula a que o C5 recusaria (CA-2)", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "desenvolvimento");
  ticket(s.banco, 1, 1, "desenvolvimento", "concluido");
  ticket(s.banco, 2, 1, "desenvolvimento");
  execucao(s.banco, 1, 1, "consulta");
  issue(s.banco, 2, "revisao");
  ticket(s.banco, 3, 2, "revisao", "em_execucao");
  execucao(s.banco, 2, 3, "autonomo");
  issue(s.banco, 3, "revisao");
  ticket(s.banco, 4, 3, "revisao");
  issue(s.banco, 4, "revisao");
  ticket(s.banco, 5, 4, "revisao");

  minuto();
  assert.equal(estado(s.banco, 2).status, "aberto", "a I-1 tem uma consulta em andamento");
  assert.equal(estado(s.banco, 4).status, "em_execucao");
  assert.equal(estado(s.banco, 5).status, "em_execucao");
  assert.deepEqual(
    autonomasEmAndamento(s.banco).map((e) => e.issue),
    [2, 3, 4],
    "a I-2 mantém a única execução; a I-3 e a I-4 ganham a sua",
  );
  await falhouNaWorktree(s.banco, 4);
  await falhouNaWorktree(s.banco, 5);
  await s.parar();
});

test("agendador: numa issue em desenvolvimento só o ticket mais antigo inicia (CA-3)", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "desenvolvimento");
  ticket(s.banco, 1, 1, "desenvolvimento");
  ticket(s.banco, 2, 1, "desenvolvimento");

  minuto();
  assert.equal(estado(s.banco, 1).status, "em_execucao");
  assert.equal(estado(s.banco, 2).status, "aberto");
  await falhouNaWorktree(s.banco, 1);
  await s.parar();
});

test("agendador: a issue com dependência aberta espera (CA-7)", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "revisao");
  ticket(s.banco, 1, 1, "revisao");
  issue(s.banco, 2, "revisao");
  ticket(s.banco, 2, 2, "revisao");
  issue(s.banco, 3, "registro");
  s.banco.exec("INSERT INTO issue_dep (issue, dep) VALUES (2, 3)");

  minuto();
  assert.equal(estado(s.banco, 1).status, "em_execucao");
  assert.equal(estado(s.banco, 2).status, "aberto");
  await falhouNaWorktree(s.banco, 1);
  await s.parar();
});

test("o ciclo nunca trava nem lança: erro na batida e recusa do C5 vão para o log", async (t) => {
  const minuto = relogio(t);
  const erros = t.mock.method(console, "error", () => undefined);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "revisao");
  ticket(s.banco, 1, 1, "revisao");

  s.banco.exec("ALTER TABLE configuracao RENAME TO guardada");
  minuto();
  assert.equal(erros.mock.callCount(), 1);
  assert.match(String(erros.mock.calls[0]?.arguments[1]), /no such table: configuracao/);
  s.banco.exec("ALTER TABLE guardada RENAME TO configuracao");

  // Uma divergência entre a consulta e o C5 (aqui, a issue que não carrega) aparece no log, sem mudar o ticket.
  s.banco.exec(`UPDATE issue SET descricao = '${"palavra ".repeat(1001)}' WHERE id = 1`);
  minuto();
  await ate(() => erros.mock.callCount() === 2);
  assert.ok(erros.mock.calls[1]?.arguments[1] instanceof ZodError);
  assert.equal(estado(s.banco, 1).status, "aberto");

  s.banco.exec("UPDATE issue SET descricao = '' WHERE id = 1");
  minuto();
  await falhouNaWorktree(s.banco, 1);
  await s.parar();
});

test("agendador: varre em segundo plano a base dos projetos sem varredura há 24 horas, sem sobrepor varreduras", async (t) => {
  const minuto = relogio(t);
  const erros = t.mock.method(console, "error", () => undefined);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "revisao");
  ticket(s.banco, 1, 1, "revisao");
  // `q`: base real, com o upload-pack do `origin` lento e contando as buscas. `r`: o fetch falha.
  const dir = mkdtempSync(join(base, "repo-"));
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
  assert.partialDeepStrictEqual(
    autonomasEmAndamento(s.banco),
    [{ execucao: 1, ticket: 1 }],
    "a batida não espera a varredura",
  );
  minuto();
  minuto();
  await ate(() => varrido() !== undefined && erros.mock.callCount() === 1);
  assert.equal(contadas(), 1, "uma varredura só começa quando a anterior terminou");
  assert.match(String(erros.mock.calls[0]?.arguments[1]), /git fetch .* falhou em .*nao-existe/);
  await falhouNaWorktree(s.banco, 1);

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
  const dir = mkdtempSync(join(base, "repo-"));
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
  const banco = abrir(raiz);
  assert.equal(
    banco.prepare("SELECT ultimo_sha FROM varredura_base WHERE projeto = 'q'").get()?.ultimo_sha,
    git(q, "rev-parse", "HEAD"),
  );
  banco.close();
});

test("executarAgora: não espera o agendador, inicia com outra issue rodando e recusa a 2ª da mesma issue", async () => {
  const s = await subir();
  assert.equal(configuracao(s.banco).agendadorAtivo, false);
  issue(s.banco, 1, "revisao");
  ticket(s.banco, 1, 1, "revisao", "em_execucao");
  execucao(s.banco, 1, 1, "autonomo");
  issue(s.banco, 2, "desenvolvimento");
  ticket(s.banco, 2, 2, "desenvolvimento");
  ticket(s.banco, 3, 2, "desenvolvimento");
  issue(s.banco, 3, "registro");
  ticket(s.banco, 4, 3, "registro");

  await assert.rejects(s.executarAgora(4), /T-4 é da etapa registro, que roda em modo interativo/);
  await s.executarAgora(2);
  assert.partialDeepStrictEqual(
    autonomasEmAndamento(s.banco),
    [
      { execucao: 1, issue: 1 },
      { execucao: 2, ticket: 2, issue: 2 },
    ],
    "CA-4: volta logo depois do C5, com a I-1 ainda rodando",
  );
  await assert.rejects(
    s.executarAgora(3),
    (erro: unknown) =>
      erro instanceof ErroDeRegra && erro.message === "a I-2 já tem a execução E-2 em andamento (espere ela terminar)",
  );
  await falhouNaWorktree(s.banco, 2);
  assert.deepEqual(ticketsElegiveis(s.banco), [], "T-2 falhou: T-3 espera ele concluir (C5)");
  await s.parar();
});
