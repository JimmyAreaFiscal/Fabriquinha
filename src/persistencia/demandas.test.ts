import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { AgregadoDemanda, DecisaoDemanda, EvidenciaDemanda } from "../dominio/agregado_demanda.ts";
import type { ProgressoEncerramento } from "../dominio/encerramento_demanda.ts";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { registrarDemanda } from "../dominio/transicoes_demanda.ts";
import { escrever, migrar } from "./banco.ts";
import { carregarDemanda, comDemanda, criarDemanda, criarDemandaNova, listarDemandas } from "./demandas.ts";
import { MIGRACOES } from "./migracoes.ts";

const em = "2026-01-01T00:00:00.000Z";
const ticket = (ticket_id: number, rodada_id?: number) => ({
  demanda_id: "I-1",
  ticket_id,
  etapa: "implementar" as const,
  status: "aberto" as const,
  status_alterado_em: em,
  devolucoes: 0,
  ...(rodada_id === undefined ? {} : { rodada_id }),
});
// Sem as chaves de dono ausentes: é assim que o carregamento devolve a evidência (campo omitido).
const evidencia = (dono: { rodada_id?: number; ticket_id?: number }, tipo: EvidenciaDemanda["tipo"], dados = {}) =>
  ({ demanda_id: "I-1", ...dono, tipo, dados, em }) as EvidenciaDemanda;
const decisao = (extra: Partial<DecisaoDemanda>): DecisaoDemanda => ({
  demanda_id: "I-1",
  ticket_id: 1,
  decisao_id: 1,
  resultado: "aprovado",
  por: "agente",
  em,
  ...extra,
});
const rodada = (rodada_id: number) => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  fase: "desenvolvimento" as const,
  e2e: rodada_id === 1,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});

// Rodada 1 com os tickets 1 e 2, rodada 2 com o 3, e o ticket 4 de demanda, sem rodada.
const completo = (): AgregadoDemanda => ({
  demanda: {
    id: "I-1",
    projeto: "p",
    titulo: "t",
    tipo: "funcionalidade",
    descricao: "d",
    fase: "execucao",
    fase_alterada_em: em,
    origem_ferramenta: "claude",
    origem_sessao: "s1",
    enviada: true,
    branch: "fabriquinha/I-1",
  },
  rodadas: [rodada(1), rodada(2)],
  dependencias_rodada: [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }],
  criterios_citados: [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }],
  tickets: [
    {
      ...ticket(1, 1),
      titulo: "t1",
      descricao: "d1",
      modelo_provedor: "anthropic",
      modelo_nome: "m",
      effort: "high",
      instrucao: "refaça",
    },
    ticket(2, 1),
    { ...ticket(3, 2), status: "falhou" as const, devolucoes: 2, motivo_falha: "testes reprovaram" },
    { ...ticket(4), etapa: "demanda" },
  ],
  dependencias_ticket: [{ demanda_id: "I-1", ticket_id: 2, depende_ticket_id: 1 }],
  caminhos_ticket: [{ demanda_id: "I-1", ticket_id: 1, caminho: "src/a.ts" }],
  decisoes: [decisao({ resultado: "recusado", motivo: "m", por: "auditor" }), decisao({ decisao_id: 2, nota: 5 })],
  evidencias: [
    evidencia({}, "comportamento", { v: 1 }),
    evidencia({ rodada_id: 1 }, "comportamento", { v: 2 }),
    evidencia({ ticket_id: 2 }, "comportamento", { v: 3 }),
  ],
});

const banco = (): DatabaseSync => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  return b;
};

const comBase = (enviada = true) => {
  const b = banco();
  const ag = completo();
  criarDemanda(b, { ...ag, demanda: { ...ag.demanda, enviada, fase: enviada ? "execucao" : "registro" } });
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
  criarDemanda(b, ag);
  assert.deepEqual(carregarDemanda(b, "I-1"), ag);
});

