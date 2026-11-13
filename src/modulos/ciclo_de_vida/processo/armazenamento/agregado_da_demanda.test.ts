import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { AgregadoDemanda } from "../nucleo/agregado/agregado_demanda.ts";
import type { Decisao } from "../nucleo/gate.ts";
import type { EvidenciaDemanda } from "../../evidencias/publico.ts";
import { Ator } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import type { ResultadoDaTentativa } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import type { ProgressoEncerramento } from "../nucleo/progresso_do_encerramento.ts";
import { ErroDeInexistente } from "../../../compartilhado/nucleo/erros.ts";
import { registrarDemanda } from "../nucleo/transicoes/transicoes_demanda.ts";
import { escrever } from "../../../compartilhado/armazenamento/banco.ts";
import {
  carregarDemanda,
  carregarDemandas,
  comDemanda,
  listarDemandas,
  situacaoDasDemandas,
} from "./agregado_da_demanda.ts";
import {
  criarDemandaNova,
  gravarAgregadoPronto,
  comEvidencia,
} from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";

const em = "2026-01-01T00:00:00.000Z";
const ticket = (ticket_id: number, rodada_id?: number) => ({
  demanda_id: "I-1",
  ticket_id,
  etapa: "implementar" as const,
  estado: "aberto" as const,
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" as const },
  ...(rodada_id === undefined ? {} : { rodada_id }),
});
// Sem as chaves de dono ausentes: é assim que o carregamento devolve a evidência (campo omitido).
const evidencia = (dono: { rodada_id?: number; ticket_id?: number }, tipo: EvidenciaDemanda["tipo"], dados = {}) =>
  ({ demanda_id: "I-1", ...dono, tipo, dados, autor: { tipo: "fabriquinha" }, em }) as EvidenciaDemanda;
const decisao = (extra: Partial<Decisao>): Decisao => ({
  demanda_id: "I-1",
  ticket_id: 1,
  decisao_id: 1,
  gate: "gate_demanda",
  resultado: "aprovado",
  por: { tipo: "agente", trabalho_id: "exec-1" },
  em,
  ...extra,
});
const rodada = (rodada_id: number) => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  estado: "implementar" as const,
  estado_alterado_em: em,
  e2e: rodada_id === 1,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});

const pr = (rodada_id: number | undefined, estado: "aberto" | "integrado") => ({
  ...(rodada_id !== undefined && { rodada_id }),
  numero: rodada_id ?? 99,
  url: `https://x/pr/${String(rodada_id ?? 99)}`,
  head: "abc123",
  estado,
  atualizado_em: em,
});

