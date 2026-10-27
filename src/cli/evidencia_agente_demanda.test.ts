// evidencia schema/add do agente da demanda contra banco real numa raiz temporária (CA-4 a CA-9, CA-15): I-206 em
// planejamento, com o planejar (T1) e a revisão integral (T5) em execução, e o T3/T4 de implementação.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { criarSessao, iniciarExecucao } from "../dominio/sessoes.ts";
import { abrir } from "../persistencia/banco.ts";
import { criarDemanda } from "../persistencia/demandas.ts";
import { comSessoesDoTicket } from "../persistencia/sessoes.ts";
import { principal } from "./cli.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-evidencia-demanda-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const em = "2026-01-01T00:00:00.000Z";

const PLANO = {
  demanda_id: "I-206",
  criterios: ["CA-1"],
  rodadas: [{ demanda_id: "I-206", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
  tickets: [
    { demanda_id: "I-206", ticket_id: 1, rodada_id: 1, titulo: "t", descricao: "d", caminhos: [], depende: [] },
  ],
};
const ESTRESSE = {
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "npm test", resultado: "passou", observado: "ok" }],
};
const SEGURANCA = {
  aplicavel: true,
  ameacas: [{ descricao: "injeção", mitigacao: "parâmetros" }],
  achados: [{ descricao: "a", severidade: "baixa", recomendacao: "m" }],
};