test("grava só a diferença: atualiza, apaga e insere", () => {
  const b = comBase();
  const depois = comDemanda(b, "I-1", (ag) => ({
    ...ag,
    demanda: { ...ag.demanda, fase: "encerramento" },
    tickets: ag.tickets.map((t) => (t.ticket_id === 2 ? { ...t, status: "concluido" } : t)),
    caminhos_ticket: [],
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
    submeterEvidenciaDemanda(
      ag,
      { tipo: "comportamento", dados: { v: 42 } },
      { ferramenta: "claude", sessao: "s1" },
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

// Progresso do encerramento (comparacao-sdlc §5): precisa da fase encerramento e de um resolver_conflito para o conflito.
const emEncerramento = (b: DatabaseSync, encerramento?: ProgressoEncerramento) =>
  comDemanda(b, "I-1", (ag) => ({
    ...ag,
    demanda: { ...ag.demanda, fase: "encerramento" },
    tickets: [...ag.tickets, { ...ticket(5), etapa: "resolver_conflito" }],
    ...(encerramento && { encerramento }),
  }));
const progresso = (extra: Partial<ProgressoEncerramento> = {}): ProgressoEncerramento => ({
  demanda_id: "I-1",
  pr: { numero: 7, url: "https://x/pr/7" },
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

const entrada = { projeto: "p", titulo: "t", tipo: "funcionalidade", descricao: "d" };
const autor = { ferramenta: "claude", sessao: "s1" };
const registrar = (id: string) => registrarDemanda({ ...entrada, id }, autor, { agora: em });

test("CA-9: demanda nova recebe I-{n} da sequência issue", () => {
  const b = banco();
  b.exec("INSERT INTO sequencia (nome, valor) VALUES ('issue', 216)");
  const criada = criarDemandaNova(b, registrar);
  assert.equal(criada.demanda.id, "I-217");
  assert.equal(criada.demanda.branch, "fabriquinha/I-217");
  assert.equal(criada.demanda.origem_sessao, "s1");
  assert.deepEqual(
    criada.tickets.map((t) => [t.ticket_id, t.etapa]),
    [[1, "demanda"]],
  );
  assert.deepEqual(carregarDemanda(b, "I-217"), criada);
  assert.equal(b.prepare("SELECT valor FROM sequencia WHERE nome = 'issue'").get()?.valor, 217);
});

test("CA-10: erro na criação desfaz a demanda e a sequência", () => {
  const b = banco();
  assert.throws(() =>
    criarDemandaNova(b, (id) => registrarDemanda({ ...entrada, id, projeto: "inexistente" }, autor, { agora: em })),
  );
  assert.equal(b.prepare("SELECT count(*) AS n FROM demanda").get()?.n, 0);
  assert.equal(criarDemandaNova(b, registrar).demanda.id, "I-1");
});

test("agregado com ID diferente do alocado é recusado e desfaz a sequência", () => {
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
  const com = (id: string, fase: AgregadoDemanda["demanda"]["fase"]) => {
    const t = (x: { demanda_id: string }) => ({ ...x, demanda_id: id });
    criarDemanda(b, {
      ...ag,
      demanda: { ...ag.demanda, id, fase, branch: `fabriquinha/${id}` },
      rodadas: ag.rodadas.map((r) => ({ ...t(r), branch: `fabriquinha/${id}-${String(r.rodada_id)}` })),
      dependencias_rodada: ag.dependencias_rodada.map(t),
      criterios_citados: ag.criterios_citados.map(t),
      tickets: ag.tickets.map(t),
      dependencias_ticket: ag.dependencias_ticket.map(t),
      caminhos_ticket: ag.caminhos_ticket.map(t),
      decisoes: ag.decisoes.map(t),
      evidencias: ag.evidencias.map(t),
    } as AgregadoDemanda);
  };
  com("I-10", "execucao");
  com("I-2", "arquivada");
  com("I-3", "encerramento");
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
    listarDemandas(b, { emAndamento: true }).map((a) => a.demanda.id),
    ["I-10", "I-3"],
  );
  assert.equal(b.isTransaction, false);
  escrever(b, () => {
    assert.equal(listarDemandas(b).length, 4);
  });
});