// Rodada 1 com os tickets 1 e 2, rodada 2 com o 3, e o ticket 4 de demanda, sem rodada.
const completo = (): AgregadoDemanda => ({
  demanda: {
    id: "I-1",
    projeto: "p",
    titulo: "t",
    tipo: "funcionalidade",
    descricao: "d",
    estado: "em_execucao",
    estado_alterado_em: em,
    criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
    enviada: true,
    branch: "fabriquinha/I-1",
  },
  rodadas: [rodada(1), rodada(2)],
  pull_requests: [pr(1, "aberto"), pr(2, "integrado")],
  dependencias_rodada: [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }],
  criterios_citados: [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }],
  tickets: [
    {
      ...ticket(1, 1),
      titulo: "t1",
      descricao: "d1",
      configuracao_agente: { modelo: { provedor: "anthropic", nome: "m" }, effort: "high" },
      instrucao: "refaça",
    },
    ticket(2, 1),
    { ...ticket(3, 2), estado: "falhou" as const },
    { ...ticket(4), etapa: "entender_e_desenhar" },
  ],
  tentativas: [1, 2, 3].map((numero) => ({
    ticket: Endereco.doTicket("I-1", 3),
    numero,
    inicio: em,
    fim: em,
    resultado: { tipo: "reprovacao", motivo: "testes reprovaram" },
  })),
  dependencias_ticket: [{ demanda_id: "I-1", ticket_id: 2, depende_ticket_id: 1 }],
  caminhos_ticket: [{ demanda_id: "I-1", ticket_id: 1, caminho: "src/a.ts" }],
  arquivos_previstos_rodada: [{ demanda_id: "I-1", rodada_id: 1, caminho: "src/a.ts" }],
  arquivos_previstos_demanda: [
    { demanda_id: "I-1", caminho: "src/a.ts" },
    { demanda_id: "I-1", caminho: "src/b.ts" },
  ],
  versoes_plano: [
    {
      demanda_id: "I-1",
      numero: 1,
      origem: "aprovacao_do_planejamento",
      autor: { tipo: "fabriquinha" },
      criada_em: em,
      dados: { rodadas: [] },
    },
    {
      demanda_id: "I-1",
      numero: 2,
      origem: "revisao_rodada",
      autor: { tipo: "agente", trabalho_id: "E-revisor" },
      rodada_id: 1,
      criada_em: em,
      dados: { tickets_novos: [] },
    },
    {
      demanda_id: "I-1",
      numero: 3,
      origem: "conferencia_do_pr",
      autor: { tipo: "externo", ferramenta: "pi", sessao: "s1" },
      criada_em: em,
      dados: {},
    },
  ],
  decisoes: [
    decisao({ resultado: "reprovado", motivo: "m", por: { tipo: "auditor" } }),
    decisao({ decisao_id: 2, nota: 5 }),
  ],
  evidencias: [
    evidencia({}, "comportamento", { v: 1 }),
    evidencia({ rodada_id: 1 }, "comportamento", { v: 2 }),
    evidencia({ ticket_id: 2 }, "comportamento", { v: 3 }),
  ],
});

const banco = (): DatabaseSync => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  // O histórico e as migrações dos domínios, como a composição abre o banco.
  migrarBancoDaFabriquinha(b);
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  return b;
};

const comBase = (enviada = true) => {
  const b = banco();
  const ag = completo();
  gravarAgregadoPronto(b, {
    ...ag,
    demanda: { ...ag.demanda, enviada, estado: enviada ? "em_execucao" : "entender_e_desenhar" },
  });
  return b;
};

// A transição que o domínio recusaria: o repositório não revalida e o banco é a segunda barreira.
const recusa = (mudar: (ag: AgregadoDemanda) => Partial<AgregadoDemanda>) => {
  const b = comBase();
  const antes = carregarDemanda(b, "I-1");
  assert.throws(() => comDemanda(b, "I-1", (ag) => ({ ...ag, ...mudar(ag) })), /constraint/i);
  assert.deepEqual(carregarDemanda(b, "I-1"), antes);
  assert.equal(b.isTransaction, false);
};

test("CA-2: grava e carrega um agregado igual", () => {
  const b = banco();
  const ag = completo();
  gravarAgregadoPronto(b, ag);
  assert.deepEqual(carregarDemanda(b, "I-1"), ag);
});

