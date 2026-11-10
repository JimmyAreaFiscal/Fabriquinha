// Transições da demanda SDLC (comparacao-sdlc-implementacao.md §3): registrar, editar, enviar, submeter o plano e os tickets.
// Funções puras (agregado, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import { AgregadoDemanda, type TicketDemanda, TipoDemanda } from "./agregado_demanda.ts";
import { AUDITOR, type Ator, AtorExterno, exigirAtor, FABRIQUINHA } from "./ator.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET } from "./ciclos.ts";
import { Modelo } from "./configuracao_agente.ts";
import { branchDemanda, DemandaId, formatarTicketRef } from "./demanda.ts";
import { ErroDeEscopo, ErroDeRegra, existe } from "./erros.ts";
import { exigirAutoria } from "./evidencia.ts";
import { pendentesDeEnvio } from "./evidencia_demanda.ts";
import { criarTicket, ticketAtualDaEtapa } from "./item_de_trabalho.ts";
import { lerPlanoGravado, materializar, PlanoProposto } from "./plano.ts";
import { Id, type Instante, Markdown, Slug, Titulo } from "./primitivos.ts";
import {
  comReaberturaDoAuditor,
  comTentativaEncerrada,
  desdeAReabertura,
  FalhaDaTentativa,
  POLITICA_DE_TENTATIVAS,
  type ResultadoDaTentativa,
  tentativasDoTicket,
} from "./tentativa.ts";

export interface ContextoDemanda {
  readonly agora: Instante;
}

const EntradaRegistro = z.strictObject({
  id: DemandaId,
  projeto: Slug,
  titulo: Titulo,
  tipo: TipoDemanda,
  descricao: Markdown,
});
const EntradaEdicao = z
  .strictObject({ titulo: Titulo.optional(), tipo: TipoDemanda.optional(), descricao: Markdown.optional() })
  .refine((e) => (e.titulo ?? e.tipo ?? e.descricao) !== undefined, "informe ao menos um campo para editar");

/** Ticket global falho bloqueia o seu percurso: só `reabrirTicket` (Auditor, com instrução) o libera. */
export function exigirSemFalha(ag: AgregadoDemanda, etapa: TicketDemanda["etapa"]): void {
  const falho = ag.tickets.find((t) => t.etapa === etapa && t.estado === "falhou");
  if (falho !== undefined) {
    throw new ErroDeRegra(
      `o ticket ${String(falho.ticket_id)} da etapa ${etapa} falhou e bloqueia a demanda ${ag.demanda.id}`,
      "o Auditor deve reabri-lo com instrução",
    );
  }
}

/** CA-1: cria a demanda em `entender_e_desenhar` com o autor externo em `criada_por` e o ticket 1 da etapa `entender_e_desenhar`. */
export function registrarDemanda(entrada: unknown, autor: Ator, ctx: ContextoDemanda): AgregadoDemanda {
  const e = EntradaRegistro.parse(entrada);
  return AgregadoDemanda.parse({
    demanda: {
      ...e,
      estado: "entender_e_desenhar",
      estado_alterado_em: ctx.agora,
      criada_por: AtorExterno.parse(autor),
      enviada: false,
      branch: branchDemanda(e.id),
    },
    tickets: [
      {
        demanda_id: e.id,
        ticket_id: 1,
        etapa: "entender_e_desenhar",
        estado: "em_execucao",
        estado_alterado_em: ctx.agora,
        criado_por: FABRIQUINHA,
      },
    ],
    decisoes: [],
    evidencias: [],
  });
}

/** CA-6 e CA-7: edita título, tipo ou descrição só antes do envio e só pelo Ator externo que a criou (`criada_por`). */
export function editarDemanda(ag: AgregadoDemanda, entrada: unknown, autor: Ator): AgregadoDemanda {
  const e = EntradaEdicao.parse(entrada);
  const { demanda } = ag;
  if (demanda.enviada) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já foi enviada e o conteúdo está congelado`,
      "só custos, decisões e evidências de etapas posteriores entram depois do envio",
    );
  }
  exigirAutoria(demanda, autor, "editar");
  return AgregadoDemanda.parse({
    ...ag,
    demanda: {
      ...demanda,
      titulo: e.titulo ?? demanda.titulo,
      tipo: e.tipo ?? demanda.tipo,
      descricao: e.descricao ?? demanda.descricao,
    },
  });
}

/** CA-2 e CA-3: sem as obrigatórias recusa listando todas; completa, congela e vai a `gate_demanda`. */
export function enviarDemanda(ag: AgregadoDemanda, autor: Ator, ctx: ContextoDemanda): AgregadoDemanda {
  const { demanda } = ag;
  if (demanda.enviada) {
    throw new ErroDeRegra(`a demanda ${demanda.id} já foi enviada`, "aguarde a decisão do Auditor");
  }
  exigirAutoria(demanda, autor, "enviar");
  exigirSemFalha(ag, "entender_e_desenhar");
  const pendentes = pendentesDeEnvio(ag);
  if (pendentes.length > 0) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} não pode ser enviada: faltam as evidências ${pendentes.join(", ")}`,
      "submeta cada uma e envie de novo",
    );
  }
  return { ...ag, demanda: { ...CICLO_DA_DEMANDA.mudar(demanda, "gate_demanda", ctx.agora), enviada: true } };
}

