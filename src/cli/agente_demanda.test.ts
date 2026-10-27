// CLI do agente da demanda contra banco real numa raiz temporária (CA-1, CA-2, CA-3, CA-15): demanda I-206 com três
// tickets, o T3 em execução; os comandos rodam pelo `principal`, como o agente os chama.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

const base = mkdtempSync(join(tmpdir(), "fabriquinha-agente-demanda-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const em = "2026-01-01T00:00:00.000Z";

/** Projeto `loja`, demanda I-206 com T1 (planejar), T3 e T4 (implementar, rodada 2) e a execução `exec-3` aberta no T3. */
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
    status: "aberto",
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
      fase: "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    rodadas: [
      {
        demanda_id: "I-206",
        rodada_id: 2,
        titulo: "r2",
        fase: "desenvolvimento",
        e2e: false,
        branch: "fabriquinha/I-206-2",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(1, "planejar"),
      ticket(3, "implementar", { rodada_id: 2 }),
      ticket(4, "implementar", { rodada_id: 2 }),
    ],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-206",
        ticket_id: 3,
        tipo: "comprovacao_criterios",
        em,
        dados: { criterios: [{ atendido: false }] },
      },
    ],
  } as unknown as AgregadoDemanda);
  abrirExecucao(banco, "exec-3", 3);
  return { banco, env: { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "exec-3" } };
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

async function cli(env: NodeJS.ProcessEnv, args: string[]) {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([""]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

test("CA-1: ticket ver do próprio ticket é uma linha JSON com o endereço, a etapa e o status", async () => {
  const { env } = cenario();
  const s = await cli(env, ["ticket", "ver", "I-206.T3"]);
  assert.equal(s.codigo, 0);
  assert.equal(s.err, "");
  assert.match(s.out, /^[^\n]+\n$/);
  assert.deepEqual(JSON.parse(s.out), {
    ticket: "I-206.T3",
    rodada: "I-206.R2",
    etapa: "implementar",
    status: "aberto",
    status_alterado_em: em,
    devolucoes: 0,
  });
});

test("CA-2: demanda ver mostra a demanda, a rodada e os tickets pelo endereço, e a aprovada só do próprio ticket", async () => {
  const { env } = cenario();
  const s = await cli(env, ["demanda", "ver", "I-206"]);
  assert.equal(s.codigo, 0);
  const lida = JSON.parse(s.out) as {
    demanda: { id: string };
    rodadas: { rodada: string }[];
    tickets: { ticket: string; evidencias?: unknown }[];
  };
  assert.equal(lida.demanda.id, "I-206");
  assert.deepEqual(
    lida.rodadas.map((r) => r.rodada),
    ["I-206.R2"],
  );
  assert.deepEqual(
    lida.tickets.map((t) => t.ticket),
    ["I-206.T1", "I-206.T3", "I-206.T4"],
  );
  assert.deepEqual(
    lida.tickets.map((t) => t.evidencias),
    [undefined, [{ tipo: "comprovacao_criterios", em, aprovada: false }], undefined],
  );
});

test("demanda ver: evidência sem schema no tipo (custos_realizados, plano) sai sem aprovada", async () => {
  const { banco, env } = cenario();
  banco
    .prepare(
      "INSERT INTO evidencia_demanda (demanda_id, ticket_id, tipo, dados, em) VALUES ('I-206', 3, 'custos_realizados', '{}', ?), ('I-206', 3, 'plano', '{}', ?)",
    )
    .run(em, em);
  const lida = JSON.parse((await cli(env, ["demanda", "ver", "I-206"])).out) as {
    tickets: { evidencias?: { tipo: string; aprovada?: boolean }[] }[];
  };
  assert.deepEqual(
    lida.tickets[1]?.evidencias?.map((e) => e.aprovada),
    [false, undefined, undefined],
  );
});

test("CA-3: ler o ticket de outro, ou outra demanda, é recusado sem saída", async () => {
  const { env } = cenario();
  for (const args of [
    ["ticket", "ver", "I-206.T4"],
    ["ticket", "ver", "I-207.T3"],
  ]) {
    const s = await cli(env, args);
    assert.deepEqual([s.codigo, s.out], [1, ""]);
    assert.equal(s.err, "o agente só lê o próprio ticket (leia I-206.T3)\n");
  }
  const outra = await cli(env, ["demanda", "ver", "I-207"]);
  assert.deepEqual(
    [outra.codigo, outra.out, outra.err],
    [1, "", "o agente só lê a própria demanda (leia I-206, a do seu ticket I-206.T3)\n"],
  );
});

test("CA-15: T-3, rodada e demanda malformada mostram o endereço certo e não leem nada", async () => {
  const { env } = cenario();
  for (const args of [
    ["ticket", "ver", "T-3"],
    ["ticket", "ver", "I-206.R2"],
    ["demanda", "ver", "T-3"],
  ]) {
    const s = await cli(env, args);
    assert.deepEqual([s.codigo, s.out], [1, ""]);
    assert.match(s.err, /^[^\n]+I-206\.T3[^\n]*\n$/);
  }
});

test("projeto ver devolve o projeto da demanda do agente", async () => {
  const { env } = cenario();
  const s = await cli(env, ["projeto", "ver"]);
  assert.equal(s.err, "");
  assert.equal((JSON.parse(s.out) as { nome: string }).nome, "loja");
});

test("execução terminada: ErroDeEscopo já terminou; comando legado da demanda é desconhecido", async () => {
  const { banco, env } = cenario();
  banco.prepare("UPDATE execucao_sessao SET fim = ? WHERE id = 'exec-3'").run(em);
  const s = await cli(env, ["ticket", "ver", "I-206.T3"]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.equal(s.err, "a execução exec-3 já terminou (peça ao Auditor uma nova execução)\n");
});

test("agente da demanda: comando fora da tabela da demanda é uso inválido; a ajuda mostra a seção da demanda", async () => {
  const { env } = cenario();
  const s = await cli(env, ["servidor"]);
  assert.equal(s.codigo, 2);
  const ajuda = await cli(env, ["--help"]);
  assert.match(ajuda.out, /Agente de uma execução da demanda/);
  assert.match(ajuda.out, /fabriquinha demanda ver I-<n>/);
  assert.doesNotMatch(ajuda.out, /implementa/i);
  const grupo = await cli(env, ["demanda", "--help"]);
  assert.doesNotMatch(grupo.out, /fabriquinha (ticket|issue)/);
});
