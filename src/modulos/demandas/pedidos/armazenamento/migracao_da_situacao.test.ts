// As migrações de Demandas sobre bancos com dados: a 51 (banco na versão 50) deriva a situação de cada pedido do estado e
// do envio gravados, e a 53 (banco na versão 52) deixa a linha da `demanda` só com o pedido; nenhuma linha se perde e
// nenhum valor muda.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco_temporario.ts";
import { cadastrarProjetoLoja } from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { EstadoDemanda } from "../../../ciclo_de_vida/publico.ts";
import { lerPedido } from "./pedidos.ts";
import { registrarPedido } from "../aplicacao/gestao_de_pedidos.ts";
import { MIGRACOES_DE_DEMANDAS } from "./migracao_da_situacao.ts";

const versaoDo = (banco: DatabaseSync): unknown => banco.prepare("PRAGMA user_version").get()?.user_version;

/** Cada tabela do banco com todas as linhas, na ordem de gravação, sem as colunas `ignoradas`. */
function linhasDeTodasAsTabelas(banco: DatabaseSync, ignoradas: readonly string[] = []): Record<string, unknown[]> {
  const tabelas = banco
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((linha) => String(linha.name));
  return Object.fromEntries(
    tabelas.map((tabela) => [
      tabela,
      banco
        .prepare(`SELECT * FROM "${tabela}" ORDER BY rowid`)
        .all()
        .map((linha) => Object.fromEntries(Object.entries(linha).filter(([coluna]) => !ignoradas.includes(coluna)))),
    ]),
  );
}

/**
 * O banco na `versao` com uma demanda em cada estado (`I-1` a `I-10`), gravadas como as versões até a 51 gravavam a
 * linha, um rascunho cancelado (`I-11`), dependências e tickets.
 */
function bancoComDemandasGravadasNaLinha(versao: number): {
  banco: DatabaseSync;
  estadoDe: Map<string, EstadoDemanda>;
} {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(banco, versao);
  cadastrarProjetoLoja(banco);
  const estadoDe = new Map(EstadoDemanda.options.map((estado, posicao) => [`I-${String(posicao + 1)}`, estado]));
  estadoDe.set("I-11", "cancelada");
  const inserir = banco.prepare(
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta,
       criada_por_sessao, enviada, branch) VALUES (?, 'loja', ?, 'problema', 'd', ?, '2026-01-01T00:00:00.000Z', 'f', 's', ?, ?)`,
  );
  for (const [id, estado] of estadoDe) {
    const enviada = id !== "I-11" && estado !== "entender_e_desenhar";
    inserir.run(id, `Demanda ${id}`, estado, Number(enviada), `fabriquinha/${id}`);
    banco
      .prepare(
        `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
         VALUES (?, 1, 'entender_e_desenhar', 'concluido', '2026-01-01T00:00:00.000Z')`,
      )
      .run(id);
  }
  banco.exec("INSERT INTO dependencia_demanda VALUES ('I-1', 'I-8'), ('I-2', 'I-1')");
  return { banco, estadoDe };
}

/** A situação que a migração dá ao pedido em cada estado do processo, com o envio que esse estado implica. */
const SITUACAO_DO_ESTADO: Record<EstadoDemanda, string> = {
  entender_e_desenhar: "rascunho",
  gate_demanda: "enviado",
  planejar: "enviado",
  gate_planejamento: "enviado",
  em_execucao: "enviado",
  revisar_demanda: "enviado",
  encerrar_demanda: "enviado",
  concluida: "concluido",
  arquivada: "concluido",
  cancelada: "cancelado",
};

test("a 51 deriva a situação de cada pedido do estado e do envio, sem perder linha, coluna nem valor", () => {
  const { banco, estadoDe } = bancoComDemandasGravadasNaLinha(50);
  const linhasAntes = linhasDeTodasAsTabelas(banco);

  migrarBancoDaFabriquinha(banco, 51);

  assert.equal(versaoDo(banco), 51);
  assert.deepEqual(linhasDeTodasAsTabelas(banco, ["situacao"]), linhasAntes);
  assert.deepEqual(
    Object.fromEntries([...estadoDe.keys()].map((id) => [id, lerPedido(banco, id).situacao])),
    Object.fromEntries([...estadoDe].map(([id, estado]) => [id, SITUACAO_DO_ESTADO[estado]])),
  );
  banco.close();
});

test("a 53 deixa a linha da demanda só com o pedido: guarda todas as linhas e valores, e o pedido novo nasce sem o estado", () => {
  const { banco } = bancoComDemandasGravadasNaLinha(52);
  const linhasAntes = linhasDeTodasAsTabelas(banco);

  migrarBancoDaFabriquinha(banco, 53);

  assert.equal(versaoDo(banco), 53);
  assert.deepEqual(linhasDeTodasAsTabelas(banco), linhasAntes);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  const colunasOpcionais = banco
    .prepare("SELECT name FROM pragma_table_info('demanda') WHERE \"notnull\" = 0 AND pk = 0 ORDER BY cid")
    .all()
    .map((coluna) => String(coluna.name));
  assert.deepEqual(colunasOpcionais, ["estado", "estado_alterado_em", "branch"]);
  banco.close();
});

test("o banco aberto pela Fabriquinha registra a 51 e a 53 de Demandas, e o pedido novo nasce em rascunho", () => {
  const { banco, fechar } = abrirBancoTemporario();
  assert.deepEqual(
    MIGRACOES_DE_DEMANDAS.migracoes.map(({ versao }) => versao),
    [51, 53],
  );
  cadastrarProjetoLoja(banco);
  const autor = { tipo: "externo", ferramenta: "claude", sessao: "s1" } as const;
  const conteudo = { projeto: "loja", titulo: "Título", tipo: "problema", descricao: "d" };
  const pedido = registrarPedido(banco, conteudo, autor, (registrado) => registrado);
  assert.equal(lerPedido(banco, pedido.id).situacao, "rascunho");
  assert.equal(banco.prepare("SELECT estado FROM demanda WHERE id = ?").get(pedido.id)?.estado, null);
  fechar();
});