// A definição congelada guarda os `CA-n` em `dados.criterios[].id` (F3); o resto do payload não interessa aqui.
const DadosCriterios = z.object({ criterios: z.array(z.object({ id: z.string() })) });

function ticketPlanejamento(ag: AgregadoDemanda): TicketDemanda {
  const ticket = ticketAtualDaEtapa(ag, "planejar");
  if (ticket === undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não tem ticket de etapa planejar`,
      "abra o ticket de planejamento",
    );
  }
  return ticket;
}

/** O plano submetido, guardado como evidência do ticket de planejamento. */
export function planoSubmetido(ag: AgregadoDemanda, ticket: TicketDemanda): PlanoProposto {
  const evidencia = ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticket.ticket_id);
  if (evidencia === undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não tem plano submetido`,
      "o agente de planejamento o submete antes",
    );
  }
  return lerPlanoGravado(evidencia.dados);
}

/**
 * CA-1 a CA-3: só o agente do ticket de planejamento, só em `planejar`. O plano precisa passar pelo `PlanoProposto` e
 * citar só `CA-n` da definição congelada. Devolve o plano e o ticket de planejamento, ou lança a recusa.
 */
export function validarPlano(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
): { plano: PlanoProposto; ticket: TicketDemanda } {
  const { demanda } = ag;
  const ticket = ticketPlanejamento(ag);
  if (ator.tipo !== "agente") {
    throw new ErroDeEscopo(
      "só o agente do ticket de planejamento pode submeter o plano",
      "peça à sessão de planejamento",
    );
  }
  CICLO_DA_DEMANDA.exigir(demanda, "planejar");
  exigirSemFalha(ag, "planejar");
  const plano = PlanoProposto.safeParse(entrada);
  if (!plano.success) {
    throw new ErroDeRegra(
      `plano inválido: ${plano.error.issues.map((i) => i.message).join("; ")}`,
      "corrija o plano e submeta de novo",
    );
  }
  // A aprovação materializa todo ticket do plano como `implementar`, e a seleção só enxerga tickets de rodada.
  const semRodada = plano.data.tickets.filter((t) => t.rodada_id === undefined).map((t) => String(t.ticket_id));
  if (semRodada.length > 0) {
    throw new ErroDeRegra(
      `os tickets ${semRodada.join(", ")} do plano não têm rodada`,
      "informe a rodada_id de cada ticket de implementação",
    );
  }
  if (plano.data.demanda_id !== demanda.id) {
    throw new ErroDeRegra(
      `o plano é da demanda ${plano.data.demanda_id}, não da ${demanda.id}`,
      "use o demanda_id certo",
    );
  }
  const definicao = ag.evidencias.find(
    (e) => e.tipo === "criterios_aceite" && e.rodada_id === undefined && e.ticket_id === undefined,
  );
  const existentes = new Set(DadosCriterios.safeParse(definicao?.dados).data?.criterios.map((c) => c.id));
  const ausentes = plano.data.criterios.filter((c) => !existentes.has(c));
  if (ausentes.length > 0) {
    throw new ErroDeRegra(
      `o plano cita ${ausentes.join(", ")}, que a definição da demanda ${demanda.id} não tem`,
      "cite só os CA-n da definição congelada",
    );
  }
  return { plano: plano.data, ticket };
}

/**
 * CA-6 e CA-7: o que a aprovação do planejamento faz. O `planejar` conclui, a demanda vai a `em_execucao` e o plano
 * aprovado (versão 1) é materializado em rodadas e tickets de implementação por `materializar`.
 */
export function materializarPlano(ag: AgregadoDemanda, planejamento: TicketDemanda, agora: Instante): AgregadoDemanda {
  const plano = planoSubmetido(ag, planejamento);
  const planejado = mudarTicket(ag, planejamento, "concluido", agora);
  return AgregadoDemanda.parse({
    ...materializar(planejado, plano, { agora }),
    demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "em_execucao", agora),
  });
}

