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
import { submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { criarSessao, iniciarExecucao } from "../dominio/sessoes.ts";
import { abrir } from "../persistencia/banco.ts";
import { comDemanda, criarDemanda } from "../persistencia/demandas.ts";
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
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`,
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

/** Demanda I-206 em `fase`, rodada 2 em `faseRodada`, e a execução `exec-9` aberta no ticket 9 (de `etapa`, da rodada 2 se `naRodada`). */
function cenarioDeRevisao(fase: string, faseRodada: string, etapa: string, naRodada = true) {
  const { banco, env } = cenario();
  banco.prepare("UPDATE demanda SET fase = ?").run(fase);
  banco.prepare("UPDATE rodada SET fase = ?").run(faseRodada);
  banco
    .prepare(
      `INSERT INTO ticket_demanda (demanda_id, ticket_id, rodada_id, etapa, status, status_alterado_em, devolucoes)
       VALUES ('I-206', 9, ?, ?, 'aberto', ?, 0)`,
    )
    .run(naRodada ? 2 : null, etapa, em);
  banco.prepare("UPDATE ticket_demanda SET status = 'concluido' WHERE ticket_id IN (1, 3, 4)").run();
  abrirExecucao(banco, "exec-9", 9);
  return { banco, env: { ...env, FABRIQUINHA_EXECUCAO: "exec-9" } };
}

const COMPROVACAO = { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] };
const EVIDENCIAS_RODADA: [string, object][] = [
  ["arquivos_alterados", { base: "a", head: "b", arquivos: [], previstosNaoTocados: [] }],
  ["matriz_fitness", { linhas: [{ nome: "f", comando: "c", codigoSaida: 0, log: "f.log" }] }],
  ["explicacao_fitness", { explicacoes: [] }],
  ["comprovacao_criterios", COMPROVACAO],
];
const EVIDENCIAS_INTEGRAL: [string, object][] = [
  ["comprovacao_criterios", COMPROVACAO],
  [
    "testes_estresse",
    {
      aplicavel: true,
      justificativa: "",
      cenarios: [{ nome: "n", objetivo: "o", comando: "c", resultado: "passou", observado: "ok" }],
    },
  ],
  [
    "analise_seguranca",
    { aplicavel: true, justificativa: "", ameacas: [{ descricao: "d", mitigacao: "m" }], achados: [] },
  ],
];

/** Submete ao ticket as evidências que o serviço de Revisão confere na aprovação. */
function evidenciar(banco: DatabaseSync, ticket_id: number, lista: [string, object][]) {
  comDemanda(banco, "I-206", (ag) =>
    lista.reduce(
      (a, [tipo, dados]) =>
        submeterEvidenciaDemanda(
          a,
          { tipo, dados, ticket_id } as never,
          { ferramenta: a.demanda.origem_ferramenta, sessao: a.demanda.origem_sessao },
          em,
        ),
      ag,
    ),
  );
}

const lerDemanda = async (env: NodeJS.ProcessEnv) =>
  JSON.parse((await cli(env, ["demanda", "ver", "I-206"])).out) as {
    rodadas: { rodada: string; fase: string }[];
    tickets: { ticket: string; status: string; etapa: string }[];
    decisoes: { ticket: string; rodada?: string; resultado: string; motivo?: string; por: string; em: string }[];
  };

test("CA-10: aprovar a revisão de rodada registra a decisão na rodada e a leitura mostra", async () => {
  const { banco, env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  evidenciar(banco, 9, EVIDENCIAS_RODADA);
  const s = await cli(env, ["revisao", "decidir", "I-206.T9", "aprovar"]);
  assert.equal(s.err, "");
  assert.deepEqual(JSON.parse(s.out), { ticket: "I-206.T9", rodada: "I-206.R2", resultado: "aprovado" });
  const lida = await lerDemanda(env);
  assert.equal(lida.rodadas[0]?.fase, "encerramento");
  assert.equal(lida.tickets.find((t) => t.ticket === "I-206.T9")?.status, "concluido");
  assert.equal(banco.prepare("SELECT resultado FROM decisao_ticket WHERE ticket_id = 9").get()?.resultado, "aprovado");
  const decisao = lida.decisoes[0];
  assert.deepEqual(
    [decisao?.ticket, decisao?.rodada, decisao?.resultado, decisao?.por],
    ["I-206.T9", "I-206.R2", "aprovado", "agente"],
  );
  assert.ok(decisao?.em);
});

test("CA-10: aprovar a revisão de rodada sem evidências lista as quatro ausentes e a rodada segue em revisao", async () => {
  const { env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  const s = await cli(env, ["revisao", "decidir", "I-206.T9", "aprovar"]);
  assert.equal(s.codigo, 1);
  for (const t of EVIDENCIAS_RODADA) assert.match(s.err, new RegExp(`${t[0]} ausente`));
  assert.equal((await lerDemanda(env)).rodadas[0]?.fase, "revisao");
});

test("CA-9 e CA-11: a revisão integral exige as três evidências e, com elas, vai a encerramento", async () => {
  const { banco, env } = cenarioDeRevisao("revisao_demanda", "concluida", "revisar_demanda", false);
  const sem = await cli(env, ["revisao", "decidir", "I-206.T9", "aprovar"]);
  assert.equal(sem.codigo, 1);
  for (const t of EVIDENCIAS_INTEGRAL) assert.match(sem.err, new RegExp(`${t[0]} ausente`));
  evidenciar(banco, 9, EVIDENCIAS_INTEGRAL);
  const s = await cli(env, ["revisao", "decidir", "I-206.T9", "aprovar"]);
  assert.equal(s.err, "");
  assert.deepEqual(JSON.parse(s.out), { ticket: "I-206.T9", resultado: "aprovado" });
  assert.equal(banco.prepare("SELECT fase FROM demanda").get()?.fase, "encerramento");
});

test("revisão de rodada reprovada completa as correções com demanda, rodada e ticket local", async () => {
  const { env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  const correcoes = JSON.stringify([{ titulo: "a", descricao: "b" }]);
  const s = await cli(env, [
    "revisao",
    "decidir",
    "I-206.T9",
    "reprovar",
    "--motivo",
    "falta",
    "--correcoes",
    correcoes,
  ]);
  assert.equal(s.err, "");
  assert.equal((JSON.parse(s.out) as { resultado: string }).resultado, "recusado");
  const lida = await lerDemanda(env);
  assert.equal(lida.rodadas[0]?.fase, "desenvolvimento");
  assert.equal(lida.tickets.filter((t) => t.etapa === "implementar").length, 3);
});

test("CA-11: reprovar a revisão integral registra a decisão com o motivo", async () => {
  const { banco, env } = cenarioDeRevisao("revisao_demanda", "concluida", "revisar_demanda", false);
  const plano = {
    demanda_id: "I-206",
    criterios: [],
    rodadas: [{ demanda_id: "I-206", rodada_id: 1, titulo: "corrige", e2e: false }],
    tickets: [{ demanda_id: "I-206", ticket_id: 1, rodada_id: 1, titulo: "t", descricao: "d" }],
  };
  const s = await cli(env, [
    "revisao",
    "decidir",
    "I-206.T9",
    "reprovar",
    "--motivo",
    "falta",
    "--plano",
    JSON.stringify(plano),
  ]);
  assert.equal(s.err, "");
  assert.deepEqual(JSON.parse(s.out), { ticket: "I-206.T9", resultado: "recusado" });
  assert.equal(banco.prepare("SELECT motivo FROM decisao_ticket WHERE ticket_id = 9").get()?.motivo, "falta");
  const lida = await lerDemanda(env);
  assert.equal(lida.rodadas.length, 2);
  const decisao = lida.decisoes[0];
  assert.deepEqual(
    [decisao?.ticket, decisao?.rodada, decisao?.resultado, decisao?.motivo],
    ["I-206.T9", undefined, "recusado", "falta"],
  );
});

test("CA-12: veredito fora de aprovar|reprovar diz as duas formas e não grava", async () => {
  const { banco, env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  const s = await cli(env, ["revisao", "decidir", "I-206.T9", "talvez"]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /aprovar ou reprovar/);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM decisao_ticket").get()?.n, 0);
});

test("revisão: opções que faltam ou sobram, JSON inválido, ticket alheio e ticket que não é de revisão", async () => {
  const { env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  const rodar = async (...a: string[]) => (await cli(env, ["revisao", "decidir", ...a])).err;
  assert.match(await rodar("I-206.T9", "reprovar"), /reprovar exige --motivo/);
  assert.match(await rodar("I-206.T9", "reprovar", "--motivo", "m"), /reprovar exige --correcoes/);
  assert.match(await rodar("I-206.T9", "reprovar", "--motivo", "m", "--correcoes", "{"), /--correcoes não é um JSON/);
  assert.match(await rodar("I-206.T9", "reprovar", "--motivo", "m", "--correcoes", "{}"), /vetor/);
  assert.match(await rodar("I-206.T9", "aprovar", "--motivo", "m"), /aprovar não leva/);
  assert.match(await rodar("I-206.T4", "aprovar"), /só age no próprio ticket/);
  assert.match(await rodar("T-9", "aprovar"), /I-206\.T9/);
  const outro = cenario();
  assert.match(
    (await cli(outro.env, ["revisao", "decidir", "I-206.T3", "aprovar"])).err,
    /não é de revisão|é de implementar/,
  );
});

test("revisão: correções por stdin com -", async () => {
  const { env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  let out = "";
  const codigo = await principal(["revisao", "decidir", "I-206.T9", "reprovar", "--motivo", "m", "--correcoes", "-"], {
    env,
    stdin: Readable.from([JSON.stringify([{ titulo: "a", descricao: "b" }])]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: () => true },
    parada: () => Promise.resolve(),
  });
  assert.equal(codigo, 0, out);
});

test("revisão com a execução terminada não grava", async () => {
  const { banco, env } = cenarioDeRevisao("execucao", "revisao", "revisar_rodada");
  banco.prepare("UPDATE execucao_sessao SET fim = ? WHERE id = 'exec-9'").run(em);
  const s = await cli(env, ["revisao", "decidir", "I-206.T9", "aprovar"]);
  assert.match(s.err, /já terminou/);
});

test("CA-13 e CA-14: ticket criar na sessão de ajustes cria o corretivo; sem título não cria", async () => {
  const { env } = cenarioDeRevisao("execucao", "sessao", "sessao_em_aberto");
  const sem = await cli(env, ["ticket", "criar", "I-206.R2"]);
  assert.deepEqual([sem.codigo, sem.out], [1, ""]);
  assert.match(sem.err, /falta o título/);
  const s = await cli(env, ["ticket", "criar", "I-206.R2", "--titulo", "Corrigir"]);
  assert.equal(s.err, "");
  assert.deepEqual(JSON.parse(s.out), { rodada: "I-206.R2", tickets: ["I-206.T10"] });
  assert.ok((await lerDemanda(env)).tickets.some((t) => t.ticket === "I-206.T10"));
});

test("ticket criar recusa endereço que não é de rodada", async () => {
  const { env } = cenarioDeRevisao("execucao", "sessao", "sessao_em_aberto");
  for (const a of ["I-206.T9", "T-9"]) {
    const s = await cli(env, ["ticket", "criar", a, "--titulo", "x"]);
    assert.match(s.err, /I-206\.R2/);
  }
});

test("ticket criar recusa rodada de outra demanda sem gravar e mostra a rodada do próprio ticket", async () => {
  const { env } = cenarioDeRevisao("execucao", "sessao", "sessao_em_aberto");
  const antes = (await lerDemanda(env)).tickets.length;
  const s = await cli(env, ["ticket", "criar", "I-999.R2", "--titulo", "Corretivo de outra demanda"]);
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /I-999\.R2 é de outra demanda.*I-206\.R2/s);
  assert.equal((await lerDemanda(env)).tickets.length, antes);
});