test("Tentativas: todos os resultados, opcionais e processo voltam iguais, inclusive após atualizar e apagar", () => {
  const bancoDeTentativas = banco();
  const resultados: (ResultadoDaTentativa | undefined)[] = [
    { tipo: "sucesso" },
    { tipo: "reprovacao", motivo: "refaça" },
    { tipo: "falha_infraestrutura", causa: "cota", motivo: "cota esgotada" },
    { tipo: "interrompida", por: { tipo: "auditor" }, motivo: "pare" },
    { tipo: "interrompida", por: { tipo: "auditor" } },
    { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "exige Auditor" },
    undefined,
  ];
  const agregado = completo();
  agregado.tentativas = resultados.map((resultado, indice) => ({
    ticket: Endereco.doTicket("I-1", 1),
    numero: indice + 1,
    inicio: em,
    ...(resultado && { resultado, fim: em }),
    ...(indice === 0 && { migrada: true as const }),
    ...(indice === 4 && { instrucao: "retome com cuidado" }),
    ...(indice === 6 && { processo_id: "exec-aberta" }),
  }));
  gravarAgregadoPronto(bancoDeTentativas, agregado);
  assert.deepEqual(carregarDemanda(bancoDeTentativas, "I-1"), agregado);
  const colunas = bancoDeTentativas
    .prepare("SELECT resultado_tipo, causa, motivo, migrada, processo_id FROM tentativa ORDER BY numero")
    .all();
  assert.deepEqual(
    colunas.map((tentativa) => ({ ...tentativa })),
    [
      { resultado_tipo: "sucesso", causa: null, motivo: null, migrada: 1, processo_id: null },
      { resultado_tipo: "reprovacao", causa: null, motivo: "refaça", migrada: 0, processo_id: null },
      { resultado_tipo: "falha_infraestrutura", causa: "cota", motivo: "cota esgotada", migrada: 0, processo_id: null },
      { resultado_tipo: "interrompida", causa: "auditor", motivo: "pare", migrada: 0, processo_id: null },
      { resultado_tipo: "interrompida", causa: "auditor", motivo: null, migrada: 0, processo_id: null },
      { resultado_tipo: "interrompida", causa: "fabriquinha", motivo: "exige Auditor", migrada: 0, processo_id: null },
      { resultado_tipo: null, causa: null, motivo: null, migrada: 0, processo_id: "exec-aberta" },
    ],
  );
  const encerrado = comDemanda(bancoDeTentativas, "I-1", (agregado) => ({
    ...agregado,
    tentativas: agregado.tentativas.map((tentativa) =>
      tentativa.numero === 7 ? { ...tentativa, fim: em, resultado: { tipo: "sucesso" as const } } : tentativa,
    ),
  }));
  assert.deepEqual(carregarDemanda(bancoDeTentativas, "I-1"), encerrado);
  const apagado = comDemanda(bancoDeTentativas, "I-1", (agregado) => ({ ...agregado, tentativas: [] }));
  assert.deepEqual(carregarDemanda(bancoDeTentativas, "I-1"), apagado);
  assert.deepEqual(bancoDeTentativas.prepare("SELECT * FROM tentativa").all(), []);
  assert.deepEqual(bancoDeTentativas.prepare("PRAGMA foreign_key_check").all(), []);
});

test("interrupção com motivo indefinido grava NULL e aposGravar recebe o agregado persistido", () => {
  const bancoDeInterrupcao = comBase();
  let agregadoObservado: AgregadoDemanda | undefined;
  const atualizado = comDemanda(
    bancoDeInterrupcao,
    "I-1",
    (agregado) => ({
      ...agregado,
      tentativas: [
        {
          ticket: Endereco.doTicket("I-1", 1),
          numero: 1,
          inicio: em,
          fim: em,
          resultado: { tipo: "interrompida", por: { tipo: "auditor" }, motivo: undefined },
        },
      ],
    }),
    (agregado) => {
      agregadoObservado = agregado;
    },
  );
  assert.equal(agregadoObservado, atualizado);
  assert.equal(bancoDeInterrupcao.prepare("SELECT motivo FROM tentativa").get()?.motivo, null);
  assert.deepEqual(carregarDemanda(bancoDeInterrupcao, "I-1").tentativas[0]?.resultado, {
    tipo: "interrompida",
    por: { tipo: "auditor" },
  });
});

test("Tentativa aberta sem resultado permanece idêntica após recarregar", () => {
  const bancoDeTentativaAberta = banco();
  const agregado = completo();
  agregado.tentativas = [{ ticket: Endereco.doTicket("I-1", 1), numero: 1, inicio: em, processo_id: "exec-aberta" }];
  gravarAgregadoPronto(bancoDeTentativaAberta, agregado);
  assert.deepEqual(carregarDemanda(bancoDeTentativaAberta, "I-1"), agregado);
});

