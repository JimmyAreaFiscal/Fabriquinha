import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "../../compartilhado/armazenamento/banco.ts";
import { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { demandasParaDespacho, trabalhosVivos } from "./despacho_demanda.ts";
import { MIGRACOES } from "../../compartilhado/armazenamento/migracoes/migracoes.ts";

const ESTADOS_LIDOS = ["planejar", "em_execucao", "revisar_demanda", "encerrar_demanda"] as const;
const T = "'2026-01-01T00:00:00.000Z'";

const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  return b;
};
const demanda = (b: DatabaseSync, id: string, estado: string) => {
  b.exec(
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('${id}', 'p', 't', 'problema', 'd', '${estado}', ${T}, 'f', 's', 1, 'fabriquinha/${id}')`,
  );
};
let execucoes = 0;
const execucao = (b: DatabaseSync, id: string, n: number, inicio: string, fim: string | null) => {
  const sessao = `S-${id}-${String(n)}`;
  b.exec(`INSERT OR IGNORE INTO trabalho_agentico VALUES ('${sessao}', '${id}', ${String(n)}, 'autonomo', 'ref')`);
  b.exec(
    `INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('E-${String(++execucoes)}', '${sessao}', ${inicio}, ${fim ?? "NULL"}, 0)`,
  );
};

test("CA-1 a CA-6: lê só as demandas nos estados pedidos, com as predecessoras", () => {
  const b = banco();
  demanda(b, "I-4", "em_execucao");
  demanda(b, "I-6", "planejar");
  demanda(b, "I-7", "revisar_demanda");
  demanda(b, "I-8", "encerrar_demanda");
  demanda(b, "I-9", "gate_planejamento");
  b.exec("INSERT INTO dependencia_demanda VALUES ('I-6', 'I-4')");
  b.exec("INSERT INTO dependencia_demanda VALUES ('I-7', 'I-8')");
  const lidas = demandasParaDespacho(b, ESTADOS_LIDOS).map((d) => [d.agregado.demanda.id, d.predecessoras]);
  assert.deepEqual(lidas, [
    ["I-4", []],
    ["I-6", [{ demanda_id: "I-4", estado: "em_execucao" }]],
    ["I-7", [{ demanda_id: "I-8", estado: "encerrar_demanda" }]],
    ["I-8", []],
  ]);
  assert.equal(b.isTransaction, false);
});

test("trabalhos vivos: só os tickets com execução aberta, com ou sem o pi no ar", () => {
  const b = banco();
  demanda(b, "I-1", "em_execucao");
  for (const n of [1, 2, 3]) {
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', ${String(n)}, 'resolver_conflito', 'em_execucao', ${T})`);
  }
  execucao(b, "I-1", 1, T, null);
  execucao(b, "I-1", 2, T, T);
  execucao(b, "I-1", 3, T, null);
  assert.deepEqual(trabalhosVivos(b), [Endereco.doTicket("I-1", 1), Endereco.doTicket("I-1", 3)]);
});
