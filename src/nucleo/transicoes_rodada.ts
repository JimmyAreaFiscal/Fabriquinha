// Ciclo da rodada (comparacao-sdlc-implementacao.md §4): implementações concluídas, revisão e conferência técnica do PR.
// Funções puras (agregado, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import { type Ator, exigirAtor, FABRIQUINHA } from "./ator.ts";
import type { AgregadoDemanda, RodadaDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { CICLO_DA_DEMANDA, CICLO_DA_RODADA, CICLO_DO_TICKET } from "./ciclos.ts";
import { DemandaId } from "./demanda.ts";
import { ErroDeEscopo, ErroDeRegra, existe } from "./erros.ts";
import { criarTicket, ticketAtualDaEtapa } from "./item_de_trabalho.ts";
import { correcaoDosTicketsDaRodada, materializar } from "./plano.ts";
import { type EtapaTicket, type EstadoRodada, Id, type Instante, palavras } from "./primitivos.ts";
import { type ContextoDemanda, mudarTicket } from "./transicoes_demanda.ts";

const RodadaRef = { demanda_id: DemandaId, rodada_id: Id };
const TicketRef = { ...RodadaRef, ticket_id: Id };

const EntradaConclusao = z.strictObject(RodadaRef);
// Sem defaults: fato ausente nunca vira "sem problema".
const EntradaConferencia = z.strictObject({
  ...TicketRef,
  documentacao_entregue: z.boolean(),
  conflito: z.boolean(),
  check_falho: z.boolean(),
  correcoes: z.array(z.unknown()).optional(),
});

const EntradaCorrecoesSessao = z.strictObject({ ...TicketRef, correcoes: z.array(z.unknown()) });

/** A rodada citada no estado `estado`, o que exige a demanda em `em_execucao`. */
export function rodadaNoEstado(
  ag: AgregadoDemanda,
  ref: { demanda_id: string; rodada_id: number },
  estado: EstadoRodada,
) {
  const { demanda } = ag;
  if (ref.demanda_id !== demanda.id) {
    throw new ErroDeRegra(
      `a referência é da demanda ${ref.demanda_id}, não da ${demanda.id}`,
      "use o demanda_id certo",
    );
  }
  CICLO_DA_DEMANDA.exigir(demanda, "em_execucao");
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${String(ref.rodada_id)} não existe na demanda ${demanda.id}`,
    "use uma rodada da demanda",
  );
  CICLO_DA_RODADA.exigir(rodada, estado);
  return rodada;
}

/** O ticket atual da etapa na rodada (o de maior ID), que precisa ser o citado e estar aberto ou em execução. */
function ticketAtual(ag: AgregadoDemanda, rodada: RodadaDemanda, etapa: EtapaTicket, ticket_id: number): TicketDemanda {
  const atual = ticketAtualDaEtapa(ag, etapa, rodada.rodada_id);
  if (atual?.ticket_id !== ticket_id) {
    throw new ErroDeRegra(
      `o ticket ${String(ticket_id)} não é o ${etapa} atual da rodada ${String(rodada.rodada_id)}`,
      "use o ticket atual da etapa",
    );
  }
  if (!CICLO_DO_TICKET.estaEmAndamento(atual.estado)) {
    throw new ErroDeRegra(`o ticket ${String(ticket_id)} está ${atual.estado}`, "só ticket aberto ou em execução age");
  }
  return atual;
}

/** O ticket atual da etapa na rodada, aberto ou em execução, sem que se cite o ID dele. */
export function ticketAtivoDaEtapa(ag: AgregadoDemanda, rodada: RodadaDemanda, etapa: EtapaTicket): TicketDemanda {
  const atual = existe(
    ticketAtualDaEtapa(ag, etapa, rodada.rodada_id),
    `a rodada ${String(rodada.rodada_id)} não tem ticket ${etapa}`,
    "confira o estado da rodada",
  );
  return ticketAtual(ag, rodada, etapa, atual.ticket_id);
}

export const rodadasComEstadoMudado = (
  ag: AgregadoDemanda,
  alvo: Pick<TicketDemanda, "rodada_id">, // a rodada ou o ticket dela
  para: EstadoRodada,
  agora: Instante,
): RodadaDemanda[] =>
  ag.rodadas.map((r) => (r.rodada_id === alvo.rodada_id ? CICLO_DA_RODADA.mudar(r, para, agora) : r));

/** Os tickets e as Tentativas do agregado com `alvo` concluído. */
const comTicketConcluido = (
  ag: AgregadoDemanda,
  alvo: TicketDemanda,
  agora: Instante,
): Pick<AgregadoDemanda, "tickets" | "tentativas"> => {
  const { tickets, tentativas } = mudarTicket(ag, alvo, "concluido", agora);
  return { tickets, tentativas };
};

/** CA-1: todas as implementações `concluido` (processo encerrado não conta) levam a rodada a `revisar_rodada`, com um `revisar_rodada` novo. */
export function concluirImplementacoesRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "concluir as implementações da rodada", "fabriquinha");
  const e = EntradaConclusao.parse(entrada);
  const rodada = rodadaNoEstado(ag, e, "implementar");
  const impl = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.etapa === "implementar");
  if (impl.length === 0) {
    throw new ErroDeRegra(
      `a rodada ${String(rodada.rodada_id)} não tem ticket de implementar`,
      "não há o que concluir",
    );
  }
  const pendente = impl.find((t) => t.estado !== "concluido");
  if (pendente) {
    throw new ErroDeRegra(
      `o ticket ${String(pendente.ticket_id)} está ${pendente.estado}`,
      "todas as implementações da rodada precisam estar concluído",
    );
  }
  return {
    ...ag,
    tickets: [
      ...ag.tickets,
      criarTicket(ag, { etapa: "revisar_rodada", rodada: rodada.rodada_id, criado_por: FABRIQUINHA, agora: ctx.agora }),
    ],
    rodadas: rodadasComEstadoMudado(ag, rodada, "revisar_rodada", ctx.agora),
  };
}

/** A partir desta reprovação na rodada, o Auditor decide: os corretivos não nascem e o ticket de revisão falha. */
export const REPROVACOES_ATE_O_AUDITOR = 3;
/** @testes o teste confere que o motivo da falha começa pelo prefixo; a produção o usa só dentro do módulo */
export const PREFIXO_TERCEIRA_REPROVACAO = "terceira reprovação da rodada: exige o Auditor";

const LIMITE_PALAVRAS_DO_MOTIVO_FALHA = 1000; // o mesmo teto de `Markdown`, que valida o motivo da Tentativa na leitura
const PALAVRAS_DO_AVISO_DE_OMITIDAS = 6;

/** Prefixo e reprovação mais recente sempre ficam; as mais antigas entram enquanto couberem e o resto vira um aviso. */
export function montarMotivoFalhaDaTerceiraReprovacao(motivosDaMaisRecenteParaAMaisAntiga: string[]): string {
  let palavrasRestantes =
    LIMITE_PALAVRAS_DO_MOTIVO_FALHA - palavras(PREFIXO_TERCEIRA_REPROVACAO) - PALAVRAS_DO_AVISO_DE_OMITIDAS;
  const linhasMantidas: string[] = [];
  for (const motivo of motivosDaMaisRecenteParaAMaisAntiga) {
    const linha = `- ${motivo}`;
    const palavrasDaLinha = palavras(linha);
    if (linhasMantidas.length > 0 && palavrasDaLinha > palavrasRestantes) break;
    const linhaCortada = linha.replace(new RegExp(`^((?:\\s*\\S+){0,${String(palavrasRestantes)}}).*$`, "s"), "$1");
    linhasMantidas.push(linhaCortada);
    palavrasRestantes -= palavrasDaLinha;
  }
  const omitidas = motivosDaMaisRecenteParaAMaisAntiga.length - linhasMantidas.length;
  const aviso = omitidas > 0 ? [`- (${String(omitidas)} reprovações anteriores omitidas)`] : [];
  return [PREFIXO_TERCEIRA_REPROVACAO, ...aviso, ...linhasMantidas.reverse()].join("\n");
}

/**
 * CA-4 e CA-5: a Fabriquinha confere o PR depois da documentação, com fatos explícitos. Com conflito ou check falho exige
 * correções, conclui a etapa técnica e volta a `implementar` sem decisão humana; sem problema, vai a
 * `gate_pr` e o `encerrar_rodada` segue como âncora do gate.
 */
export function conferirPullRequestRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "conferir o PR da rodada", "fabriquinha");
  const e = EntradaConferencia.parse(entrada);
  const rodada = rodadaNoEstado(ag, e, "encerrar_rodada");
  const ticket = ticketAtual(ag, rodada, "encerrar_rodada", e.ticket_id);
  if (!e.documentacao_entregue) {
    throw new ErroDeRegra("a documentação ainda não foi entregue", "confira o PR só depois da entrega");
  }
  if (!e.conflito && !e.check_falho) {
    if (e.correcoes !== undefined) {
      throw new ErroDeRegra("o PR sem conflito nem check falho não leva correções", "omita as correções");
    }
    return { ...ag, rodadas: rodadasComEstadoMudado(ag, rodada, "gate_pr", ctx.agora) };
  }
  const base = materializar(
    ag,
    correcaoDosTicketsDaRodada("conferencia_do_pr", ator, e.rodada_id, e.correcoes ?? []),
    ctx,
  );
  return {
    ...base,
    ...comTicketConcluido(base, ticket, ctx.agora),
    rodadas: rodadasComEstadoMudado(base, rodada, "implementar", ctx.agora),
  };
}

/** Correções novas da sessão (Auditor ou agente do ticket da sessão): ficam abertas, sem executar nem mudar de estado. */
export function registrarCorrecoesSessao(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  const e = EntradaCorrecoesSessao.parse(entrada);
  const rodada = rodadaNoEstado(ag, e, "ajustar_resultado");
  ticketAtual(ag, rodada, "ajustar_resultado", e.ticket_id); // recusa se não for o ticket da sessão
  if (ator.tipo !== "agente" && ator.tipo !== "auditor") {
    throw new ErroDeEscopo("só o Auditor ou o agente da sessão registram correções", "peça ao Auditor pelo web");
  }
  return materializar(ag, correcaoDosTicketsDaRodada("ajustar_resultado", ator, e.rodada_id, e.correcoes), ctx);
}

/** CA-8 e CA-9: só o Auditor, com implementar aberto criado depois da sessão e nenhuma implementação em execução. */
export function concluirSessaoRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "concluir a sessão da rodada", "auditor");
  const e = z.strictObject(TicketRef).parse(entrada);
  const rodada = rodadaNoEstado(ag, e, "ajustar_resultado");
  const sessao = ticketAtual(ag, rodada, "ajustar_resultado", e.ticket_id);
  const impl = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.etapa === "implementar");
  if (impl.some((t) => t.estado === "em_execucao")) {
    throw new ErroDeRegra("há implementação em execução na rodada", "espere ou encerre a execução antes de concluir");
  }
  if (!impl.some((t) => t.estado === "aberto" && t.ticket_id > sessao.ticket_id)) {
    throw new ErroDeRegra(
      "a sessão não registrou trabalho corretivo novo",
      "registre ao menos uma correção na sessão antes de concluí-la",
    );
  }
  return {
    ...ag,
    ...comTicketConcluido(ag, sessao, ctx.agora),
    rodadas: rodadasComEstadoMudado(ag, rodada, "implementar", ctx.agora),
  };
}