test("autoria: tickets, decisões e demanda preservam os atores na gravação e na atualização", () => {
  const bancoDeAutoria = banco();
  const agregado = completo();
  agregado.tickets = agregado.tickets.map((ticket) =>
    ticket.ticket_id === 2 ? { ...ticket, criado_por: { tipo: "agente", trabalho_id: "exec-criadora" } } : ticket,
  );
  gravarAgregadoPronto(bancoDeAutoria, agregado);
  const relido = carregarDemanda(bancoDeAutoria, "I-1");
  assert.deepEqual(relido, agregado);
  assert.deepEqual(
    relido.tickets.map((ticket) => Ator.parse(ticket.criado_por)),
    [
      { tipo: "fabriquinha" },
      { tipo: "agente", trabalho_id: "exec-criadora" },
      { tipo: "fabriquinha" },
      { tipo: "fabriquinha" },
    ],
  );
  assert.deepEqual(
    relido.decisoes.map((decisao) => Ator.parse(decisao.por)),
    [{ tipo: "auditor" }, { tipo: "agente", trabalho_id: "exec-1" }],
  );
  assert.deepEqual(Ator.parse(relido.demanda.criada_por), { tipo: "externo", ferramenta: "claude", sessao: "s1" });

  const atualizado = comDemanda(bancoDeAutoria, "I-1", (agregado) => ({
    ...agregado,
    tickets: agregado.tickets.map((ticket) => ({
      ...ticket,
      criado_por: { tipo: "agente", trabalho_id: "exec-nova" },
    })),
    decisoes: agregado.decisoes.map((decisao) => ({ ...decisao, por: { tipo: "auditor" } })),
  }));
  assert.deepEqual(carregarDemanda(bancoDeAutoria, "I-1"), atualizado);
  assert.deepEqual(
    atualizado.tickets.map((ticket) => Ator.parse(ticket.criado_por)),
    Array.from({ length: 4 }, () => ({ tipo: "agente", trabalho_id: "exec-nova" })),
  );
  assert.deepEqual(
    atualizado.decisoes.map((decisao) => Ator.parse(decisao.por)),
    [{ tipo: "auditor" }, { tipo: "auditor" }],
  );
});

test("decisão legada do agente sem trabalho recebe a identidade anterior à migração 37", () => {
  const bancoLegado = comBase();
  bancoLegado.exec("UPDATE decisao_ticket SET por_trabalho_id = NULL WHERE por_tipo = 'agente'");
  const relido = carregarDemanda(bancoLegado, "I-1");
  assert.deepEqual(
    relido.decisoes.map((decisao) => Ator.parse(decisao.por)),
    [{ tipo: "auditor" }, { tipo: "agente", trabalho_id: "anterior-a-migracao-37" }],
  );
});

test("grava só a diferença: atualiza, apaga e insere", () => {
  const b = comBase();
  const depois = comDemanda(b, "I-1", (ag) => ({
    ...ag,
    demanda: { ...ag.demanda, estado: "encerrar_demanda" },
    tickets: ag.tickets.map((t) => (t.ticket_id === 2 ? { ...t, estado: "concluido" } : t)),
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: ag.decisoes.slice(1),
    evidencias: ag.evidencias.map((e) => (e.ticket_id === 2 ? { ...e, dados: { v: 9 } } : e)),
    rodadas: [...ag.rodadas, rodada(3)],
  }));
  assert.deepEqual(carregarDemanda(b, "I-1"), depois);
  assert.equal(depois.rodadas.length, 3);
});

test("CA-3: falha no meio da transição não deixa linha gravada", () => {
  const b = comBase();
  const antes = carregarDemanda(b, "I-1");
  assert.throws(() =>
    comDemanda(b, "I-1", (ag) => ({
      ...ag,
      rodadas: [...ag.rodadas, rodada(3)],
      tickets: [...ag.tickets, ticket(5, 3)],
      decisoes: [...ag.decisoes, decisao({ decisao_id: 3, nota: 0 })],
    })),
  );
  assert.deepEqual(carregarDemanda(b, "I-1"), antes);
});

