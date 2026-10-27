// Transições da demanda SDLC (comparacao-sdlc-implementacao.md §3): registrar, editar, enviar e decidir.
// Funções puras (agregado, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import { type Ator, exigirAuditor, exigirFabriquinha, TipoIssue } from "./agregado.ts";
import { AgregadoDemanda, type DecisaoDemanda, type TicketDemanda } from "./agregado_demanda.ts";
import { materializarRodadasCorretivas } from "./correcoes_demanda.ts";
import { branchDemanda, branchRodada, DemandaId, Plano } from "./demanda.ts";
import { ErroDeEscopo, ErroDeRegra, existe } from "./erros.ts";
import { AutorDemanda, exigirAutoria, pendentesDeEnvio } from "./evidencia_demanda.ts";
import { type FaseDemanda, Id, type Instante, Markdown, Motivo, Slug, Titulo } from "./primitivos.ts";

export interface ContextoDemanda {
  readonly agora: Instante;
}

const EntradaRegistro = z.strictObject({
  id: DemandaId,
  projeto: Slug,
  titulo: Titulo,
  tipo: TipoIssue,
  descricao: Markdown,
});
const EntradaEdicao = z
  .strictObject({ titulo: Titulo.optional(), tipo: TipoIssue.optional(), descricao: Markdown.optional() })
  .refine((e) => (e.titulo ?? e.tipo ?? e.descricao) !== undefined, "informe ao menos um campo para editar");
const EntradaDecisao = z.discriminatedUnion("aprovado", [
  z.strictObject({ aprovado: z.literal(true), nota: z.number().int().min(1).max(5).optional() }),
  z.strictObject({ aprovado: z.literal(false), motivo: Motivo, nota: z.number().int().min(1).max(5).optional() }),
]);

/** Ticket global falho bloqueia o seu percurso: só `reabrirTicket` (Auditor, com instrução) o libera. */
function exigirSemFalha(ag: AgregadoDemanda, etapa: TicketDemanda["etapa"]): void {
  const falho = ag.tickets.find((t) => t.etapa === etapa && t.status === "falhou");
  if (falho !== undefined) {
    throw new ErroDeRegra(
      `o ticket ${String(falho.ticket_id)} da etapa ${etapa} falhou e bloqueia a demanda ${ag.demanda.id}`,
      "o Auditor deve reabri-lo com instrução",
    );
  }
}

/** CA-1: cria a demanda em `registro` com a origem do autor e o ticket 1 da etapa `demanda`. */
export function registrarDemanda(entrada: unknown, autor: AutorDemanda, ctx: ContextoDemanda): AgregadoDemanda {
  const e = EntradaRegistro.parse(entrada);
  const { ferramenta, sessao } = AutorDemanda.parse(autor);
  return AgregadoDemanda.parse({
    demanda: {
      ...e,
      fase: "registro",
      fase_alterada_em: ctx.agora,
      origem_ferramenta: ferramenta,
      origem_sessao: sessao,
      enviada: false,
      branch: branchDemanda(e.id),
    },
    tickets: [
      { demanda_id: e.id, ticket_id: 1, etapa: "demanda", status: "em_execucao", status_alterado_em: ctx.agora },
    ],
    decisoes: [],
    evidencias: [],
  });
}

