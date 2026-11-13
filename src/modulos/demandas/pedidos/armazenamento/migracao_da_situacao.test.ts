// A migração 51 sobre um banco na versão 50 com demandas em todos os estados: a situação de cada pedido sai do estado e
// do envio gravados, nenhuma outra linha nem coluna muda, e o processo de cada demanda continua de onde estava.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco_temporario.ts";
import { agregadoNoEstado, cadastrarProjetoLoja } from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { migrar } from "../../../../shared/armazenamento/banco.ts";
import { MIGRACOES, VERSAO_LINHA_DE_BASE } from "../../../../shared/armazenamento/migracoes/migracoes.ts";
import { EstadoDemanda } from "../../../ciclo_de_vida/publico.ts";
import {
  carregarDemanda,
  gravarDemandaNova,
} from "../../../ciclo_de_vida/processo/armazenamento/agregado_da_demanda.ts";
import { lerPedido } from "./pedidos.ts";
import { MIGRACOES_DE_DEMANDAS } from "./migracao_da_situacao.ts";

const VERSAO_ANTERIOR = VERSAO_LINHA_DE_BASE + MIGRACOES.length;
const versaoDo = (banco: DatabaseSync): unknown => banco.prepare("PRAGMA user_version").get()?.user_version;

/** Cada tabela do banco com todas as linhas, na ordem de gravação; `demanda` sem a coluna nova. */
function linhasDeTodasAsTabelas(banco: DatabaseSync): Record<string, unknown[]> {
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
        .map(({ situacao: _situacaoNova, ...colunasAntigas }) => colunasAntigas),
    ]),
  );
}

/** O banco na versão 50 com uma demanda em cada estado (`I-1` a `I-10`), um rascunho cancelado (`I-11`) e dependências. */
function bancoNaVersaoAnteriorComDemandas(): { banco: DatabaseSync; estadoDe: Map<string, EstadoDemanda> } {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrar(banco, MIGRACOES);
  cadastrarProjetoLoja(banco);
  const estadoDe = new Map(EstadoDemanda.options.map((estado, posicao) => [`I-${String(posicao + 1)}`, estado]));
  for (const [id, estado] of estadoDe) gravarDemandaNova(banco, agregadoNoEstado(id, estado));
  gravarDemandaNova(banco, agregadoNoEstado("I-11", "entender_e_desenhar"));
  banco.exec("UPDATE demanda SET estado = 'cancelada' WHERE id = 'I-11'");
  estadoDe.set("I-11", "cancelada");
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

test("a 51 deriva a situação de cada pedido do estado e do envio, sem perder linha, coluna nem o ponto do processo", () => {
  const { banco, estadoDe } = bancoNaVersaoAnteriorComDemandas();
  assert.equal(versaoDo(banco), VERSAO_ANTERIOR);
  const linhasAntes = linhasDeTodasAsTabelas(banco);
  const processosAntes = [...estadoDe.keys()].map((id) => carregarDemanda(banco, id));

  migrar(banco, [...MIGRACOES, ...MIGRACOES_DE_DEMANDAS.migracoes.map(({ migracao }) => migracao)]);

  assert.equal(versaoDo(banco), 51);
  assert.deepEqual(linhasDeTodasAsTabelas(banco), linhasAntes);
  assert.deepEqual(
    [...estadoDe.keys()].map((id) => carregarDemanda(banco, id)),
    processosAntes,
  );
  assert.deepEqual(
    Object.fromEntries([...estadoDe.keys()].map((id) => [id, lerPedido(banco, id).situacao])),
    Object.fromEntries([...estadoDe].map(([id, estado]) => [id, SITUACAO_DO_ESTADO[estado]])),
  );
  banco.close();
});

test("o banco aberto pela Fabriquinha registra a 51 de Demandas e o pedido novo nasce em rascunho", () => {
  const { banco } = abrirBancoTemporario();
  assert.equal(versaoDo(banco), 51);
  assert.deepEqual(
    MIGRACOES_DE_DEMANDAS.migracoes.map(({ versao }) => versao),
    [VERSAO_ANTERIOR + 1],
  );
  cadastrarProjetoLoja(banco);
  gravarDemandaNova(banco, agregadoNoEstado("I-1", "entender_e_desenhar"));
  assert.equal(lerPedido(banco, "I-1").situacao, "rascunho");
});