const EntradaReabertura = z.strictObject({
  ticket_id: Id,
  instrucao: Markdown.refine((t) => t.trim() !== "", "informe a instrução"),
});
const EntradaFalha = z.strictObject({
  ticket_id: Id,
  falha: FalhaDaTentativa.refine((f) => f.motivo.trim() !== "", "informe o motivo"),
});
const EntradaDevolucao = z.strictObject({
  ticket_id: Id,
  instrucao: Markdown.refine((t) => t.trim() !== "", "informe a instrução"),
});
export function ticketDaDemanda(ag: AgregadoDemanda, ticket_id: number): TicketDemanda {
  return existe(
    ag.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${formatarTicketRef({ demanda_id: ag.demanda.id, ticket_id })} não existe`,
    "use um ticket da demanda",
  );
}

/**
 * A Tentativa da execução que `alvo` deixa: encerrada com o `resultado`. Ticket que não está em execução só a tem se
 * uma execução a abriu (o da sessão de ajustes, que fica `aberto`).
 */
export const tentativasAposSair = (
  ag: AgregadoDemanda,
  alvo: TicketDemanda,
  resultado: ResultadoDaTentativa | undefined,
  agora: Instante,
): AgregadoDemanda["tentativas"] => {
  const comExecucaoAberta = tentativasDoTicket(ag.tentativas, alvo.ticket_id).some((t) => t.fim === undefined);
  return resultado && (alvo.estado === "em_execucao" || comExecucaoAberta)
    ? comTentativaEncerrada(ag.tentativas, alvo, resultado, agora)
    : ag.tentativas;
};

const RESULTADO_AO_SAIR_DA_EXECUCAO: Partial<Record<TicketDemanda["estado"], ResultadoDaTentativa>> = {
  concluido: { tipo: "sucesso" },
  cancelado: { tipo: "interrompida", por: AUDITOR },
};

/**
 * O agregado com o ticket `alvo` levado a `para` pelo ciclo; `extra` entra junto (instrução, configuração). O
 * `resultado` que quem chama informa encerra a Tentativa do ticket; sem ele, quem sai da execução concluindo deixa um
 * sucesso, e cancelando, a interrupção do Auditor.
 */
export function mudarTicket(
  ag: AgregadoDemanda,
  alvo: TicketDemanda,
  para: TicketDemanda["estado"],
  agora: Instante,
  extra: Partial<TicketDemanda> = {},
  resultado?: ResultadoDaTentativa,
): AgregadoDemanda {
  return {
    ...ag,
    tickets: ag.tickets.map((t) =>
      t.ticket_id === alvo.ticket_id ? { ...CICLO_DO_TICKET.mudar(t, para, agora), ...extra } : t,
    ),
    tentativas: resultado
      ? comTentativaEncerrada(ag.tentativas, alvo, resultado, agora)
      : tentativasAposSair(ag, alvo, RESULTADO_AO_SAIR_DA_EXECUCAO[para], agora),
  };
}

export function exigirDemandaEmAndamento(ag: AgregadoDemanda, acao: string): void {
  if (!CICLO_DA_DEMANDA.estaEmAndamento(ag.demanda.estado)) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} está em ${ag.demanda.estado}`,
      `só ${acao} ticket de demanda em andamento`,
    );
  }
}

/** CA-16, CA-4 e CA-7: o ticket em execução passa a `falhou` com a Tentativa da falha; o estado e os gates da demanda não mudam. */
export function registrarFalhaTicket(ag: AgregadoDemanda, entrada: unknown, ctx: ContextoDemanda): AgregadoDemanda {
  const { ticket_id, falha } = EntradaFalha.parse(entrada);
  exigirDemandaEmAndamento(ag, "falhar");
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "em_execucao");
  return mudarTicket(ag, ticket, "falhou", ctx.agora, {}, falha);
}

/**
 * CA-1 a CA-3, CA-5, CA-6, CA-12 e CA-13 (D05): só a Fabriquinha devolve, só `implementar`/`resolver_conflito` em
 * execução. A Tentativa reprovada entra no histórico e a política decide: volta a `aberto` com a instrução ou, no
 * limite, falha com ela como motivo.
 */
export function devolverTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "devolver um ticket por reprovação técnica", "fabriquinha");
  const { ticket_id, instrucao } = EntradaDevolucao.parse(entrada);
  exigirDemandaEmAndamento(ag, "devolver");
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "em_execucao");
  if (ticket.etapa !== "implementar" && ticket.etapa !== "resolver_conflito") {
    throw new ErroDeRegra(
      `o ticket ${String(ticket_id)} é da etapa ${ticket.etapa} e não admite devolução técnica`,
      "só implementar e resolver_conflito",
    );
  }
  const reprovacao: ResultadoDaTentativa = { tipo: "reprovacao", motivo: instrucao };
  const historico = desdeAReabertura(
    tentativasDoTicket(comTentativaEncerrada(ag.tentativas, ticket, reprovacao, ctx.agora), ticket_id),
  );
  return POLITICA_DE_TENTATIVAS.proximoPasso(ticket.etapa, historico).tipo === "devolver_ao_agente"
    ? mudarTicket(ag, ticket, "aberto", ctx.agora, { instrucao }, reprovacao)
    : mudarTicket(ag, ticket, "falhou", ctx.agora, {}, reprovacao);
}