/** CA-6 e CA-7: edita título, tipo ou descrição só antes do envio e só pela ferramenta e sessão autoras. */
export function editarDemanda(ag: AgregadoDemanda, entrada: unknown, autor: AutorDemanda): AgregadoDemanda {
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

/** CA-2 e CA-3: sem as obrigatórias recusa listando todas; completa, congela e vai a `aprovacao_demanda`. */
export function enviarDemanda(ag: AgregadoDemanda, autor: AutorDemanda, ctx: ContextoDemanda): AgregadoDemanda {
  const { demanda } = ag;
  if (demanda.enviada) {
    throw new ErroDeRegra(`a demanda ${demanda.id} já foi enviada`, "aguarde a decisão do Auditor");
  }
  exigirAutoria(demanda, autor, "enviar");
  exigirSemFalha(ag, "demanda");
  const pendentes = pendentesDeEnvio(ag);
  if (pendentes.length > 0) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} não pode ser enviada: faltam as evidências ${pendentes.join(", ")}`,
      "submeta cada uma e envie de novo",
    );
  }
  return { ...ag, demanda: { ...demanda, enviada: true, fase: "aprovacao_demanda", fase_alterada_em: ctx.agora } };
}

/**
 * CA-4 e CA-5: o Auditor aprova (vai a `planejamento`) ou recusa com motivo (vai a `cancelada`, sem desenho interno).
 * A decisão e o fechamento do ticket da demanda andam juntos.
 */
export function decidirDemanda(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAuditor(ator, "decidir a demanda");
  const e = EntradaDecisao.parse(entrada);
  const { demanda } = ag;
  if (demanda.fase !== "aprovacao_demanda") {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} está em ${demanda.fase} e não espera decisão`,
      "decida só na fase aprovacao_demanda, depois do envio",
    );
  }
  exigirSemFalha(ag, "demanda");
  const ticket = ag.tickets.find((t) => t.etapa === "demanda");
  if (ticket === undefined) {
    throw new ErroDeRegra(`a demanda ${demanda.id} não tem ticket de etapa demanda`, "registre a demanda de novo");
  }
  const decisao: DecisaoDemanda = {
    demanda_id: demanda.id,
    ticket_id: ticket.ticket_id,
    decisao_id: proximaDecisaoId(ag, ticket),
    resultado: e.aprovado ? "aprovado" : "recusado",
    ...(!e.aprovado && { motivo: e.motivo }),
    ...(e.nota !== undefined && { nota: e.nota }),
    por: "auditor",
    em: ctx.agora,
  };
  return {
    ...ag,
    demanda: { ...demanda, fase: e.aprovado ? "planejamento" : "cancelada", fase_alterada_em: ctx.agora },
    tickets: ag.tickets.map((t) =>
      t === ticket ? { ...t, status: e.aprovado ? "concluido" : "cancelado", status_alterado_em: ctx.agora } : t,
    ),
    decisoes: [...ag.decisoes, decisao],
  };
}

const EntradaReprovacao = z.strictObject({ motivo: Motivo });
const EntradaAprovacao = z.strictObject({ nota: z.number().int().min(1).max(5).optional() });
// A definição congelada guarda os `CA-n` em `dados.criterios[].id` (F3); o resto do payload não interessa aqui.
const DadosCriterios = z.object({ criterios: z.array(z.object({ id: z.string() })) });

export function exigirFase(ag: AgregadoDemanda, fase: FaseDemanda, acao: string): void {
  const { demanda } = ag;
  if (demanda.fase !== fase) {
    throw new ErroDeRegra(`a demanda ${demanda.id} está em ${demanda.fase} e não pode ${acao}`, `só na fase ${fase}`);
  }
}

function ticketPlanejamento(ag: AgregadoDemanda): TicketDemanda {
  const ticket = ag.tickets.find((t) => t.etapa === "planejar");
  if (ticket === undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não tem ticket de etapa planejar`,
      "abra o ticket de planejamento",
    );
  }
  return ticket;
}

/** O plano submetido, guardado como evidência do ticket de planejamento. */
function planoSubmetido(ag: AgregadoDemanda, ticket: TicketDemanda): Plano {
  const evidencia = ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticket.ticket_id);
  if (evidencia === undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não tem plano submetido`,
      "o agente de planejamento o submete antes",
    );
  }
  return Plano.parse(evidencia.dados);
}

/** A sequência de `decisao_id` é local ao ticket: máximo das decisões dele + 1 (1 sem decisão anterior). */
function proximaDecisaoId(ag: AgregadoDemanda, ticket: TicketDemanda): number {
  return ag.decisoes.reduce((m, d) => (d.ticket_id === ticket.ticket_id ? Math.max(m, d.decisao_id) : m), 0) + 1;
}

