// O agente só age no próprio ticket: o trabalho do Ator tem de ser uma execução do ticket alvo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  agregadoEmRevisao,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  REF_GLOBAL,
  REF_RODADA,
} from "../../../../apoio-testes/cenarios_de_demanda.ts";
import { AUDITOR } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { exigirTrabalhoDoTicket } from "./trabalho_do_ticket.ts";

test("I-266: o agente com o trabalho de outro ticket é rejeitado; o do próprio ticket passa", () => {
  const { banco, fechar } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoEmRevisao());
  const doTicketDaRodada = abrirTrabalhoDoAgente(banco, REF_RODADA);
  abrirTrabalhoDoAgente(banco, REF_GLOBAL);

  assert.doesNotThrow(() => {
    exigirTrabalhoDoTicket(banco, doTicketDaRodada, REF_RODADA);
  });
  assert.throws(
    () => {
      exigirTrabalhoDoTicket(banco, doTicketDaRodada, REF_GLOBAL);
    },
    (erro) => erro instanceof ErroDeRegra && erro.message.includes("não é uma execução do ticket I-1.T3"),
  );
  const inexistente = { tipo: "agente", trabalho_id: "nao-existe" } as const;
  assert.throws(() => {
    exigirTrabalhoDoTicket(banco, inexistente, REF_RODADA);
  }, ErroDeRegra);
  // Os demais atores não têm trabalho: quem os confere é o núcleo.
  assert.doesNotThrow(() => {
    exigirTrabalhoDoTicket(banco, AUDITOR, REF_RODADA);
  });
  fechar();
});
