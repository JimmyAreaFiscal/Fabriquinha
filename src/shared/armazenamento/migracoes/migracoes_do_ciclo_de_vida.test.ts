// A migração 52 sobre um banco na versão 51 com demandas em todos os estados: o estado do desenvolvimento de cada uma
// passa à tabela do Processo, na ordem das linhas, sem que nenhuma linha antiga se perca ou mude.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { cadastrarProjetoLoja } from "../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { migrarBancoDaFabriquinha } from "../../../server/system/banco_da_fabriquinha.ts";
import { EstadoDemanda } from "../../../modulos/ciclo_de_vida/publico.ts";
import { MIGRACOES_DO_CICLO_DE_VIDA } from "./migracoes_do_ciclo_de_vida.ts";

const linhas = (banco: DatabaseSync, tabela: string): unknown[] =>
  banco
    .prepare(`SELECT * FROM ${tabela} ORDER BY rowid`)
    .all()
    .map((linha) => ({ ...linha }));

test("a 52 copia o estado, o instante da mudança e a branch de cada demanda para processo_demanda, sem mudar a demanda", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(banco, 51);
  cadastrarProjetoLoja(banco);
  const inserir = banco.prepare(
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta,
       criada_por_sessao, enviada, branch, situacao) VALUES (?, 'loja', 't', 'problema', 'd', ?, ?, 'f', 's', 1, ?, 'enviado')`,
  );
  // Gravadas fora da ordem dos ids, para a cópia seguir a ordem das linhas.
  const gravadas = EstadoDemanda.options.map((estado, posicao) => ({
    demanda_id: `I-${String(EstadoDemanda.options.length - posicao)}`,
    estado,
    estado_alterado_em: `2026-01-${String(posicao + 10)}T00:00:00.000Z`,
    branch: `fabriquinha/I-${String(EstadoDemanda.options.length - posicao)}`,
  }));
  for (const { demanda_id, estado, estado_alterado_em, branch } of gravadas)
    inserir.run(demanda_id, estado, estado_alterado_em, branch);
  const demandasAntes = linhas(banco, "demanda");

  migrarBancoDaFabriquinha(banco, 52);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, 52);
  assert.deepEqual(linhas(banco, "processo_demanda"), gravadas);
  assert.deepEqual(linhas(banco, "demanda"), demandasAntes);
  assert.deepEqual(
    MIGRACOES_DO_CICLO_DE_VIDA.migracoes.map(({ versao }) => versao),
    [52],
  );
  banco.close();
});