const decisaoDoAuditor = (
  ag: AgregadoDemanda,
  ticket: TicketDemanda,
  resultado: DecisaoDemanda["resultado"],
  extra: Pick<DecisaoDemanda, "motivo" | "nota">,
  ctx: ContextoDemanda,
): DecisaoDemanda => ({
  demanda_id: ag.demanda.id,
  ticket_id: ticket.ticket_id,
  decisao_id: proximaDecisaoId(ag, ticket),
  resultado,
  ...extra,
  por: "auditor",
  em: ctx.agora,
});

/**
 * CA-1 a CA-3: só o agente do ticket de planejamento, só em `planejamento`. O plano precisa passar pelo `Plano` e
 * citar só `CA-n` da definição congelada; aceito, vira evidência do ticket e a demanda vai a `aprovacao_planejamento`.
 */
export function submeterPlano(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  const { demanda } = ag;
  const ticket = ticketPlanejamento(ag);
  if (ator.tipo !== "agente" || ator.ticket !== ticket.ticket_id) {
    throw new ErroDeEscopo(
      "só o agente do ticket de planejamento pode submeter o plano",
      "peça à sessão de planejamento",
    );
  }
  exigirFase(ag, "planejamento", "receber plano");
  exigirSemFalha(ag, "planejar");
  const plano = Plano.safeParse(entrada);
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
  const evidencia = {
    demanda_id: demanda.id,
    rodada_id: undefined,
    ticket_id: ticket.ticket_id,
    tipo: "plano" as const,
    dados: plano.data,
    em: ctx.agora,
  };
  return {
    ...ag,
    demanda: { ...demanda, fase: "aprovacao_planejamento", fase_alterada_em: ctx.agora },
    evidencias: [...ag.evidencias.filter((e) => !(e.tipo === "plano" && e.ticket_id === ticket.ticket_id)), evidencia],
  };
}

/** CA-4 e CA-5: o Auditor reprova com motivo; a decisão é registrada e a demanda volta a `planejamento` com o mesmo ticket. */
export function reprovarPlanejamento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAuditor(ator, "reprovar o planejamento");
  const { motivo } = EntradaReprovacao.parse(entrada);
  exigirFase(ag, "aprovacao_planejamento", "reprovar o planejamento");
  const ticket = ticketPlanejamento(ag);
  planoSubmetido(ag, ticket);
  return {
    ...ag,
    demanda: { ...ag.demanda, fase: "planejamento", fase_alterada_em: ctx.agora },
    decisoes: [...ag.decisoes, decisaoDoAuditor(ag, ticket, "recusado", { motivo }, ctx)],
  };
}

/**
 * CA-6 e CA-7: chamada pela aplicação só depois de preparar os recursos externos; sem a chamada nada muda. Cria
 * rodadas, tickets de implementação e vínculos do plano, registra a aprovação e vai a `execucao`. Os `ticket_id` do
 * plano são renumerados depois dos já existentes (mesma ordem), pois o agente não vê os IDs da demanda.
 */
