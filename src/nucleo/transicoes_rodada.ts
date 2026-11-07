// Ciclo da rodada (comparacao-sdlc-implementacao.md §4): implementações concluídas, revisão e conferência técnica do PR.
// Funções puras (agregado, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import { type Ator, exigirAtor, FABRIQUINHA } from "./ator.ts";
import type { AgregadoDemanda, DecisaoDemanda, RodadaDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { CICLO_DA_DEMANDA, CICLO_DA_RODADA, CICLO_DO_TICKET } from "./ciclos.ts";
import { materializarCorrecoesRodada } from "./correcoes_demanda.ts";
import { DemandaId } from "./demanda.ts";
import { ErroDeEscopo, ErroDeRegra, existe } from "./erros.ts";
import { criarTicket, ticketAtualDaEtapa } from "./item_de_trabalho.ts";
import { type EtapaTicket, type EstadoRodada, Id, type Instante, Motivo, palavras } from "./primitivos.ts";
import { type ContextoDemanda, mudarTicket } from "./transicoes_demanda.ts";

const RodadaRef = { demanda_id: DemandaId, rodada_id: Id };
const TicketRef = { ...RodadaRef, ticket_id: Id };

const EntradaConclusao = z.strictObject(RodadaRef);
const EntradaRevisao = z.discriminatedUnion("aprovado", [
  z.strictObject({ ...TicketRef, aprovado: z.literal(true) }),
  z.strictObject({ ...TicketRef, aprovado: z.literal(false), exigencias: Motivo, correcoes: z.array(z.unknown()) }),
]);
// Sem defaults: fato ausente nunca vira "sem problema".
const EntradaConferencia = z.strictObject({
  ...TicketRef,
  documentacao_entregue: z.boolean(),
  conflito: z.boolean(),
  check_falho: z.boolean(),
  correcoes: z.array(z.unknown()).optional(),
});

const EntradaReprovacaoPR = z.strictObject({ ...TicketRef, motivo: Motivo });
const EntradaCorrecoesSessao = z.strictObject({ ...TicketRef, correcoes: z.array(z.unknown()) });
const EntradaAprovacaoPR = z.strictObject({ ...TicketRef, nota: z.number().int().min(1).max(5) });
// A aprovação automática, no projeto que a ligou: a nota é do Auditor, então a Fabriquinha aprova sem ela.
const EntradaAprovacaoAutomaticaPR = z.strictObject(TicketRef);
/** O motivo gravado na aprovação automática do PR da rodada, para a decisão não passar por uma do Auditor. */
/** @testes os testes conferem a decisão gravada; a produção a usa só dentro do módulo */
export const MOTIVO_APROVACAO_AUTOMATICA_PR =
  "aprovado automaticamente pela Fabriquinha: a revisão da rodada aprovou e o PR não tem conflito nem check falho";
// Atestado da aplicação confiável de que o PR da rodada foi integrado; sem defaults, ausência recusa.
const Integracao = z.strictObject({ ...TicketRef, confirmada: z.boolean(), branch_destino: z.string() });

/** Contexto da confirmação: `integracao` vem da aplicação (a integração em git acontece fora do domínio). */
interface ContextoConfirmacao extends ContextoDemanda {
  readonly integracao?: unknown;
}
type IntencaoAprovacaoPR = z.infer<typeof EntradaAprovacaoPR> | z.infer<typeof EntradaAprovacaoAutomaticaPR>;

const maximo = (ns: number[]): number => ns.reduce((m, n) => Math.max(m, n), 0);

function rodadaNoEstado(ag: AgregadoDemanda, ref: { demanda_id: string; rodada_id: number }, estado: EstadoRodada) {
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

const rodadasComEstadoMudado = (
  ag: AgregadoDemanda,
  alvo: RodadaDemanda,
  para: EstadoRodada,
  agora: Instante,
): RodadaDemanda[] =>
  ag.rodadas.map((r) => (r.rodada_id === alvo.rodada_id ? CICLO_DA_RODADA.mudar(r, para, agora) : r));

const ticketsConcluidos = (ag: AgregadoDemanda, alvo: TicketDemanda, agora: Instante): TicketDemanda[] =>
  mudarTicket(ag, alvo, "concluido", agora).tickets;

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
const REPROVACOES_ATE_O_AUDITOR = 3;
export const PREFIXO_TERCEIRA_REPROVACAO = "terceira reprovação da rodada: exige o Auditor";

const LIMITE_PALAVRAS_DO_MOTIVO_FALHA = 1000; // o mesmo teto de `Markdown`, que valida `motivo_falha` na leitura
const PALAVRAS_DO_AVISO_DE_OMITIDAS = 6;

/** Prefixo e reprovação mais recente sempre ficam; as mais antigas entram enquanto couberem e o resto vira um aviso. */
function montarMotivoFalhaDaTerceiraReprovacao(motivosDaMaisRecenteParaAMaisAntiga: string[]): string {
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
 * CA-2 e CA-3: só o agente do ticket `revisar_rodada` atual. Reprovada, as exigências vão inteiras em `motivo` e as
 * correções nascem na mesma operação (volta a `implementar`); aprovada, abre `encerrar_rodada` e vai a `encerrar_rodada`.
 * Na terceira reprovação da rodada (as já gravadas mais esta) não há corretivos: o ticket falha e o estado segue em `revisar_rodada`.
 */
export function registrarRevisaoRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  const e = EntradaRevisao.parse(entrada);
  const rodada = rodadaNoEstado(ag, e, "revisar_rodada");
  const ticket = ticketAtual(ag, rodada, "revisar_rodada", e.ticket_id);
  if (ator.tipo !== "agente") {
    throw new ErroDeEscopo("só o agente do ticket revisar_rodada atual decide a revisão", "peça à sessão de revisão");
  }
  const decisoesDoTicket = ag.decisoes.filter((d) => d.ticket_id === ticket.ticket_id);
  const decisao: DecisaoDemanda = {
    demanda_id: ag.demanda.id,
    ticket_id: ticket.ticket_id,
    decisao_id: maximo(decisoesDoTicket.map((d) => d.decisao_id)) + 1, // o Auditor reabre o mesmo ticket, que decide de novo
    resultado: e.aprovado ? "aprovado" : "recusado",
    ...(!e.aprovado && { motivo: e.exigencias }),
    por: ator,
    em: ctx.agora,
  };
  const idsDeRevisaoDaRodada = new Set(
    ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.etapa === "revisar_rodada").map((t) => t.ticket_id),
  );
  const motivosDasReprovacoes = [
    ...ag.decisoes.filter((d) => idsDeRevisaoDaRodada.has(d.ticket_id) && d.resultado === "recusado"),
    decisao,
  ].map((d) => String(d.motivo)); // recusado sempre tem motivo (invariante do agregado)
  if (!e.aprovado && motivosDasReprovacoes.length >= REPROVACOES_ATE_O_AUDITOR) {
    const motivo_falha = montarMotivoFalhaDaTerceiraReprovacao(motivosDasReprovacoes.reverse());
    return {
      ...ag,
      tickets: mudarTicket(ag, ticket, "falhou", ctx.agora, { motivo_falha }).tickets,
      decisoes: [...ag.decisoes, decisao],
    };
  }
  // Os mesmos erros de correção vazia ou inválida recusam antes de qualquer retorno.
  const base = e.aprovado ? ag : materializarCorrecoesRodada(ag, e, e.correcoes, ator, ctx.agora);
  const comRevisaoDecidida: AgregadoDemanda = {
    ...base,
    tickets: ticketsConcluidos(base, ticket, ctx.agora),
    decisoes: [...ag.decisoes, decisao],
  };
  return {
    ...comRevisaoDecidida,
    ...(e.aprovado && {
      tickets: [
        ...comRevisaoDecidida.tickets,
        criarTicket(ag, {
          etapa: "encerrar_rodada",
          rodada: rodada.rodada_id,
          criado_por: FABRIQUINHA,
          agora: ctx.agora,
        }),
      ],
    }),
    rodadas: rodadasComEstadoMudado(
      comRevisaoDecidida,
      rodada,
      e.aprovado ? "encerrar_rodada" : "implementar",
      ctx.agora,
    ),
  };
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
  const base = materializarCorrecoesRodada(ag, e, e.correcoes ?? [], ator, ctx.agora);
  return {
    ...base,
    tickets: ticketsConcluidos(base, ticket, ctx.agora),
    rodadas: rodadasComEstadoMudado(base, rodada, "implementar", ctx.agora),
  };
}

/** O gate do PR: rodada em `gate_pr` e o `encerrar_rodada` atual ainda ativo. */
function gatePullRequest(ag: AgregadoDemanda, ref: { demanda_id: string; rodada_id: number; ticket_id: number }) {
  const rodada = rodadaNoEstado(ag, ref, "gate_pr");
  return { rodada, ticket: ticketAtual(ag, rodada, "encerrar_rodada", ref.ticket_id) };
}

const decisaoDoGate = (
  ag: AgregadoDemanda,
  ticket: TicketDemanda,
  extra: Pick<DecisaoDemanda, "resultado"> & Partial<Pick<DecisaoDemanda, "nota" | "motivo">>,
  ator: Ator,
  ctx: ContextoDemanda,
): DecisaoDemanda => ({
  demanda_id: ag.demanda.id,
  ticket_id: ticket.ticket_id,
  decisao_id: 1, // o gate decide uma vez só: a decisão conclui o ticket
  por: ator,
  em: ctx.agora,
  ...extra,
});

/** CA-6 e CA-7: só o Auditor, com motivo e sem nota. Registra a recusa, conclui o gate e abre a sessão na mesma operação. */
export function reprovarPullRequestRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "reprovar o PR da rodada", "auditor");
  const e = EntradaReprovacaoPR.parse(entrada);
  const { rodada, ticket } = gatePullRequest(ag, e);
  return {
    ...ag,
    tickets: [
      ...ticketsConcluidos(ag, ticket, ctx.agora),
      criarTicket(ag, {
        etapa: "ajustar_resultado",
        rodada: rodada.rodada_id,
        criado_por: FABRIQUINHA,
        agora: ctx.agora,
      }),
    ],
    decisoes: [...ag.decisoes, decisaoDoGate(ag, ticket, { resultado: "recusado", motivo: e.motivo }, ator, ctx)],
    rodadas: rodadasComEstadoMudado(ag, rodada, "ajustar_resultado", ctx.agora),
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
  return materializarCorrecoesRodada(ag, e, e.correcoes, ator, ctx.agora);
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
    tickets: ticketsConcluidos(ag, sessao, ctx.agora),
    rodadas: rodadasComEstadoMudado(ag, rodada, "implementar", ctx.agora),
  };
}