test("CA-4: demanda inexistente lança ErroDeInexistente com orientação", () => {
  const b = banco();
  for (const f of [() => carregarDemanda(b, "I-9"), () => comDemanda(b, "I-9", (ag) => ag)]) {
    assert.throws(
      f,
      (e) => e instanceof ErroDeInexistente && e.message.includes("I-9") && e.message.includes("confira"),
    );
  }
  assert.equal(b.isTransaction, false);
});

test("CA-5: dependência de ticket entre rodadas diferentes ou com ticket sem rodada", () => {
  for (const depende_ticket_id of [3, 4]) {
    recusa((ag) => ({
      dependencias_ticket: [...ag.dependencias_ticket, { demanda_id: "I-1", ticket_id: 2, depende_ticket_id }],
    }));
  }
  recusa((ag) => ({
    dependencias_ticket: [...ag.dependencias_ticket, { demanda_id: "I-1", ticket_id: 4, depende_ticket_id: 1 }],
  }));
});

test("CA-6: ticket com rodada inexistente", () => {
  recusa((ag) => ({ tickets: [...ag.tickets, ticket(5, 99)] }));
});

test("CA-7: nota fora de 1 a 5", () => {
  for (const nota of [0, 6]) {
    recusa((ag) => ({ decisoes: [...ag.decisoes, decisao({ decisao_id: 3, nota })] }));
  }
});

test("CA-8: dependência de ticket para ele mesmo", () => {
  recusa((ag) => ({
    dependencias_ticket: [...ag.dependencias_ticket, { demanda_id: "I-1", ticket_id: 1, depende_ticket_id: 1 }],
  }));
});

test("CA-9: evidência com rodada e ticket ao mesmo tempo", () => {
  recusa((ag) => ({
    evidencias: [...ag.evidencias, evidencia({ rodada_id: 1, ticket_id: 1 }, "prototipo")],
  }));
});

test("CA-10: evidência de rodada ou ticket inexistente", () => {
  recusa((ag) => ({
    evidencias: [...ag.evidencias, evidencia({ rodada_id: 99 }, "prototipo")],
  }));
  recusa((ag) => ({
    evidencias: [...ag.evidencias, evidencia({ ticket_id: 99 }, "prototipo")],
  }));
});

