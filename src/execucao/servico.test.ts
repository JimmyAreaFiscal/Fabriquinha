// Serviço, agendador e reinício (F4 §2, §3, §4, §4.1, §7) contra banco real; issues e tickets vão direto em SQL,
// porque o que importa aqui é o estado em que o serviço os encontra.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  autonomaEmAndamento,
  configuracao,
  execucoesEmAndamento,
  salvarConfiguracao,
  ticketElegivel,
  ticketsAutonomosEmExecucao,
} from "../persistencia/servico.ts";
import { iniciarServico, portaDoServico } from "./servico.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-servico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const novaRaiz = () => mkdtempSync(join(base, "raiz-"));

const AGORA = "2026-10-11T12:00:00.000Z";

/** Issue `id` na `fase`, do projeto `p`, cujo repositório não existe: uma execução iniciada falha ao criar a worktree. */
function issue(banco: DatabaseSync, id: number, fase: string): void {
  if (!banco.prepare("SELECT 1 FROM projeto").get()) {
    registrarProjeto(banco, {
      nome: "p",
      repo: "/nao/existe",
      branchBase: "main",
      hospedagem: "github",
      testes: ["npm test"],
      sonar: { projectKey: "p" },
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    });
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

const PACOTE = "/opt/pi-fabriquinha";

/** Cada teste do serviço numa porta livre, para não esbarrar numa Fabriquinha de verdade. */
beforeEach(async () => {
  const s = createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  process.env.FABRIQUINHA_PORTA = String((s.address() as { port: number }).port);
  s.close();
  await once(s, "close");
});

const subir = (raiz = novaRaiz()) => iniciarServico(raiz, PACOTE);

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

test("instância única: a porta é a trava, e a segunda instância sai com erro antes de abrir o banco", async () => {
  const raiz = novaRaiz();
  const s = await subir(raiz);
  const porta = String(portaDoServico());
  assert.equal((await fetch(`http://127.0.0.1:${porta}/`)).status, 404, "a porta só trava; as rotas são do F7");
  issue(s.banco, 1, "desenho");
  ticket(s.banco, 1, 1, "desenho", "em_execucao");
  execucao(s.banco, 1, 1, "autonomo");

  // A raiz da segunda nem existe: ela recusa pela porta sem chegar a criá-la nem a migrar o banco.
  const outraRaiz = join(base, "nunca-criada");
  await assert.rejects(
    iniciarServico(outraRaiz, PACOTE),
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

test("reinício: as execuções da instância anterior são encerradas conforme o F4 §7 na subida", async () => {
  const raiz = novaRaiz();
  const banco = abrir(raiz);
  // O pi da instância anterior, num grupo próprio, ainda vivo.
  const pi = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  const saiu = once(pi, "exit");
  issue(banco, 1, "desenho");
  ticket(banco, 1, 1, "desenho", "em_execucao");
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
  assert.equal(ag(2).ticket?.erro, undefined);
  assert.deepEqual(ticketsAutonomosEmExecucao(s.banco), []);
  await s.parar();
});

test("subida que falha ao abrir o banco ou ao recuperar libera a porta", async () => {
  const arquivo = join(base, "raiz-que-e-arquivo");
  writeFileSync(arquivo, "");
  await assert.rejects(subir(arquivo), /EEXIST|ENOTDIR/);
  await portaLivre();

  const raiz = novaRaiz();
  const banco = abrir(raiz);
  issue(banco, 1, "desenho");
  ticket(banco, 1, 1, "desenho", "em_execucao");
  execucao(banco, 1, 1, "autonomo");
  banco.exec("UPDATE execucao SET sessao_pi = 'nao-e-uuid'");
  banco.close();
  await assert.rejects(subir(raiz), ZodError);
  await portaLivre();
});

test("agendador: desligado por padrão; ligado, inicia a cada intervaloMin o ticket elegível", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  issue(s.banco, 1, "desenho");
  ticket(s.banco, 1, 1, "desenho");
  issue(s.banco, 2, "desenho");
  ticket(s.banco, 2, 2, "desenho");
  for (let i = 0; i < 10; i++) minuto();
  await dormir(50);
  assert.equal(estado(s.banco, 1).status, "aberto");

  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 3 });
  minuto(); // o intervalo já passou enquanto desligado: o primeiro ciclo vem na batida seguinte
  assert.deepEqual(autonomaEmAndamento(s.banco), { execucao: 1, ticket: 1 }, "o C5 roda na própria batida");
  await falhouNaWorktree(s.banco, 1);
  assert.equal(estado(s.banco, 2).status, "aberto", "um ticket por ciclo");

  minuto();
  minuto();
  assert.equal(estado(s.banco, 2).status, "aberto", "intervalo de 3 minutos");
  minuto();
  await falhouNaWorktree(s.banco, 2);
  await s.parar();
});

test("agendador respeita o D8 da execução e pula a issue que o C5 recusaria", async (t) => {
  const minuto = relogio(t);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "desenvolvimento");
  ticket(s.banco, 1, 1, "desenvolvimento", "concluido");
  ticket(s.banco, 2, 1, "desenvolvimento");
  execucao(s.banco, 1, 1, "consulta");
  issue(s.banco, 2, "desenho");
  ticket(s.banco, 3, 2, "desenho", "em_execucao");
  execucao(s.banco, 2, 3, "autonomo");
  issue(s.banco, 3, "desenho");
  ticket(s.banco, 4, 3, "desenho");

  minuto();
  assert.equal(estado(s.banco, 4).status, "aberto", "D8 ocupado: o agendador não faz nada");

  // C6 da E-2: a vaga do D8 é da execução, mesmo com o T-3 ainda na coleta.
  s.banco.exec(`UPDATE execucao SET resultado = 'sucesso', terminada_em = '${AGORA}' WHERE id = 2`);
  minuto();
  await falhouNaWorktree(s.banco, 4);
  assert.equal(estado(s.banco, 2).status, "aberto");
  await s.parar();
});

test("o ciclo nunca trava nem lança: erro na batida e recusa do C5 vão para o log", async (t) => {
  const minuto = relogio(t);
  const erros = t.mock.method(console, "error", () => undefined);
  const s = await subir();
  salvarConfiguracao(s.banco, { agendadorAtivo: true, intervaloMin: 1 });
  issue(s.banco, 1, "desenho");
  ticket(s.banco, 1, 1, "desenho");

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

test("executarAgora: não espera o agendador, devolve a recusa do C5 e recusa com a execução que ocupa o D8", async () => {
  const s = await subir();
  assert.equal(configuracao(s.banco).agendadorAtivo, false);
  issue(s.banco, 1, "desenho");
  ticket(s.banco, 1, 1, "desenho");
  issue(s.banco, 2, "desenho");
  ticket(s.banco, 2, 2, "desenho");
  issue(s.banco, 3, "registro");
  ticket(s.banco, 3, 3, "registro");

  await assert.rejects(s.executarAgora(3), /T-3 é da etapa registro, que roda em modo interativo/);
  await s.executarAgora(1);
  assert.deepEqual(autonomaEmAndamento(s.banco), { execucao: 1, ticket: 1 }, "volta logo depois do C5");
  await assert.rejects(
    s.executarAgora(2),
    (erro: unknown) =>
      erro instanceof ErroDeRegra &&
      erro.message === "já há uma execução autônoma em andamento (D8): E-1 de T-1 (espere ela terminar)",
  );
  await falhouNaWorktree(s.banco, 1);
  assert.equal(ticketElegivel(s.banco), 2);
  await s.parar();
});
