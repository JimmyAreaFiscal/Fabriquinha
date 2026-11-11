import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../etapas/catalogo.ts";
import type { TipoVerificacao } from "../../etapas/definicao/tipos_declaraveis.ts";
import { ConferenciaDoPR } from "./conferencia_do_pr.ts";
import { montarVerificacoesDaEtapa } from "./verificacao.ts";

const COM_CODIGO: TipoVerificacao[] = ["testes", "fitness", "sonar", "hooks_do_commit"];

const LISTA_DA_ETAPA: Record<EtapaTicket, TipoVerificacao[]> = {
  entender_e_desenhar: [],
  planejar: [],
  implementar: COM_CODIGO,
  revisar_rodada: ["fitness"],
  encerrar_rodada: ["conferencia_do_pr"],
  ajustar_resultado: [],
  revisar_demanda: [],
  encerrar_demanda: ["conferencia_do_pr"],
  resolver_conflito: COM_CODIGO,
};

for (const etapa of EtapaTicket.options) {
  test(`${etapa}: exige ${JSON.stringify(LISTA_DA_ETAPA[etapa])}`, () => {
    assert.deepEqual(CATALOGO_DE_ETAPAS[etapa].verificacoes, LISTA_DA_ETAPA[etapa]);
  });
}

test("montarVerificacoesDaEtapa monta pelo catálogo, só o que a etapa exige, e recusa a que ela não exige", () => {
  const conferencia = new ConferenciaDoPR({ raiz_git: "/x", hospedagem: "github" }, "1", "/log");

  assert.equal(
    montarVerificacoesDaEtapa("encerrar_rodada", { conferencia_do_pr: () => conferencia }).conferencia_do_pr,
    conferencia,
  );
  assert.deepEqual(montarVerificacoesDaEtapa("implementar", {}), {});
  assert.throws(
    () => montarVerificacoesDaEtapa("implementar", { conferencia_do_pr: () => conferencia }),
    (erro) =>
      erro instanceof ErroDeRegra && erro.message.includes("implementar não exige a verificação conferencia_do_pr"),
  );
});
