import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { criarAvaliacao, importarAchados } from "../../armazenamento/avaliacoes.ts";
import { migrar } from "../../../compartilhado/armazenamento/banco.ts";
import { MIGRACOES } from "../../../compartilhado/armazenamento/migracoes/migracoes.ts";
import { AvaliacaoNaLista, DemandaDoPeriodo } from "../../../entrega/contrato/avaliacoes.ts";
import { consultarAvaliacoes, consultarDemandasDoPeriodo } from "./avaliacoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

/** Um projeto `p` com `quantas` demandas, cada uma com uma sessão terminada em 2026-01-10. */
function bancoComDemandas(quantas: number): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrar(banco, MIGRACOES);
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  for (let n = 1; n <= quantas; n++) {
    const id = `I-${String(n)}`;
    banco.exec(
      `INSERT INTO demanda VALUES ('${id}', 'p', 'Título ${id}', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/${id}');
       INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', ${T});
       INSERT INTO trabalho_agentico VALUES ('s-${id}', '${id}', 1, 'autonomo', 'c');
       INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('e-${id}', 's-${id}', ${T}, '2026-01-10T00:00:00.000Z', 0);`,
    );
  }
  return banco;
}

/** Quantas vezes `consulta` preparou uma instrução no banco. */
function contarPrepare(banco: DatabaseSync, consulta: () => unknown): number {
  const prepare = banco.prepare.bind(banco);
  let chamadas = 0;
  banco.prepare = (sql: string) => {
    chamadas++;
    return prepare(sql);
  };
  consulta();
  banco.prepare = prepare;
  return chamadas;
}

test("as demandas do período trazem o título e saem do contrato", () => {
  const demandas = consultarDemandasDoPeriodo(bancoComDemandas(2), "p", "2026-01-01", "2026-01-31");
  assert.deepEqual(demandas, [
    { id: "I-1", titulo: "Título I-1" },
    { id: "I-2", titulo: "Título I-2" },
  ]);
  assert.deepEqual(
    demandas.map((d) => DemandaDoPeriodo.parse(d)),
    demandas,
  );
});

test("as demandas do período são lidas com o mesmo número de preparos com 1 e com 20 demandas", () => {
  const preparos = (quantas: number) => {
    const banco = bancoComDemandas(quantas);
    return contarPrepare(banco, () => consultarDemandasDoPeriodo(banco, "p", "2026-01-01", "2026-01-31"));
  };
  assert.equal(preparos(1), preparos(20));
});

test("a lista de avaliações traz achados e estado, e não prepara mais com mais avaliações", () => {
  const banco = bancoComDemandas(1);
  const nova = (id: string) => ({
    id,
    projeto: "p",
    de: "2026-01-01",
    ate: "2026-01-31",
    pedido: "",
    criada_em: `2026-01-0${id.slice(1)}`,
    demandas: ["I-1"],
  });
  criarAvaliacao(banco, nova("u1"));
  const comUma = contarPrepare(banco, () => consultarAvaliacoes(banco));
  criarAvaliacao(banco, nova("u2"));
  importarAchados(banco, "u2", [{ achado_id: 1, titulo: "t", descricao: "d", evidencia: "e" }]);
  let lista: AvaliacaoNaLista[] = [];
  const comDuas = contarPrepare(banco, () => (lista = consultarAvaliacoes(banco)));
  assert.equal(comUma, comDuas);
  assert.deepEqual(
    lista.map((a) => [a.id, a.achados, a.estado]),
    [
      ["u2", 1, "concluida"],
      ["u1", 0, "concluida"],
    ],
  );
  assert.deepEqual(
    lista.map((a) => AvaliacaoNaLista.parse(a)),
    lista,
  );
});
