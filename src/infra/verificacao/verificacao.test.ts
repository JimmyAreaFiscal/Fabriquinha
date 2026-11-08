import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { EtapaTicket } from "../../nucleo/primitivos.ts";
import type { TipoVerificacao } from "../../nucleo/verificacao.ts";
import { ConferenciaDoPR } from "./conferencia_do_pr.ts";
import { exigidaPelaEtapa, verificacoesDaEtapa } from "./verificacao.ts";

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
    assert.deepEqual(verificacoesDaEtapa(etapa), LISTA_DA_ETAPA[etapa]);
  });
}

test("exigidaPelaEtapa devolve a Verificação da tabela e recusa a que a etapa não exige", () => {
  const conferencia = new ConferenciaDoPR({ raiz_git: "/x", hospedagem: "github" }, "1", "/log");

  assert.equal(exigidaPelaEtapa("encerrar_rodada", conferencia), conferencia);
  assert.throws(
    () => exigidaPelaEtapa("implementar", conferencia),
    (erro) =>
      erro instanceof ErroDeRegra && erro.message.includes("implementar não exige a verificação conferencia_do_pr"),
  );
});
