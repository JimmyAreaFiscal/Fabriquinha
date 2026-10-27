// Ações do Auditor sobre as demandas (CA-13 a CA-27 e CA-36) contra o servidor web de verdade, com git real e pi falso.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { registrarCorrecoesSessao } from "../../dominio/transicoes_rodada.ts";
import { abrir } from "../../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda, criarDemanda } from "../../persistencia/demandas.ts";
import { hospedagemFalsa } from "../../repositorio/hospedagem-falsa.test.ts";
import { cenarioDemanda, commitarCenario, gitCenario } from "../../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../../repositorio/worktree-demanda.ts";
import { demanda, servir } from "./demandas_cenario.test.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-acoes-web-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;
const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});
after(() => {
  rmSync(temporario, { recursive: true, force: true });
});

// pi falso: grava no JSONL da sessão cada prompt recebido (como o pi) e a resposta, e assenta sem encerrar.
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type !== "prompt") continue;
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0.01 } };
    const resposta = { role: "assistant", content: [], provider: "anthropic", model: "claude-teste", stopReason: "stop", usage };
    mkdirSync(arg("--session-dir"), { recursive: true });
    const arquivo = arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl";
    const entrada = (message) => JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n";
    appendFileSync(arquivo, entrada({ role: "user", content: c.message }) + entrada(resposta));
    emitir({ type: "response", command: "prompt", success: true });
    emitir({ type: "agent_start" });
    emitir({ type: "message_end", message: resposta });
    emitir({ type: "agent_settled" });
  }
});
`;
const pi = join(temporario, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);

const DEMANDA = "I-206";
const BRANCH_DEMANDA = "fabriquinha/I-206";
const BRANCH_RODADA = "fabriquinha/I-206-2";
const REF = { demanda_id: DEMANDA, rodada_id: 2 };
const CRITERIOS = ["CA-1", "CA-2"];

const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id: DEMANDA,
  ticket_id,
  etapa,
  status,
  status_alterado_em: em,
  devolucoes: 0,
  ...extra,
});
const plano = {
  demanda_id: DEMANDA,
  criterios: CRITERIOS,
  rodadas: [1, 2].map((rodada_id) => ({
    demanda_id: DEMANDA,
    rodada_id,
    titulo: `r${String(rodada_id)}`,
    e2e: false,
    criterios: [CRITERIOS[0]],
    depende: rodada_id === 2 ? [{ demanda_id: DEMANDA, rodada_id: 1 }] : [],
  })),
  tickets: [1, 2].map((n) => ({
    demanda_id: DEMANDA,
    ticket_id: n,
    rodada_id: n,
    titulo: `t${String(n)}`,
    descricao: "d",
  })),
};

/**
 * I-206 num dos três gates: `demanda` (aprovação da demanda), `planejamento` (plano submetido) ou `pr` (R2 com o PR 1
 * aberto, branches no origin e worktrees prontas). A I-207 depende dela e está em planejamento.
 */
async function cenario(gate: "demanda" | "planejamento" | "pr") {
  const c = cenarioDemanda();
  const banco = abrir(c.raiz);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('loja', ?, 'integracao', 'github', '["t"]', 'k', '[{"nome":"f"}]')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: "true" }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  const resto: Record<string, unknown> = {
    demanda: { ...demanda(DEMANDA, "").demanda, fase: "aprovacao_demanda" },
    tickets: [ticket(1, "demanda", "em_execucao")],
  };
  if (gate === "planejamento") {
    resto.demanda = { ...demanda(DEMANDA, "").demanda, fase: "aprovacao_planejamento" };
    resto.tickets = [ticket(1, "planejar", "em_execucao")];
    resto.evidencias = [
      {
        demanda_id: DEMANDA,
        tipo: "criterios_aceite",
        dados: { criterios: CRITERIOS.map((id) => ({ id, dado: "d", quando: "q", entao: "e" })) },
        em,
      },
      { demanda_id: DEMANDA, ticket_id: 1, tipo: "plano", dados: plano, em },
    ];
  }
  if (gate === "pr") {
    await garantirWorktreeDemanda(c.raiz, c.projeto, DEMANDA, c.log, () => Promise.resolve());
    const head = commitarCenario(await garantirWorktreeRodada(c.raiz, c.projeto, REF, c.log), "a.txt", "a\n");
    gitCenario(c.repo, "push", "-q", "origin", BRANCH_DEMANDA, BRANCH_RODADA);
    hospedagem.abrir({ head: BRANCH_RODADA, base: BRANCH_DEMANDA, titulo: "t", corpo: "c", estado: "aberto" });
    resto.demanda = { ...demanda(DEMANDA, "").demanda, fase: "execucao" };
    resto.rodadas = [
      { ...REF, titulo: "r2", fase: "aprovacao_pull_request", e2e: false, branch: BRANCH_RODADA },
      { demanda_id: DEMANDA, rodada_id: 1, titulo: "r1", fase: "concluida", e2e: false, branch: "fabriquinha/I-206-1" },
    ];
    resto.tickets = [
      ticket(3, "implementar", "concluido", { rodada_id: 2 }),
      ticket(8, "encerrar_rodada", "em_execucao", { rodada_id: 2 }),
    ];
    resto.evidencias = [
      {
        demanda_id: DEMANDA,
        ticket_id: 8,
        tipo: "pr_aberto",
        dados: { id: "1", url: "https://github.com/org/loja/pull/1", branch: BRANCH_RODADA, head },
        em,
      },
    ];
  }
  const { demanda: cabecalho, ...outros } = resto;
  const ag = demanda(DEMANDA, "", outros);
  criarDemanda(banco, { ...ag, demanda: cabecalho } as typeof ag);
  criarDemanda(banco, demanda("I-207", "planejamento"));
  banco.exec("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-207', 'I-206')");

  const registro = join(c.dir, "registro.jsonl");
  process.env.FABRIQUINHA_PI = pi;
  return {
    c,
    banco,
    ...(await servir(banco)),
    ag: () => carregarDemanda(banco, DEMANDA),
    fase: (id = DEMANDA) => carregarDemanda(banco, id).demanda.fase,
    registro,
  };
}

type Cenario = Awaited<ReturnType<typeof cenario>>;
const erro = (r: { json: () => Record<string, string> }) => String(r.json().erro);

test("CA-13: aprovar a demanda avança de fase e a resposta traz a demanda atualizada", async () => {
  const { pedir, fase } = await cenario("demanda");
  const r = await pedir("/api/demandas/I-206/decisao", { metodo: "POST", corpo: { aprovado: true } });
  assert.equal(r.status, 200);
  const { demanda, canceladas } = r.json<{ demanda: { demanda: { fase: string } }; canceladas: string[] }>();
  assert.equal(demanda.demanda.fase, "planejamento");
  assert.deepEqual(canceladas, []);
  assert.equal(fase(), "planejamento");
});

test("CA-14: recusar a demanda sem motivo pede o motivo e a demanda continua aguardando", async () => {
  const { pedir, fase } = await cenario("demanda");
  const r = await pedir("/api/demandas/I-206/decisao", { metodo: "POST", corpo: { aprovado: false } });
  assert.equal(r.status, 409);
  assert.match(erro(r), /informe o motivo da recusa/);
  assert.equal(fase(), "aprovacao_demanda");
});

test("CA-15: recusar com motivo cancela a I-206 e a I-207 que depende dela", async () => {
  const { pedir, fase } = await cenario("demanda");
  const r = await pedir("/api/demandas/I-206/decisao", {
    metodo: "POST",
    corpo: { aprovado: false, motivo: "escopo grande demais" },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json<{ canceladas: string[] }>().canceladas, ["I-206", "I-207"]);
  assert.deepEqual([fase("I-206"), fase("I-207")], ["cancelada", "cancelada"]);
});

test("CA-16: aprovar de novo devolve a orientação do serviço e a demanda não muda", async () => {
  const { pedir, fase } = await cenario("demanda");
  await pedir("/api/demandas/I-206/decisao", { metodo: "POST", corpo: { aprovado: true } });
  const r = await pedir("/api/demandas/I-206/decisao", { metodo: "POST", corpo: { aprovado: true } });
  assert.equal(r.status, 409);
  assert.match(erro(r), /não espera decisão/);
  assert.equal(fase(), "planejamento");
});

test("CA-17: aprovar o planejamento avança de fase e cria a worktree de cada rodada", async () => {
  const { pedir, fase, c } = await cenario("planejamento");
  const r = await pedir("/api/demandas/I-206/planejamento/decisao", {
    metodo: "POST",
    corpo: { aprovado: true, nota: 4 },
  });
  assert.equal(r.status, 200);
  assert.equal(fase(), "execucao");
  for (const n of [1, 2]) assert.ok(existsSync(join(c.raiz, "worktrees", "loja", DEMANDA, "rodadas", String(n))));
});

test("CA-18: reprovar o planejamento sem motivo pede o motivo e o planejamento continua aguardando", async () => {
  const { pedir, fase } = await cenario("planejamento");
  const r = await pedir("/api/demandas/I-206/planejamento/decisao", { metodo: "POST", corpo: { aprovado: false } });
  assert.equal(r.status, 422);
  assert.match(erro(r), /informe o motivo da reprovação do planejamento/);
  assert.equal(fase(), "aprovacao_planejamento");
});

test("CA-19: reprovar o planejamento com motivo volta a demanda ao planejamento com o motivo registrado", async () => {
  const { pedir, fase, ag } = await cenario("planejamento");
  const r = await pedir("/api/demandas/I-206/planejamento/decisao", {
    metodo: "POST",
    corpo: { aprovado: false, motivo: "falta cobrir o erro de rede" },
  });
  assert.equal(r.status, 200);
  assert.equal(fase(), "planejamento");
  assert.deepEqual(
    ag().decisoes.map((d) => [d.resultado, d.motivo]),
    [["recusado", "falta cobrir o erro de rede"]],
  );
});

const PR = "/api/demandas/rodadas/I-206.R2/pr";
const rodada = (c: Cenario) => c.ag().rodadas.find((r) => r.rodada_id === 2);

test("CA-20: aprovar o PR com nota 4 conclui a rodada e grava a nota", async () => {
  const c = await cenario("pr");
  const r = await c.pedir(PR, { metodo: "POST", corpo: { aprovado: true, nota: 4 } });
  assert.equal(r.status, 200);
  assert.equal(rodada(c)?.fase, "concluida");
  assert.equal(c.ag().decisoes.find((d) => d.resultado === "aprovado")?.nota, 4);
});

test("CA-21: aprovar o PR com nota 6 diz que a nota vai de 1 a 5 e a rodada não muda", async () => {
  const c = await cenario("pr");
  for (const corpo of [{ aprovado: true, nota: 6 }, { aprovado: true }]) {
    const r = await c.pedir(PR, { metodo: "POST", corpo });
    assert.equal(r.status, 422);
    assert.match(erro(r), /a nota vai de 1 a 5/);
  }
  assert.equal(rodada(c)?.fase, "aprovacao_pull_request");
});

/** Registra a correção como o agente da sessão e conclui pela rota: encerra o pi do teste. */
async function concluirSessao({ pedir, banco }: Cenario, ticket_id: number) {
  comDemanda(banco, DEMANDA, (a) =>
    registrarCorrecoesSessao(
      a,
      {
        ...REF,
        ticket_id,
        correcoes: [{ demanda_id: DEMANDA, rodada_id: 2, ticket_id: 1, titulo: "Corrigir", descricao: "Corrigir" }],
      },
      { tipo: "agente", execucao: 1, ticket: ticket_id },
      { agora: em },
    ),
  );
  return pedir("/api/demandas/rodadas/I-206.R2/ajustes/concluir", { metodo: "POST" });
}

/** A sessão de ajustes aberta pela reprovação do PR; o ticket dela é o 9. */
async function comSessao() {
  const c = await cenario("pr");
  const r = await c.pedir(PR, { metodo: "POST", corpo: { aprovado: false, motivo: "cobertura abaixo do combinado" } });
  assert.equal(r.status, 200);
  // Com o pi já de pé, a mensagem vai a ele; antes disso o serviço recusaria a sessão ainda sem execução viva.
  await ate(async () => (await conversa(c)).includes("cobertura abaixo do combinado"));
  return { ...c, sessao: r.json<{ sessao: string }>().sessao };
}

const conversa = async ({ pedir }: Cenario) =>
  JSON.stringify((await pedir("/api/demandas/rodadas/I-206.R2/ajustes")).json<{ conversa: unknown[] }>().conversa);
async function ate(condicao: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 500 && !(await condicao()); i++) await dormir(20);
  assert.ok(await condicao(), "a condição não se cumpriu a tempo");
}

test("CA-22: reprovar o PR com motivo e sem nota abre a sessão de ajustes na hora, com o motivo", async () => {
  const c = await comSessao();
  assert.ok(c.sessao);
  assert.equal(rodada(c)?.fase, "sessao");
  assert.deepEqual(
    c.ag().decisoes.map((d) => [d.resultado, d.motivo, d.nota]),
    [["recusado", "cobertura abaixo do combinado", undefined]],
  );
  await concluirSessao(c, 9);
});

test("CA-23: reprovar o PR sem motivo pede o motivo e a sessão não abre", async () => {
  const c = await cenario("pr");
  const r = await c.pedir(PR, { metodo: "POST", corpo: { aprovado: false, motivo: "  " } });
  assert.equal(r.status, 422);
  assert.match(erro(r), /informe o motivo da reprovação do PR/);
  assert.equal(rodada(c)?.fase, "aprovacao_pull_request");
});

test("CA-24: reprovar o PR com motivo e nota diz que a reprovação não leva nota e a rodada não muda", async () => {
  const c = await cenario("pr");
  const r = await c.pedir(PR, { metodo: "POST", corpo: { aprovado: false, motivo: "m", nota: 3 } });
  assert.equal(r.status, 422);
  assert.match(erro(r), /a reprovação não leva nota/);
  assert.equal(rodada(c)?.fase, "aprovacao_pull_request");
});

const MENSAGENS = "/api/demandas/rodadas/I-206.R2/ajustes/mensagens";

test("CA-25: as mensagens do Auditor aparecem na conversa da sessão, na ordem em que foram enviadas", async () => {
  const c = await comSessao();
  for (const texto of ["troque o nome da função", "e rode os testes"]) {
    const r = await c.pedir(MENSAGENS, { metodo: "POST", corpo: { texto } });
    assert.equal(r.status, 204);
  }
  await ate(async () => (await conversa(c)).includes("e rode os testes"));
  const texto = await conversa(c);
  assert.ok(texto.indexOf("troque o nome da função") < texto.indexOf("e rode os testes"));
  await concluirSessao(c, 9);
});

test("CA-26: mensagem vazia é recusada e a conversa não muda", async () => {
  const c = await comSessao();
  const antes = await conversa(c);
  for (const corpo of [{ texto: "  " }, {}]) {
    const r = await c.pedir(MENSAGENS, { metodo: "POST", corpo });
    assert.equal(r.status, 422);
    assert.match(erro(r), /informe o texto da mensagem/);
  }
  assert.equal(await conversa(c), antes);
  await concluirSessao(c, 9);
});

test("CA-27: concluir a sessão a deixa concluída e ela não aceita mais mensagens", async () => {
  const c = await comSessao();
  const r = await concluirSessao(c, 9);
  assert.equal(r.status, 200);
  assert.equal(rodada(c)?.fase, "desenvolvimento");
  assert.equal(c.ag().tickets.find((t) => t.ticket_id === 9)?.status, "concluido");
  const depois = await c.pedir(MENSAGENS, { metodo: "POST", corpo: { texto: "mais uma" } });
  assert.equal(depois.status, 409);
  assert.match(erro(depois), /não tem sessão de ajustes aberta/);
});

test("a mensagem é recusada se o ticket da sessão não está ativo", async () => {
  const c = await comSessao();
  c.banco.exec("UPDATE ticket_demanda SET status = 'falhou' WHERE ticket_id = 9");
  const r = await c.pedir(MENSAGENS, { metodo: "POST", corpo: { texto: "oi" } });
  assert.equal(r.status, 409);
  c.banco.exec("UPDATE ticket_demanda SET status = 'aberto' WHERE ticket_id = 9");
  await concluirSessao(c, 9);
});

test("a rodada sem sessão de ajustes é recusada e o endereço precisa ser de rodada", async () => {
  const c = await cenario("pr");
  const sem = await c.pedir("/api/demandas/rodadas/I-206.R2/ajustes");
  assert.equal(sem.status, 409);
  assert.match(erro(sem), /I-206\.R2 não tem sessão de ajustes/);
  c.banco.exec("UPDATE ticket_demanda SET etapa = 'sessao_em_aberto' WHERE ticket_id = 3");
  const semConversa = await c.pedir("/api/demandas/rodadas/I-206.R2/ajustes");
  assert.equal(semConversa.status, 409);
  assert.match(erro(semConversa), /ainda não tem conversa/);
  const ticket = await c.pedir("/api/demandas/rodadas/I-206.T3/pr", {
    metodo: "POST",
    corpo: { aprovado: true, nota: 4 },
  });
  assert.equal(ticket.status, 409);
  assert.match(erro(ticket), /I-206\.T3 não é uma rodada/);
});

test("CA-36: decisão de outra origem recebe 403 e a demanda não muda", async () => {
  const { pedir, fase } = await cenario("demanda");
  const r = await pedir("/api/demandas/I-206/decisao", {
    metodo: "POST",
    corpo: { aprovado: true },
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(r.status, 403);
  assert.equal(fase(), "aprovacao_demanda");
});