test("CA-11: nova evidência do mesmo tipo e dono substitui a anterior", () => {
  const b = comBase(false);
  const depois = comDemanda(b, "I-1", (ag) =>
    comEvidencia(
      ag,
      { tipo: "comportamento", dados: { v: 42 } },
      { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      "2026-02-01T00:00:00.000Z",
    ),
  );
  const daDemanda = (a: AgregadoDemanda) =>
    a.evidencias.filter((e) => e.rodada_id === undefined && e.ticket_id === undefined && e.tipo === "comportamento");
  assert.deepEqual(daDemanda(carregarDemanda(b, "I-1")), daDemanda(depois));
  assert.deepEqual(
    daDemanda(depois).map((e) => e.dados),
    [{ v: 42 }],
  );
  assert.equal(b.prepare("SELECT count(*) AS n FROM evidencia_demanda").get()?.n, 3);
});

// Progresso do encerramento (comparacao-sdlc §5): precisa do estado encerramento e de um resolver_conflito para o conflito.
const emEncerramento = (b: DatabaseSync, encerramento?: ProgressoEncerramento) =>
  comDemanda(b, "I-1", (ag) => ({
    ...ag,
    demanda: { ...ag.demanda, estado: "encerrar_demanda" },
    tickets: [...ag.tickets, { ...ticket(5), etapa: "resolver_conflito" }],
    pull_requests: [...ag.pull_requests, pr(undefined, "aberto")],
    ...(encerramento && { encerramento }),
  }));
const progresso = (extra: Partial<ProgressoEncerramento> = {}): ProgressoEncerramento => ({
  demanda_id: "I-1",
  branch: "fabriquinha/I-1",
  base: "main",
  sha_verificado: "abc123",
  limpeza_pendente: [],
  ...extra,
});
const linhas = (b: DatabaseSync, tabela: string) => b.prepare(`SELECT * FROM ${tabela}`).all();

test("encerramento: ida e volta campo a campo, com e sem os opcionais", () => {
  const b = comBase();
  const cheio = progresso({
    aguardando_merge_humano: true,
    integracao: { sha: "def456" },
    limpeza_pendente: ["branch-a", "branch-b"],
    conflito_pendente: { ticket_id: 5 },
    falha: { etapa: "limpeza", motivo: "m" },
  });
  assert.deepEqual(emEncerramento(b, cheio).encerramento, cheio);
  assert.deepEqual(carregarDemanda(b, "I-1").encerramento, cheio);
  const minimo = { demanda_id: "I-1", branch: "fabriquinha/I-1", base: "main", limpeza_pendente: [] };
  comDemanda(b, "I-1", (ag) => ({ ...ag, encerramento: minimo }));
  assert.deepEqual(carregarDemanda(b, "I-1").encerramento, minimo);
  assert.deepEqual(linhas(b, "limpeza_pendente_encerramento"), []);
  assert.equal("encerramento" in carregarDemanda(comBase(), "I-1"), false);
});

test("encerramento: confirmar a integração é só UPDATE e as pendências ficam em linhas próprias", () => {
  const b = comBase();
  emEncerramento(b, progresso());
  const ops: string[] = [];
  const prepare = b.prepare.bind(b);
  b.prepare = (sql: string) => {
    ops.push(sql.split(" ")[0] ?? "");
    return prepare(sql);
  };
  comDemanda(b, "I-1", (ag) => ({
    ...ag,
    encerramento: { ...progresso(), integracao: { sha: "def456" }, limpeza_pendente: ["branch-a", "branch-b"] },
  }));
  assert.equal(ops.includes("DELETE"), false);
  assert.deepEqual(
    linhas(b, "limpeza_pendente_encerramento").map((l) => l.limpeza_pendente),
    ["branch-a", "branch-b"],
  );
  assert.deepEqual(carregarDemanda(b, "I-1").encerramento?.limpeza_pendente, ["branch-a", "branch-b"]);
  assert.equal(ops.filter((o) => o === "UPDATE").length, 1);
});

test("encerramento: o banco recusa progresso duplicado, de demanda inexistente, conflito alheio e pendência repetida", () => {
  const b = comBase();
  emEncerramento(b, progresso({ integracao: { sha: "s" }, limpeza_pendente: ["branch-a"] }));
  const antes = carregarDemanda(b, "I-1");
  const recusaGravar = (esperado: RegExp, sql: string) => {
    assert.throws(() => {
      b.exec(sql);
    }, esperado);
    assert.deepEqual(carregarDemanda(b, "I-1"), antes);
  };
  recusaGravar(
    /constraint/i,
    "INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('I-1', 'b', 'main')",
  );
  recusaGravar(
    /FOREIGN KEY/,
    "INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('I-9', 'b', 'main')",
  );
  recusaGravar(/constraint/i, "INSERT INTO limpeza_pendente_encerramento VALUES ('I-1', 'branch-a')");
  assert.equal(linhas(b, "limpeza_pendente_encerramento").length, 1);
  assert.throws(
    () => comDemanda(b, "I-1", (ag) => ({ ...ag, encerramento: progresso({ conflito_pendente: { ticket_id: 99 } }) })),
    /FOREIGN KEY/,
  );
  assert.deepEqual(carregarDemanda(b, "I-1"), antes);
});

test("pull_request: o PR de cada rodada e o final voltam iguais, mudam por UPDATE e saem com a rodada", () => {
  const b = comBase();
  const antes = carregarDemanda(b, "I-1");
  assert.deepEqual(antes.pull_requests, [pr(1, "aberto"), pr(2, "integrado")]);
  const comFinal = emEncerramento(b);
  assert.deepEqual(comFinal.pull_requests.at(-1), pr(undefined, "aberto"));
  assert.equal(linhas(b, "pull_request").length, 3);
  const integrado = comDemanda(b, "I-1", (ag) => ({
    ...ag,
    pull_requests: ag.pull_requests.map((p) => (p.rodada_id === 1 ? { ...p, estado: "integrado" as const } : p)),
  }));
  assert.deepEqual(carregarDemanda(b, "I-1"), integrado);
  comDemanda(b, "I-1", (ag) => ({ ...ag, pull_requests: ag.pull_requests.slice(0, 1) }));
  assert.equal(linhas(b, "pull_request").length, 1);
});

test("pull_request: o banco recusa PR repetido no mesmo Espaço, de rodada inexistente e integração sem PR final", () => {
  const b = comBase();
  const inserir = (rodada: number | null) =>
    `INSERT INTO pull_request VALUES ('I-1', ${String(rodada)}, 5, 'u', 'h', 'aberto', '${em}')`;
  assert.throws(() => {
    b.exec(inserir(1));
  }, /constraint/i);
  assert.throws(() => {
    b.exec(inserir(9));
  }, /FOREIGN KEY/);
  const semPrFinal = /exige o PR final/;
  const encerramento = (integracao: string) =>
    `INSERT INTO encerramento_demanda (demanda_id, branch, base, integracao_sha) VALUES ('I-1', 'b', 'main', ${integracao})`;
  assert.throws(() => {
    b.exec(encerramento("'s'"));
  }, semPrFinal);
  b.exec(encerramento("NULL"));
  assert.throws(() => {
    b.exec("UPDATE encerramento_demanda SET integracao_sha = 's'");
  }, semPrFinal);
  b.exec(inserir(null));
  b.exec("UPDATE encerramento_demanda SET integracao_sha = 's'");
});

const entrada = { projeto: "p", titulo: "t", tipo: "funcionalidade", descricao: "d" };
const autor = { tipo: "externo" as const, ferramenta: "claude", sessao: "s1" };
const registrar = (id: string) => registrarDemanda({ ...entrada, id }, autor, { agora: em });

test("CA-9: demanda nova recebe I-{n} da sequência issue", () => {
  const b = banco();
  b.exec("INSERT INTO sequencia (nome, valor) VALUES ('demanda', 216)");
  const criada = criarDemandaNova(b, registrar);
  assert.equal(criada.demanda.id, "I-217");
  assert.equal(criada.demanda.branch, "fabriquinha/I-217");
  assert.equal(criada.demanda.criada_por.sessao, "s1");
  assert.deepEqual(
    criada.tickets.map((t) => [t.ticket_id, t.etapa]),
    [[1, "entender_e_desenhar"]],
  );
  assert.deepEqual(carregarDemanda(b, "I-217"), criada);
  assert.equal(b.prepare("SELECT valor FROM sequencia WHERE nome = 'demanda'").get()?.valor, 217);
});

test("CA-10: erro na criação desfaz a demanda e a sequência", () => {
  const b = banco();
  assert.throws(() =>
    criarDemandaNova(b, (id) => registrarDemanda({ ...entrada, id, projeto: "inexistente" }, autor, { agora: em })),
  );
  assert.equal(b.prepare("SELECT count(*) AS n FROM demanda").get()?.n, 0);
  assert.equal(criarDemandaNova(b, registrar).demanda.id, "I-1");
});

test("agregado com ID diferente do alocado é reprovado e desfaz a sequência", () => {
  const b = banco();
  assert.throws(() => criarDemandaNova(b, () => registrar("I-9")), /monte a demanda com o id recebido \(I-1\)/);
  assert.equal(b.prepare("SELECT count(*) AS n FROM demanda").get()?.n, 0);
  assert.equal(criarDemandaNova(b, registrar).demanda.id, "I-1");
});

test("carregarDemanda dentro de escrever lê na transação aberta e não a fecha", () => {
  const b = comBase();
  const lida = escrever(b, () => {
    const ag = carregarDemanda(b, "I-1");
    assert.equal(b.isTransaction, true);
    return ag;
  });
  assert.deepEqual(lida, carregarDemanda(b, "I-1"));
  assert.equal(b.isTransaction, false);
});

test("listarDemandas: em ordem de criação, sem arquivada por padrão, com ela no filtro e só as em andamento no outro", () => {
  const b = banco();
  const ag = completo();
  const com = (id: string, estado: AgregadoDemanda["demanda"]["estado"]) => {
    const t = (x: { demanda_id: string }) => ({ ...x, demanda_id: id });
    gravarAgregadoPronto(b, {
      ...ag,
      demanda: { ...ag.demanda, id, estado, branch: `fabriquinha/${id}` },
      rodadas: ag.rodadas.map((r) => ({ ...t(r), branch: `fabriquinha/${id}-${String(r.rodada_id)}` })),
      dependencias_rodada: ag.dependencias_rodada.map(t),
      criterios_citados: ag.criterios_citados.map(t),
      tickets: ag.tickets.map(t),
      tentativas: ag.tentativas.map((tentativa) => ({
        ...tentativa,
        ticket: Endereco.doTicket(id, Number(tentativa.ticket.ticket_id)),
      })),
      dependencias_ticket: ag.dependencias_ticket.map(t),
      caminhos_ticket: ag.caminhos_ticket.map(t),
      arquivos_previstos_rodada: ag.arquivos_previstos_rodada.map(t),
      arquivos_previstos_demanda: ag.arquivos_previstos_demanda.map(t),
      versoes_plano: ag.versoes_plano.map(t),
      decisoes: ag.decisoes.map(t),
      evidencias: ag.evidencias.map(t),
    } as AgregadoDemanda);
  };
  com("I-10", "em_execucao");
  com("I-2", "arquivada");
  com("I-3", "encerrar_demanda");
  com("I-4", "concluida");
  com("I-5", "cancelada");
  assert.deepEqual(
    listarDemandas(b).map((a) => a.demanda.id),
    ["I-10", "I-3", "I-4", "I-5"],
  );
  assert.deepEqual(
    listarDemandas(b, { arquivadas: true }).map((a) => a.demanda.id),
    ["I-10", "I-2", "I-3", "I-4", "I-5"],
  );
  assert.deepEqual(
    listarDemandas(b, { soNaoTerminadas: true }).map((a) => a.demanda.id),
    ["I-10", "I-3"],
  );
  assert.equal(b.isTransaction, false);
  escrever(b, () => {
    assert.equal(listarDemandas(b).length, 4);
  });
});

test("carregarDemandas devolve os agregados na ordem pedida e prepara os SQL na mesma quantidade com 1 ou 3 ids", () => {
  const b = comBase();
  const preparacoesDe = (ids: string[]) => {
    const original = b.prepare.bind(b);
    let preparacoes = 0;
    b.prepare = (sql) => (preparacoes++, original(sql));
    carregarDemandas(b, ids);
    b.prepare = original;
    return preparacoes;
  };
  assert.deepEqual(carregarDemandas(b, ["I-1", "I-1"]), [carregarDemanda(b, "I-1"), carregarDemanda(b, "I-1")]);
  assert.equal(preparacoesDe(["I-1", "I-1", "I-1"]), preparacoesDe(["I-1"]));
  assert.throws(() => carregarDemandas(b, ["I-9"]), ErroDeInexistente);
});

test("situacaoDasDemandas devolve só o id e o estado das demandas pedidas, na ordem pedida", () => {
  const b = comBase();
  const { estado } = carregarDemanda(b, "I-1").demanda;
  assert.deepEqual(situacaoDasDemandas(b, ["I-9", "I-1"]), [{ id: "I-1", estado }]);
  assert.deepEqual(situacaoDasDemandas(b, []), []);
});