function cenario() {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const banco = abrir(raiz);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('loja', '/repos/loja', 'main', 'github', '["t"]', 'k', '[{"nome":"f","comando":"c","descricao":"d"}]')`,
    )
    .run();
  const ticket = (ticket_id: number, etapa: string, extra: object = {}) => ({
    demanda_id: "I-206",
    ticket_id,
    etapa,
    status: "em_execucao",
    status_alterado_em: em,
    devolucoes: 0,
    ...extra,
  });
  criarDemanda(banco, {
    demanda: {
      id: "I-206",
      projeto: "loja",
      titulo: "Busca",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "planejamento",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [ticket(1, "planejar"), ticket(4, "implementar"), ticket(5, "revisar_demanda")],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [{ demanda_id: "I-206", tipo: "criterios_aceite", em, dados: { criterios: [{ id: "CA-1" }] } }],
  } as unknown as AgregadoDemanda);
  for (const t of [1, 4, 5]) abrirExecucao(banco, `exec-${String(t)}`, t);
  return { raiz, banco, env: (t: number) => ({ FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: `exec-${String(t)}` }) };
}

function abrirExecucao(banco: DatabaseSync, id: string, ticket_id: number): void {
  comSessoesDoTicket(banco, { demanda_id: "I-206", ticket_id }, (e) => {
    const sessoes = criarSessao(e.sessoes, {
      id: `s-${id}`,
      demanda_id: "I-206",
      ticket_id,
      modo: "autonomo",
      conversa_referencia: `s-${id}`,
    });
    return {
      ...e,
      sessoes,
      execucoes: iniciarExecucao(sessoes, e.execucoes, { id, sessao_id: `s-${id}`, inicio: em, falha: false }),
    };
  });
}

async function cli(env: NodeJS.ProcessEnv, args: string[], stdin = "") {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([stdin]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

const gravadas = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT ticket_id, tipo FROM evidencia_demanda WHERE tipo <> 'criterios_aceite'")
    .all()
    .map((l) => ({ ...l }));

function json(raiz: string, dados: unknown): string {
  const arquivo = join(raiz, `dados-${String(Math.random())}.json`);
  writeFileSync(arquivo, JSON.stringify(dados));
  return arquivo;
}

test("CA-6: o plano válido fica registrado e a leitura da demanda o mostra", async () => {
  const { raiz, banco, env } = cenario();
  const s = await cli(env(1), ["evidencia", "add", "I-206.T1", "plano", "--dados", json(raiz, PLANO)]);
  assert.deepEqual([s.codigo, s.err], [0, ""]);
  assert.deepEqual(JSON.parse(s.out), { ticket: "I-206.T1", tipo: "plano" });
  assert.deepEqual(gravadas(banco), [{ ticket_id: 1, tipo: "plano" }]);
  const lida = JSON.parse((await cli(env(1), ["demanda", "ver", "I-206"])).out) as {
    demanda: { fase: string };
    tickets: { evidencias?: { tipo: string }[] }[];
  };
  assert.equal(lida.demanda.fase, "aprovacao_planejamento");
  assert.deepEqual(
    lida.tickets[0]?.evidencias?.map((e) => e.tipo),
    ["plano"],
  );
});

test("CA-7: plano com campo inválido não grava e o erro aponta o caminho do campo", async () => {
  const { raiz, banco, env } = cenario();
  const s = await cli(env(1), [
    "evidencia",
    "add",
    "I-206.T1",
    "plano",
    "--dados",
    json(raiz, { ...PLANO, criterios: "CA-1" }),
  ]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /^[^\n]*dados\.criterios[^\n]*\n$/);
  assert.deepEqual(gravadas(banco), []);
});

test("CA-8: testes_estresse válido, com --dados do stdin e com anexo da saída, fica no ticket com aprovada", async () => {
  const { raiz, banco, env } = cenario();
  const sem = await cli(
    env(5),
    ["evidencia", "add", "I-206.T5", "testes_estresse", "--dados", "-"],
    JSON.stringify(ESTRESSE),
  );
  assert.deepEqual([sem.codigo, sem.err], [0, ""]);
  assert.deepEqual(JSON.parse(sem.out), { ticket: "I-206.T5", tipo: "testes_estresse", aprovada: true });
  const saida = join(raiz, "execucoes", "E-exec-5", "saida");
  mkdirSync(saida, { recursive: true });
  const log = join(saida, "estresse.log");
  writeFileSync(log, "tudo certo\n");
  const com = await cli(env(5), [
    "evidencia",
    "add",
    "I-206.T5",
    "testes_estresse",
    "--dados",
    json(raiz, ESTRESSE),
    "--arquivo",
    log,
  ]);
  assert.deepEqual([com.codigo, com.err], [0, ""]);
  assert.deepEqual(gravadas(banco), [{ ticket_id: 5, tipo: "testes_estresse" }]);
  assert.deepEqual(
    banco
      .prepare("SELECT caminho, mime FROM arquivo_evidencia")
      .all()
      .map((a) => ({ ...a })),
    [{ caminho: "estresse.log", mime: "text/plain; charset=utf-8" }],
  );
  const lida = JSON.parse((await cli(env(5), ["demanda", "ver", "I-206"])).out) as {
    tickets: { ticket: string; evidencias?: unknown[] }[];
  };
  assert.equal(lida.tickets.find((t) => t.ticket === "I-206.T5")?.evidencias?.length, 1);
});

test("CA-9: analise_seguranca com campo inválido não grava e o erro aponta o caminho", async () => {
  const { raiz, banco, env } = cenario();
  const ruim = { ...SEGURANCA, achados: [{ descricao: "a", severidade: "enorme", recomendacao: "m" }] };
  const s = await cli(env(5), ["evidencia", "add", "I-206.T5", "analise_seguranca", "--dados", json(raiz, ruim)]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /^[^\n]*dados\.achados\[0\]\.severidade[^\n]*\n$/);
  assert.deepEqual(gravadas(banco), []);
  const ok = await cli(env(5), ["evidencia", "add", "I-206.T5", "analise_seguranca", "--dados", json(raiz, SEGURANCA)]);
  assert.equal((JSON.parse(ok.out) as { aprovada: boolean }).aprovada, true);
});

test("CA-4 e CA-15: ticket alheio, T-5 e rodada não gravam nada e mostram a forma certa", async () => {
  const { raiz, banco, env } = cenario();
  const dados = json(raiz, ESTRESSE);
  const alheio = await cli(env(5), ["evidencia", "add", "I-206.T4", "testes_estresse", "--dados", dados]);
  assert.deepEqual([alheio.codigo, alheio.out], [1, ""]);
  assert.equal(alheio.err, "o agente só age no próprio ticket (aja em I-206.T5)\n");
  for (const ref of ["T-5", "I-206.R1"]) {
    const s = await cli(env(5), ["evidencia", "add", ref, "testes_estresse", "--dados", dados]);
    assert.deepEqual([s.codigo, s.out], [1, ""]);
    assert.match(s.err, /I-206\.T5/);
  }
  assert.deepEqual(gravadas(banco), []);
});

test("CA-5: execução terminada, ticket já concluído e execução inexistente não gravam nada", async () => {
  const { raiz, banco, env } = cenario();
  const dados = json(raiz, ESTRESSE);
  const args = ["evidencia", "add", "I-206.T5", "testes_estresse", "--dados", dados];
  banco.prepare("UPDATE ticket_demanda SET status = 'concluido' WHERE ticket_id = 5").run();
  const concluido = await cli(env(5), args);
  assert.equal(concluido.err, "o ticket I-206.T5 está concluido e não recebe evidência (siga com o seu ticket)\n");
  banco.prepare("UPDATE execucao_sessao SET fim = ? WHERE id = 'exec-5'").run(em);
  const s = await cli(env(5), args);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.equal(s.err, "a execução exec-5 já terminou (peça ao Auditor uma nova execução)\n");
  assert.deepEqual(gravadas(banco), []);
});

test("tipo que o agente não submete, ou de outra etapa, é recusado", async () => {
  const { raiz, env } = cenario();
  const dados = json(raiz, ESTRESSE);
  const outro = await cli(env(5), ["evidencia", "add", "I-206.T5", "pr_aberto", "--dados", dados]);
  assert.equal(
    outro.err,
    "pr_aberto não é evidência que o agente submete (use um de plano, testes_estresse, analise_seguranca)\n",
  );
  const etapa = await cli(env(4), ["evidencia", "add", "I-206.T4", "plano", "--dados", json(raiz, PLANO)]);
  assert.match(etapa.err, /T-4 \(implementar\) não aceita evidência plano/);
});

test("--dados ausente ou que não é JSON é recusado", async () => {
  const { raiz, env } = cenario();
  const falta = await cli(env(5), ["evidencia", "add", "I-206.T5", "testes_estresse"]);
  assert.equal(falta.err, "falta --dados (passe --dados <arquivo.json|->)\n");
  const ruim = join(raiz, "ruim.json");
  writeFileSync(ruim, "{");
  const s = await cli(env(5), ["evidencia", "add", "I-206.T5", "testes_estresse", "--dados", ruim]);
  assert.match(s.err, /ruim\.json não é um JSON válido/);
});

test("anexo fora da worktree e da saída é recusado sem gravar", async () => {
  const { raiz, banco, env } = cenario();
  const fora = join(raiz, "fora.log");
  writeFileSync(fora, "x");
  const s = await cli(env(5), [
    "evidencia",
    "add",
    "I-206.T5",
    "testes_estresse",
    "--dados",
    json(raiz, ESTRESSE),
    "--arquivo",
    fora,
  ]);
  assert.match(s.err, /está fora da worktree do ticket e do diretório de saída/);
  assert.deepEqual(gravadas(banco), []);
});

test("evidencia schema devolve o JSON Schema e as regras de arquivo; tipo desconhecido é recusado", async () => {
  const { env } = cenario();
  const s = await cli(env(5), ["evidencia", "schema", "testes_estresse"]);
  const lido = JSON.parse(s.out) as { dados: { properties: object }; arquivos: { classes: string[] } };
  assert.ok("cenarios" in lido.dados.properties);
  assert.deepEqual(lido.arquivos.classes, ["texto"]);
  const ruim = await cli(env(5), ["evidencia", "schema", "nada"]);
  assert.match(ruim.err, /nada não é evidência que o agente submete/);
});