export function confirmarAprovacaoPlanejamento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAuditor(ator, "aprovar o planejamento");
  const { nota } = EntradaAprovacao.parse(entrada);
  exigirFase(ag, "aprovacao_planejamento", "aprovar o planejamento");
  exigirSemFalha(ag, "planejar");
  const planejamento = ticketPlanejamento(ag);
  const plano = planoSubmetido(ag, planejamento);
  const demanda_id = ag.demanda.id;
  const base = Math.max(...ag.tickets.map((t) => t.ticket_id));
  const planos = [...plano.tickets].sort((a, b) => a.ticket_id - b.ticket_id);
  const novoId = new Map(planos.map((t, i) => [t.ticket_id, base + i + 1]));
  const id = (n: number): number => existe(novoId.get(n), `o ticket ${String(n)} não está no plano`, "valide o plano");
  return AgregadoDemanda.parse({
    ...ag,
    demanda: { ...ag.demanda, fase: "execucao", fase_alterada_em: ctx.agora },
    tickets: [
      ...ag.tickets.map((t) => (t === planejamento ? { ...t, status: "concluido", status_alterado_em: ctx.agora } : t)),
      ...planos.map(({ ticket_id, rodada_id, titulo, descricao, modelo_provedor, modelo_nome, effort }) => ({
        demanda_id,
        ticket_id: id(ticket_id),
        rodada_id,
        titulo,
        descricao,
        etapa: "implementar",
        status: "aberto",
        status_alterado_em: ctx.agora,
        modelo_provedor,
        modelo_nome,
        effort,
      })),
    ],
    decisoes: [
      ...ag.decisoes,
      decisaoDoAuditor(ag, planejamento, "aprovado", { ...(nota !== undefined && { nota }) }, ctx),
    ],
    rodadas: plano.rodadas.map((r) => ({
      demanda_id,
      rodada_id: r.rodada_id,
      titulo: r.titulo,
      fase: "desenvolvimento",
      e2e: r.e2e,
      branch: branchRodada(demanda_id, r.rodada_id),
    })),
    dependencias_rodada: plano.rodadas.flatMap((r) =>
      r.depende.map((d) => ({ demanda_id, rodada_id: r.rodada_id, depende_rodada_id: d.rodada_id })),
    ),
    criterios_citados: plano.rodadas.flatMap((r) =>
      r.criterios.map((criterio_id) => ({ demanda_id, rodada_id: r.rodada_id, criterio_id })),
    ),
    dependencias_ticket: planos.flatMap((t) =>
      t.depende.map((d) => ({ demanda_id, ticket_id: id(t.ticket_id), depende_ticket_id: id(d.ticket_id) })),
    ),
    caminhos_ticket: planos.flatMap((t) =>
      t.caminhos.map((caminho) => ({ demanda_id, ticket_id: id(t.ticket_id), caminho })),
    ),
  });
}

const FASES_ENCERRADAS: readonly FaseDemanda[] = ["concluida", "arquivada", "cancelada"];
const EntradaReabertura = z.strictObject({
  ticket_id: Id,
  instrucao: Markdown.refine((t) => t.trim() !== "", "informe a instrução"),
});
const EntradaFalha = z.strictObject({
  ticket_id: Id,
  motivo: Markdown.refine((t) => t.trim() !== "", "informe o motivo"),
});
const EntradaDevolucao = z.strictObject({
  ticket_id: Id,
  instrucao: Markdown.refine((t) => t.trim() !== "", "informe a instrução"),
});
export const MAX_DEVOLUCOES = 2;

function ticketEmStatus(ag: AgregadoDemanda, ticket_id: number, status: TicketDemanda["status"], acao: string) {
  const ticket = existe(
    ag.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${String(ticket_id)} não existe`,
    "use um ticket da demanda",
  );
  if (ticket.status !== status) {
    throw new ErroDeRegra(
      `o ticket ${String(ticket_id)} está ${ticket.status} e não pode ${acao}`,
      `só ticket ${status}`,
    );
  }
  return ticket;
}

export const comStatus = (
  ag: AgregadoDemanda,
  alvo: TicketDemanda,
  extra: Partial<TicketDemanda>,
): AgregadoDemanda => ({
  ...ag,
  tickets: ag.tickets.map((t) => (t === alvo ? { ...t, ...extra } : t)),
});

function exigirDemandaEmAndamento(ag: AgregadoDemanda, acao: string): void {
  if (FASES_ENCERRADAS.includes(ag.demanda.fase)) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} está em ${ag.demanda.fase}`,
      `só ${acao} ticket de demanda em andamento`,
    );
  }
}