/**
 * CA-13 a CA-15: só o Auditor, com instrução; o ticket volta a `aberto` (elegível na próxima seleção), sem iniciar execução. A
 * reabertura é uma Tentativa com a instrução dele, e os limites contam de novo a partir dela.
 */
export function reabrirTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "reabrir um ticket", "auditor");
  const { ticket_id, instrucao } = EntradaReabertura.parse(entrada);
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "falhou");
  const reaberto = mudarTicket(ag, ticket, "aberto", ctx.agora, { instrucao });
  return {
    ...reaberto,
    tentativas: comReaberturaDoAuditor(ag.tentativas, ticket, instrucao, ctx.agora),
  };
}

const EntradaRetomadaAutomatica = z.strictObject({
  ticket_id: Id,
  /** Cota estourada: o modelo reserva toma o lugar do do ticket. */
  modelo: Modelo.optional(),
});

/**
 * Só a Fabriquinha, só ticket `falhou`: volta a `aberto` sem o Auditor, mantendo a instrução e o histórico da D05 (a
 * falha não foi do agente). A política recusa a que passou do limite de falhas seguidas ou a que pede o Auditor.
 */
export function retomarTicketFalhoPorInfraestrutura(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "retomar um ticket falho por infraestrutura", "fabriquinha");
  const { ticket_id, modelo } = EntradaRetomadaAutomatica.parse(entrada);
  exigirDemandaEmAndamento(ag, "retomar");
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "falhou");
  const passo = POLITICA_DE_TENTATIVAS.proximoPasso(
    ticket.etapa,
    desdeAReabertura(tentativasDoTicket(ag.tentativas, ticket_id)),
  );
  if (passo.tipo !== "retomar_automaticamente") {
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef(ticket)} não tem retomada automática: já passou de ${String(POLITICA_DE_TENTATIVAS.limites.falhasDeInfraestrutura)} falhas seguidas ou a falha pede o Auditor`,
      "o Auditor decide: reabra com instrução ou cancele",
    );
  }
  return mudarTicket(ag, ticket, "aberto", ctx.agora, {
    ...(modelo && { configuracao_agente: { ...ticket.configuracao_agente, modelo } }),
  });
}

const EntradaDemanda = z.strictObject({ demanda_id: DemandaId });
export function exigirDemandaDaEntrada(ag: AgregadoDemanda, demanda_id: string): void {
  if (demanda_id !== ag.demanda.id) {
    throw new ErroDeRegra(`a referência é da demanda ${demanda_id}, não da ${ag.demanda.id}`, "use o demanda_id certo");
  }
}

/**
 * Recusa se resta rodada fora de `concluida`, implementação não concluída ou ticket ativo/falho (menos o `ignorar`).
 */
export function exigirSemPendencias(ag: AgregadoDemanda, ignorar?: number): void {
  const rodada = ag.rodadas.find((r) => r.estado !== "concluida");
  if (rodada !== undefined) {
    throw new ErroDeRegra(
      `a rodada ${String(rodada.rodada_id)} está em ${rodada.estado}`,
      "todas as rodadas precisam estar concluida",
    );
  }
  const pendente = ag.tickets.find(
    (t) =>
      t.ticket_id !== ignorar &&
      (CICLO_DO_TICKET.estaEmAndamento(t.estado) ||
        t.estado === "falhou" ||
        (t.etapa === "implementar" && t.estado !== "concluido")),
  );
  if (pendente !== undefined) {
    throw new ErroDeRegra(
      `o ticket ${String(pendente.ticket_id)} está ${pendente.estado}`,
      "conclua todo o trabalho pendente antes da revisão integral",
    );
  }
}

/** CA-12: só a Fabriquinha; com todas as rodadas concluídas e nada pendente, abre `revisar_demanda` e vai a `revisar_demanda`. */
export function iniciarRevisaoDemanda(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "iniciar a revisão integral da demanda", "fabriquinha");
  exigirDemandaDaEntrada(ag, EntradaDemanda.parse(entrada).demanda_id);
  CICLO_DA_DEMANDA.exigir(ag.demanda, "em_execucao");
  exigirSemPendencias(ag);
  return {
    ...ag,
    demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "revisar_demanda", ctx.agora),
    tickets: [...ag.tickets, criarTicket(ag, { etapa: "revisar_demanda", criado_por: FABRIQUINHA, agora: ctx.agora })],
  };
}
