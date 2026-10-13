// Proposta de issue (F1 §5): C23 a IA propõe, C24 o Auditor aceita ou recusa. A proposta é um fato preso ao ticket que a
// fez, fora do agregado; o aceite cria a issue nova (C1) e, no desenho, devolve o desenho como reprovado (C15).
import { z } from "zod";
import {
  type Agregado,
  AUDITOR,
  type Ator,
  type Contexto,
  exigirAuditor,
  exigirAuditorOuAgente,
  PropostaIssue,
  rotuloIssue,
} from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { decidirDesenho } from "./gates.ts";
import { registrarIssue } from "./issue.ts";

const EntradaProposta = PropostaIssue.pick({ titulo: true, mensagem: true, arquivos: true });
const EntradaDecisao = z.strictObject({ aceita: z.boolean() });

const rotuloProposta = (p: PropostaIssue): string => `P-${String(p.id)}`;

/** C23: só o agente do registro ou do desenho, com a execução em andamento; o Auditor só decide (C24). */
export function proporIssue(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): PropostaIssue {
  const acao = `propor uma issue a partir da ${rotuloIssue(ag)}`;
  exigirAuditorOuAgente(ag, ator, ["registro", "desenho"], acao);
  if (ator.tipo !== "agente") {
    throw new ErroDeEscopo(`só o agente de registro ou desenho pode ${acao}`, "o Auditor aceita ou recusa a proposta");
  }
  return {
    ...EntradaProposta.parse(entrada),
    id: ctx.novoId("proposta"),
    ticket: ator.ticket,
    status: "pendente",
    em: ctx.agora,
  };
}

/** O ticket da proposta está no gate atual: o de registro na fase `registro`, o último desenho concluído no gate do desenho. */
function noGateAtual(ag: Agregado, proposta: PropostaIssue): boolean {
  const ticket = ag.tickets.find((t) => t.id === proposta.ticket);
  if (ticket?.etapa === "registro") return ag.issue.fase === "registro";
  return (
    ticket?.etapa === "desenho" &&
    ag.issue.fase === "aprovacao_desenho" &&
    ag.tickets.findLast((t) => t.etapa === "desenho" && t.status === "concluido")?.id === ticket.id
  );
}

/** A proposta pendente do gate atual, senão `ErroDeRegra`. */
export function exigirPropostaAberta(ag: Agregado, proposta: PropostaIssue): void {
  const p = rotuloProposta(proposta);
  if (proposta.status !== "pendente") {
    throw new ErroDeRegra(`a proposta ${p} já foi decidida: ${proposta.status}`, "uma proposta só se decide uma vez");
  }
  if (!noGateAtual(ag, proposta)) {
    throw new ErroDeRegra(
      `a proposta ${p} não está no gate atual da ${rotuloIssue(ag)}`,
      "o gate dela já passou ou ela é de outra issue",
    );
  }
}

/** D2: as propostas pendentes do gate atual da issue, na ordem recebida. */
export const propostasAbertas = (ag: Agregado, propostas: readonly PropostaIssue[]): PropostaIssue[] =>
  propostas.filter((p) => p.status === "pendente" && noGateAtual(ag, p));

/**
 * C24: o Auditor decide a proposta pendente do gate atual. Recusar só a marca. Aceitar cria a issue nova (C1, que
 * depende da atual, com a mensagem por descrição) e, no desenho, reprova o desenho com um motivo que cita a nova (C15).
 */
export function decidirProposta(
  ag: Agregado,
  proposta: PropostaIssue,
  entrada: unknown,
  ator: Ator,
  ctx: Contexto,
): { ag: Agregado; proposta: PropostaIssue; nova?: Agregado } {
  exigirAuditor(ator, "decidir uma proposta de issue");
  const { aceita } = EntradaDecisao.parse(entrada);
  exigirPropostaAberta(ag, proposta);
  if (!aceita) return { ag, proposta: { ...proposta, status: "recusada", decididaEm: ctx.agora } };

  const nova = registrarIssue(
    { projeto: ag.issue.projeto, deps: [ag.issue.id], titulo: proposta.titulo, descricao: proposta.mensagem },
    AUDITOR,
    ctx,
  );
  const decidida: PropostaIssue = {
    ...proposta,
    status: "aceita",
    issueCriada: nova.issue.id,
    decididaEm: ctx.agora,
  };
  const noRegistro = ag.issue.fase === "registro";
  const i = `I-${String(nova.issue.id)}`;
  const motivo =
    `A Fabriquinha criou a ${i} («${proposta.titulo}») a partir da proposta de issue aceita pelo Auditor. ` +
    `Refaça o desenho sem o que a ${i} assumiu; leia a descrição dela com fabriquinha issue ver ${i}.`;
  return {
    ag: noRegistro ? ag : decidirDesenho(ag, { aprovado: false, motivo }, ator, ctx),
    proposta: decidida,
    nova,
  };
}