/** CA-16, CA-4 e CA-7: o ticket em execução passa a `falhou` com o motivo; a fase e os gates da demanda não mudam. */
export function registrarFalhaTicket(ag: AgregadoDemanda, entrada: unknown, ctx: ContextoDemanda): AgregadoDemanda {
  const { ticket_id, motivo } = EntradaFalha.parse(entrada);
  exigirDemandaEmAndamento(ag, "falhar");
  const ticket = ticketEmStatus(ag, ticket_id, "em_execucao", "falhar");
  return comStatus(ag, ticket, { status: "falhou", motivo_falha: motivo, status_alterado_em: ctx.agora });
}

/**
 * CA-1 a CA-3, CA-5, CA-6, CA-12 e CA-13 (D05): só a Fabriquinha devolve, só `implementar`/`resolver_conflito` em
 * execução. Abaixo do limite volta a `aberto` com a instrução; no limite falha com ela como motivo.
 */
export function devolverTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirFabriquinha(ator, "devolver um ticket por reprovação técnica");
  const { ticket_id, instrucao } = EntradaDevolucao.parse(entrada);
  exigirDemandaEmAndamento(ag, "devolver");
  const ticket = ticketEmStatus(ag, ticket_id, "em_execucao", "ser devolvido");
  if (ticket.etapa !== "implementar" && ticket.etapa !== "resolver_conflito") {
    throw new ErroDeRegra(
      `o ticket ${String(ticket_id)} é da etapa ${ticket.etapa} e não admite devolução técnica`,
      "só implementar e resolver_conflito",
    );
  }
  const alterado = ctx.agora;
  return ticket.devolucoes >= MAX_DEVOLUCOES
    ? comStatus(ag, ticket, { status: "falhou", motivo_falha: instrucao, status_alterado_em: alterado })
    : comStatus(ag, ticket, {
        status: "aberto",
        instrucao,
        devolucoes: ticket.devolucoes + 1,
        status_alterado_em: alterado,
      });
}

/** CA-13 a CA-15: só o Auditor, com instrução; o ticket volta a `aberto` (elegível na próxima seleção), sem iniciar execução. */
export function reabrirTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAuditor(ator, "reabrir um ticket");
  const { ticket_id, instrucao } = EntradaReabertura.parse(entrada);
  const ticket = ticketEmStatus(ag, ticket_id, "falhou", "ser reaberto");
  const { motivo_falha: _motivo, ...resto } = ticket;
  return {
    ...ag,
    tickets: ag.tickets.map((t) =>
      t === ticket ? { ...resto, status: "aberto", instrucao, devolucoes: 0, status_alterado_em: ctx.agora } : t,
    ),
  };
}

const EntradaDemanda = z.strictObject({ demanda_id: DemandaId });
const RefRevisaoDemanda = { demanda_id: DemandaId, ticket_id: Id };
const EntradaRevisaoDemanda = z.discriminatedUnion("aprovado", [
  z.strictObject({ ...RefRevisaoDemanda, aprovado: z.literal(true) }),
  z.strictObject({ ...RefRevisaoDemanda, aprovado: z.literal(false), exigencias: Motivo, plano: z.unknown() }),
]);

export function exigirDemandaDaEntrada(ag: AgregadoDemanda, demanda_id: string): void {
  if (demanda_id !== ag.demanda.id) {
    throw new ErroDeRegra(`a referência é da demanda ${demanda_id}, não da ${ag.demanda.id}`, "use o demanda_id certo");
  }
}

/** Recusa se resta rodada fora de `concluida`, implementação não concluída ou ticket ativo/falho (menos o `ignorar`). */
function exigirSemPendencias(ag: AgregadoDemanda, ignorar?: number): void {
  const rodada = ag.rodadas.find((r) => r.fase !== "concluida");
  if (rodada !== undefined) {
    throw new ErroDeRegra(
      `a rodada ${String(rodada.rodada_id)} está em ${rodada.fase}`,
      "todas as rodadas precisam estar concluida",
    );
  }
  const pendente = ag.tickets.find(
    (t) =>
      t.ticket_id !== ignorar &&
      (["aberto", "em_execucao", "falhou"].includes(t.status) ||
        (t.etapa === "implementar" && t.status !== "concluido")),
  );
  if (pendente !== undefined) {
    throw new ErroDeRegra(
      `o ticket ${String(pendente.ticket_id)} está ${pendente.status}`,
      "conclua todo o trabalho pendente antes da revisão integral",
    );
  }
}

