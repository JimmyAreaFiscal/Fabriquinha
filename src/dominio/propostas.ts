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
import type { Id } from "./primitivos.ts";

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

/** O ticket da proposta está no gate atual: o de registro na fase `registro`, o desenho enviado no gate do desenho. */
function noGateAtual(ag: Agregado, proposta: PropostaIssue): boolean {
  const ticket = ag.tickets.find((t) => t.id === proposta.ticket);
  if (ticket?.etapa === "registro") return ag.issue.fase === "registro";
  return ticket?.etapa === "desenho" && ticket.status === "em_execucao" && ag.issue.fase === "aprovacao_desenho";
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
 * Os lotes de propostas de um ticket, inferidos pelos horários (sem coluna): percorre por id e começa um lote novo
 * quando a proposta nasce depois do maior `decididaEm` do lote corrente, com todas as do lote decididas.
 */
export function lotes(propostas: readonly PropostaIssue[]): PropostaIssue[][] {
  const saida: PropostaIssue[][] = [];
  for (const p of [...propostas].sort((a, b) => a.id - b.id)) {
    const atual = saida.at(-1);
    if (atual && !atual.every((q) => q.decididaEm !== undefined && p.em > q.decididaEm)) atual.push(p);
    else saida.push([p]);
  }
  return saida;
}

/** O motivo do C15 ao fechar o lote do desenho: o de hoje para um só aceite; senão, uma linha por decisão. */
function motivoDoLote(lote: readonly PropostaIssue[], issue: Id): string {
  const rotulo = (n: Id | undefined): string => `I-${String(n)}`;
  const [unica] = lote;
  if (unica?.status === "aceita" && lote.length === 1) {
    const i = rotulo(unica.issueCriada);
    return (
      `A Fabriquinha criou a ${i} («${unica.titulo}») a partir da proposta de issue aceita pelo Auditor. ` +
      `Refaça o desenho sem o que a ${i} assumiu; leia a descrição dela com fabriquinha issue ver ${i}.`
    );
  }
  const linhas = lote.map((p) => {
    const nome = `- ${rotuloProposta(p)} «${p.titulo}»: `;
    if (p.status !== "aceita") return `${nome}recusada; a parte dela continua na ${rotulo(issue)}.`;
    const i = rotulo(p.issueCriada);
    return `${nome}aceita; a Fabriquinha criou a ${i} a partir dela (leia com fabriquinha issue ver ${i}).`;
  });
  return [
    "O Auditor decidiu as propostas de issue do desenho:",
    ...linhas,
    "Ajuste o desenho conforme essas decisões.",
  ].join("\n");
}

/**
 * C24: o Auditor decide a proposta pendente do gate atual. Aceitar cria a issue nova (C1, que depende da atual, com a
 * mensagem por descrição). Quando nenhuma outra proposta segue aberta, devolve o `lote` fechado (o último de `lotes`
 * do ticket, com a decidida atualizada) e, no desenho, reprova o desenho (C15) com o motivo que lista as decisões.
 */
export function decidirProposta(
  ag: Agregado,
  proposta: PropostaIssue,
  entrada: unknown,
  ator: Ator,
  ctx: Contexto,
  propostas: readonly PropostaIssue[],
): { ag: Agregado; proposta: PropostaIssue; nova?: Agregado; lote?: PropostaIssue[] } {
  exigirAuditor(ator, "decidir uma proposta de issue");
  const { aceita } = EntradaDecisao.parse(entrada);
  exigirPropostaAberta(ag, proposta);

  const nova = aceita
    ? registrarIssue(
        { projeto: ag.issue.projeto, deps: [ag.issue.id], titulo: proposta.titulo, descricao: proposta.mensagem },
        AUDITOR,
        ctx,
      )
    : undefined;
  const decidida: PropostaIssue = {
    ...proposta,
    status: nova ? "aceita" : "recusada",
    ...(nova && { issueCriada: nova.issue.id }),
    decididaEm: ctx.agora,
  };
  const todas = propostas.map((p) => (p.id === decidida.id ? decidida : p));
  if (propostasAbertas(ag, todas).length > 0) return { ag, proposta: decidida, nova };

  const [lote = []] = lotes(todas.filter((p) => p.ticket === proposta.ticket)).slice(-1);
  const reprovado =
    ag.issue.fase === "registro"
      ? ag
      : decidirDesenho(ag, { aprovado: false, motivo: motivoDoLote(lote, ag.issue.id) }, ator, ctx);
  return { ag: reprovado, proposta: decidida, nova, lote };
}