/**
 * Primeiro tempo da aprovação (CA-6): valida a intenção do Auditor, com nota, ou a aprovação automática da Fabriquinha,
 * sem nota, sem efeito algum, antes de qualquer integração. Chegar ao gate já exige a revisão aprovada e o PR sem
 * conflito nem check falho; quem decide se o projeto aprova sozinho é a aplicação.
 */
export function validarAprovacaoPullRequest(ag: AgregadoDemanda, entrada: unknown, ator: Ator): IntencaoAprovacaoPR {
  exigirAtor(ator, "aprovar o PR da rodada", "auditor", "fabriquinha");
  const e = (ator.tipo === "fabriquinha" ? EntradaAprovacaoAutomaticaPR : EntradaAprovacaoPR).parse(entrada);
  gatePullRequest(ag, e);
  return e;
}

/**
 * Segundo tempo (CA-10 e CA-11): repete as guardas e exige o atestado da aplicação, para este gate e com destino na
 * branch da demanda. Só então grava a aprovação, com a nota do Auditor ou o motivo da automática, e conclui o
 * `encerrar_rodada` e a rodada.
 */
export function confirmarAprovacaoPullRequest(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoConfirmacao,
): AgregadoDemanda {
  const e = validarAprovacaoPullRequest(ag, entrada, ator);
  const { rodada, ticket } = gatePullRequest(ag, e);
  const integracao = Integracao.safeParse(ctx.integracao);
  const { data } = integracao;
  if (
    data?.confirmada !== true ||
    data.demanda_id !== e.demanda_id ||
    data.rodada_id !== e.rodada_id ||
    data.ticket_id !== e.ticket_id ||
    data.branch_destino !== ag.demanda.branch
  ) {
    throw new ErroDeRegra(
      "a aplicação não confirmou a integração do PR na branch da demanda",
      "o gate segue aberto; tente de novo depois de integrar",
    );
  }
  return {
    ...ag,
    tickets: ticketsConcluidos(ag, ticket, ctx.agora),
    decisoes: [
      ...ag.decisoes,
      decisaoDoGate(
        ag,
        ticket,
        "nota" in e
          ? { resultado: "aprovado", nota: e.nota }
          : { resultado: "aprovado", motivo: MOTIVO_APROVACAO_AUTOMATICA_PR },
        ator,
        ctx,
      ),
    ],
    rodadas: rodadasComEstadoMudado(ag, rodada, "concluida", ctx.agora),
  };
}