export const novoTicketGlobal = (
  ag: AgregadoDemanda,
  etapa: TicketDemanda["etapa"],
  agora: Instante,
): TicketDemanda => ({
  demanda_id: ag.demanda.id,
  ticket_id: Math.max(...ag.tickets.map((t) => t.ticket_id)) + 1,
  etapa,
  status: "aberto",
  devolucoes: 0,
  status_alterado_em: agora,
});

/** CA-12: só a Fabriquinha; com todas as rodadas concluídas e nada pendente, abre `revisar_demanda` e vai a `revisao_demanda`. */
export function iniciarRevisaoDemanda(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirFabriquinha(ator, "iniciar a revisão integral da demanda");
  exigirDemandaDaEntrada(ag, EntradaDemanda.parse(entrada).demanda_id);
  exigirFase(ag, "execucao", "iniciar a revisão integral");
  exigirSemPendencias(ag);
  return {
    ...ag,
    demanda: { ...ag.demanda, fase: "revisao_demanda", fase_alterada_em: ctx.agora },
    tickets: [...ag.tickets, novoTicketGlobal(ag, "revisar_demanda", ctx.agora)],
  };
}

/**
 * CA-13 e CA-14: só o agente do `revisar_demanda` atual. Reprovada, as exigências vão em `motivo` e o plano corretivo
 * cria só rodadas novas (as integradas ficam como estão) e a demanda volta a `execucao`; aprovada, abre
 * `encerrar_demanda` e vai a `encerramento`. Decisão, fechamento do revisor e efeitos andam juntos.
 */
export function registrarRevisaoDemanda(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  const e = EntradaRevisaoDemanda.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  exigirFase(ag, "revisao_demanda", "receber a revisão integral");
  const revisores = ag.tickets.filter((t) => t.etapa === "revisar_demanda");
  const ticket = revisores.find((t) => t.ticket_id === Math.max(...revisores.map((x) => x.ticket_id)));
  if (ticket?.ticket_id !== e.ticket_id || (ticket.status !== "aberto" && ticket.status !== "em_execucao")) {
    throw new ErroDeRegra(
      `o ticket ${String(e.ticket_id)} não é o revisar_demanda ativo`,
      "use o ticket atual da revisão",
    );
  }
  if (ator.tipo !== "agente" || ator.ticket !== ticket.ticket_id) {
    throw new ErroDeEscopo("só o agente do ticket revisar_demanda atual decide a revisão", "peça à sessão de revisão");
  }
  exigirSemPendencias(ag, ticket.ticket_id);
  const decisao: DecisaoDemanda = {
    demanda_id: ag.demanda.id,
    ticket_id: ticket.ticket_id,
    decisao_id: proximaDecisaoId(ag, ticket),
    resultado: e.aprovado ? "aprovado" : "recusado",
    ...(!e.aprovado && { motivo: e.exigencias }),
    por: "agente",
    em: ctx.agora,
  };
  // Plano corretivo vazio ou inválido recusa aqui, antes de qualquer retorno.
  const base = e.aprovado ? ag : materializarRodadasCorretivas(ag, e.plano, ctx.agora);
  const fechado = base.tickets.map((t) =>
    t.ticket_id === ticket.ticket_id ? { ...t, status: "concluido" as const, status_alterado_em: ctx.agora } : t,
  );
  return {
    ...base,
    demanda: { ...base.demanda, fase: e.aprovado ? "encerramento" : "execucao", fase_alterada_em: ctx.agora },
    tickets: e.aprovado ? [...fechado, novoTicketGlobal(base, "encerrar_demanda", ctx.agora)] : fechado,
    decisoes: [...ag.decisoes, decisao],
  };
}
