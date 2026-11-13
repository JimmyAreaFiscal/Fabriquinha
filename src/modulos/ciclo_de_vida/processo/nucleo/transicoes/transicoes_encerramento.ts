// Transições do encerramento final da demanda (comparacao-sdlc-implementacao.md §5): tentativa, retomada, conflito, falhas, integração e conclusão.
// Funções puras (agregado, entrada, ator, contexto) → agregado; cada uma recebe o que a aplicação observou fora do domínio.
import { z } from "zod";
import {
  type Ator,
  CausaDeInfraestrutura,
  etapaDoPapel,
  exigirAtor,
  FABRIQUINHA,
  falhaQueExigeOAuditor,
} from "../../../etapas/publico.ts";
import { branchDemanda } from "../../../../repositorio/publico.ts";
import { DemandaId } from "../../../../../shared/nucleo/demanda_id.ts";
import {
  AgregadoDemanda,
  type ResumoDaDemanda,
  prDaDemanda,
  type PullRequestDoEspaco,
  type TicketDemanda,
} from "../agregado/agregado_demanda.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET, estadoDaDemandaNaEtapa } from "../ciclos/ciclos.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { criarTicket, ticketAtualDaEtapa } from "../../../planejamento/publico.ts";
import { Motivo } from "../../../../../shared/nucleo/primitivos.ts";
import { type ContextoDemanda, exigirDemandaDaEntrada, mudarTicket } from "./transicoes_demanda.ts";

const Texto = z.string().trim().min(1);
const EntradaTentativa = z.strictObject({
  demanda_id: DemandaId,
  base: Texto,
  pr: z.strictObject({ numero: z.number().int().positive(), url: Texto }),
  sha: Texto,
});
const EntradaConflito = z.strictObject({ demanda_id: DemandaId });
const EntradaResolucao = z.strictObject({
  demanda_id: DemandaId,
  testes: z.boolean(),
  fitness: z.boolean(),
  sonar: z.boolean(),
  sha: Texto,
});

const EntradaFalha = z.strictObject({
  demanda_id: DemandaId,
  etapa: z.enum(["check_final", "integracao", "limpeza"]),
  motivo: Motivo,
  /** Presente quando a falha é de infraestrutura: a política retoma sozinha; ausente, ela pede o Auditor. */
  causa: CausaDeInfraestrutura.optional(),
  limpeza_pendente: z.array(Texto).default([]),
});
const EntradaIntegracao = z.strictObject({
  demanda_id: DemandaId,
  confirmada: z.boolean(),
  sha: Texto,
  limpeza_pendente: z.array(Texto),
});
const EntradaSolicitacao = z.strictObject({ demanda_id: DemandaId });
const EntradaConclusao = z.strictObject({ demanda_id: DemandaId, limpeza_pendente: z.array(Texto) });

/** O PR final é o PR do Espaço da demanda: troca o anterior e mantém os das rodadas. */
const comPrDaDemanda = (ag: AgregadoDemanda, pr: Omit<PullRequestDoEspaco, "rodada_id">): PullRequestDoEspaco[] => [
  ...ag.pull_requests.filter((p) => p.rodada_id !== undefined),
  pr,
];

function exigirEncerramento(ag: AgregadoDemanda) {
  const integradora = etapaDoPapel("integra_a_demanda");
  CICLO_DA_DEMANDA.exigir(ag.demanda, estadoDaDemandaNaEtapa(integradora));
  const atual = ticketAtualDaEtapa(ag, integradora);
  if (atual === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem ticket ${integradora}`, "volte à revisão integral");
  }
  return atual;
}

const resolverPendente = (ag: ResumoDaDemanda): TicketDemanda | undefined =>
  ag.tickets.find((t) => t.ticket_id === ag.encerramento?.conflito_pendente?.ticket_id);

const conflitoLiberado = (ag: ResumoDaDemanda): boolean =>
  ag.encerramento?.conflito_pendente === undefined || resolverPendente(ag)?.estado === "concluido";

/** Elegibilidade para a aplicação: o ticket da integração aberto e, havendo conflito, o da resolução concluído. */
export function podeTentarEncerramento(ag: ResumoDaDemanda): boolean {
  const integradora = etapaDoPapel("integra_a_demanda");
  if (ag.demanda.estado !== integradora || ticketAtualDaEtapa(ag, integradora)?.estado !== "aberto") return false;
  return conflitoLiberado(ag);
}

/**
 * CA-1 a CA-3 e CA-13: grava PR, branch, base (da entrada) e SHA; com progresso reaproveita o PR gravado e recusa
 * outro PR ou outra base. A tentativa aceita limpa o conflito pendente e a falha do check final.
 */
export function registrarTentativaEncerramento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "registrar a tentativa de encerramento", "fabriquinha");
  const e = EntradaTentativa.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  const atual = exigirEncerramento(ag);
  // o agendador reserva o ticket (em_execucao) antes de despachar
  if (!CICLO_DO_TICKET.estaEmAndamento(atual.estado) || !conflitoLiberado(ag)) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não está liberada para nova tentativa de encerramento`,
      "o Auditor reabre o ticket falho; o conflito só libera com o resolver_conflito concluído",
    );
  }
  const enc = ag.encerramento;
  const prAtual = prDaDemanda(ag);
  if (enc !== undefined && (enc.base !== e.base || (prAtual !== undefined && prAtual.numero !== e.pr.numero))) {
    throw new ErroDeRegra(
      `o encerramento da demanda ${ag.demanda.id} já guarda o PR ${String(prAtual?.numero)} e a base ${enc.base}`,
      "reaproveite o PR e a base gravados",
    );
  }
  const { conflito_pendente: _, falha, ...resto } = enc ?? { limpeza_pendente: [] };
  return AgregadoDemanda.parse({
    ...ag,
    encerramento: {
      demanda_id: ag.demanda.id,
      branch: branchDemanda(ag.demanda.id),
      ...resto,
      base: e.base,
      sha_verificado: e.sha,
      ...(falha !== undefined && falha.etapa !== "check_final" && { falha }),
    },
    pull_requests: comPrDaDemanda(ag, {
      ...(prAtual ?? { ...e.pr, estado: "aberto" }),
      head: e.sha,
      atualizado_em: ctx.agora,
    }),
  });
}

/** CA-4: integração com conflito; cria `resolver_conflito` aberto e devolve `encerrar_demanda` a `aberto`. Repetir não cria outro. */
export function registrarConflitoEncerramento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "registrar o conflito do encerramento", "fabriquinha");
  exigirDemandaDaEntrada(ag, EntradaConflito.parse(entrada).demanda_id);
  const atual = exigirEncerramento(ag);
  const enc = ag.encerramento;
  if (enc === undefined || enc.integracao !== undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} ${enc === undefined ? "não tem tentativa de encerramento" : "já integrou na base"}`,
      "conflito só existe numa tentativa ainda sem integração",
    );
  }
  if (enc.conflito_pendente !== undefined) return ag;
  if (!CICLO_DO_TICKET.estaEmAndamento(atual.estado)) {
    throw new ErroDeRegra(
      `o ticket ${String(atual.ticket_id)} está ${atual.estado}`,
      "registre o conflito em tentativa ativa",
    );
  }
  const resolver = criarTicket(ag, {
    etapa: etapaDoPapel("resolve_o_conflito_da_integracao"),
    criado_por: FABRIQUINHA,
    agora: ctx.agora,
  });
  const reaberto = mudarTicket(ag, atual, "aberto", ctx.agora);
  return AgregadoDemanda.parse({
    ...reaberto,
    tickets: [...reaberto.tickets, resolver],
    encerramento: { ...enc, conflito_pendente: { ticket_id: resolver.ticket_id } },
  });
}

/** CA-5: com testes, fitness e Sonar verificados, conclui o `resolver_conflito` e grava o novo SHA; sem decisão nem gate. */
export function concluirResolucaoConflito(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "concluir a resolução do conflito", "fabriquinha");
  const e = EntradaResolucao.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  exigirEncerramento(ag);
  const faltam = (["testes", "fitness", "sonar"] as const).filter((k) => !e[k]);
  if (faltam.length > 0) {
    throw new ErroDeRegra(`a resolução não foi verificada: ${faltam.join(", ")}`, "refaça a resolução até tudo passar");
  }
  const resolver = resolverPendente(ag);
  if (ag.encerramento === undefined || resolver === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem conflito pendente`, "registre o conflito antes");
  }
  if (resolver.estado === "concluido" && ag.encerramento.sha_verificado === e.sha) return ag;
  if (!CICLO_DO_TICKET.estaEmAndamento(resolver.estado)) {
    throw new ErroDeRegra(
      `o ticket ${String(resolver.ticket_id)} está ${resolver.estado}`,
      "só conclua resolução ativa",
    );
  }
  return AgregadoDemanda.parse({
    ...mudarTicket(ag, resolver, "concluido", ctx.agora),
    encerramento: { ...ag.encerramento, sha_verificado: e.sha },
    pull_requests: ag.pull_requests.map((p) =>
      p.rodada_id === undefined ? { ...p, head: e.sha, atualizado_em: ctx.agora } : p,
    ),
  });
}

/** Progresso gravado (a base e a branch só nascem na tentativa) com o ticket `encerrar_demanda` em tentativa ativa. */
function exigirTentativaAtiva(ag: AgregadoDemanda, acao: string) {
  const atual = exigirEncerramento(ag);
  if (ag.encerramento === undefined || !CICLO_DO_TICKET.estaEmAndamento(atual.estado)) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não tem tentativa de encerramento ativa para ${acao}`,
      "registre a tentativa antes; o Auditor reabre o ticket falho",
    );
  }
  return { atual, enc: ag.encerramento };
}

/**
 * CA-6, CA-9, CA-11 e CA-13: registra a falha da etapa e falha `encerrar_demanda`. O que já foi feito fica (PR, SHA,
 * integração); a limpeza grava as pendências. A mesma falha repetida devolve o agregado igual.
 */
export function registrarFalhaEncerramento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "registrar a falha do encerramento", "fabriquinha");
  const e = EntradaFalha.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  const falha = { etapa: e.etapa, motivo: e.motivo };
  const anterior = ag.encerramento;
  const repetida =
    exigirEncerramento(ag).estado === "falhou" &&
    anterior?.falha?.etapa === falha.etapa &&
    anterior.falha.motivo === falha.motivo &&
    (e.etapa !== "limpeza" || anterior.limpeza_pendente.join("\n") === e.limpeza_pendente.join("\n"));
  if (repetida) return ag;
  const { atual, enc } = exigirTentativaAtiva(ag, "registrar a falha do encerramento");
  const integrada = enc.integracao !== undefined;
  if (
    e.etapa === "limpeza" ? !integrada || e.limpeza_pendente.length === 0 : integrada || e.limpeza_pendente.length > 0
  ) {
    throw new ErroDeRegra(
      `a falha de ${e.etapa} não cabe no progresso da demanda ${ag.demanda.id}`,
      e.etapa === "limpeza" ? "limpeza falha só após a integração, com pendências" : "a integração já foi confirmada",
    );
  }
  if (e.etapa === "limpeza" && !e.limpeza_pendente.every((p) => enc.limpeza_pendente.includes(p))) {
    throw new ErroDeRegra(
      `a limpeza pendente da demanda ${ag.demanda.id} é ${enc.limpeza_pendente.join(", ")}`,
      "informe só pendências que ainda restam",
    );
  }
  if (e.etapa === "integracao" && prDaDemanda(ag) === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem PR final`, "registre a tentativa antes");
  }
  return AgregadoDemanda.parse({
    ...mudarTicket(
      ag,
      atual,
      "falhou",
      ctx.agora,
      {},
      e.causa === undefined
        ? falhaQueExigeOAuditor(e.motivo)
        : { tipo: "falha_infraestrutura", causa: e.causa, motivo: e.motivo },
    ),
    encerramento: { ...enc, falha, ...(e.etapa === "limpeza" && { limpeza_pendente: e.limpeza_pendente }) },
  });
}

/**
 * CA-10: o PR final passou nas verificações; marca a espera pelo merge humano na plataforma e devolve
 * `encerrar_demanda` a `aberto`, para o agendador reler o PR a cada ciclo. Repetir só devolve o ticket a `aberto`.
 * Com integração confirmada recusa e deixa só a limpeza pendente.
 */
export function solicitarIntegracao(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "solicitar a integração", "fabriquinha");
  exigirDemandaDaEntrada(ag, EntradaSolicitacao.parse(entrada).demanda_id);
  const { atual, enc } = exigirTentativaAtiva(ag, "solicitar a integração");
  if (enc.integracao !== undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} já integrou na base (${enc.integracao.sha})`,
      `não integre de novo; falta só a limpeza: ${enc.limpeza_pendente.join(", ") || "nada"}`,
    );
  }
  if (prDaDemanda(ag) === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem PR final`, "registre a tentativa antes de integrar");
  }
  if (enc.aguardando_merge_humano && atual.estado === "aberto") return ag;
  // A falha de integração anterior (PR fechado, reaberto pelo Auditor) não vale mais: voltou-se a esperar o merge.
  const { falha, ...resto } = enc;
  return AgregadoDemanda.parse({
    ...mudarTicket(ag, atual, "aberto", ctx.agora),
    encerramento: {
      ...resto,
      aguardando_merge_humano: true,
      ...(falha !== undefined && falha.etapa !== "integracao" && { falha }),
    },
  });
}

/**
 * CA-7, CA-8 e CA-13: só a confirmação externa com o SHA marca a integração como feita; grava as pendências de limpeza e
 * limpa a falha de integração. Repetir a mesma confirmação devolve igual; outro SHA recusa.
 */
export function registrarIntegracao(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "registrar a integração", "fabriquinha");
  const e = EntradaIntegracao.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  if (!e.confirmada) {
    throw new ErroDeRegra("a integração não foi confirmada fora do domínio", "só registre a integração confirmada");
  }
  const ja = ag.encerramento?.integracao;
  if (ja !== undefined) {
    exigirEncerramento(ag);
    if (ja.sha === e.sha) return ag;
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} já integrou com o SHA ${ja.sha}`,
      "não registre outra integração",
    );
  }
  const { enc } = exigirTentativaAtiva(ag, "registrar a integração");
  const prFinal = prDaDemanda(ag);
  if (prFinal === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem PR final`, "registre a tentativa antes de integrar");
  }
  const { falha, aguardando_merge_humano: _, ...resto } = enc;
  return AgregadoDemanda.parse({
    ...ag,
    encerramento: {
      ...resto,
      integracao: { sha: e.sha },
      limpeza_pendente: e.limpeza_pendente,
      // O progresso não afirma falha superada: só a falha de integração some, a de check_final já não existe aqui.
      ...(falha !== undefined && falha.etapa !== "integracao" && { falha }),
    },
    pull_requests: comPrDaDemanda(ag, { ...prFinal, estado: "integrado", atualizado_em: ctx.agora }),
  });
}

/** CA-12 e CA-13: integração e limpeza confirmadas; a demanda fica `concluida` e o histórico não muda. */
export function concluirEncerramento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "concluir o encerramento", "fabriquinha");
  const e = EntradaConclusao.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  if (ag.demanda.estado === "concluida" && ag.encerramento?.integracao !== undefined) return ag;
  const { atual, enc } = exigirTentativaAtiva(ag, "concluir o encerramento");
  if (enc.integracao === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não integrou na base`, "conclua só após a integração");
  }
  if (e.limpeza_pendente.length > 0) {
    throw new ErroDeRegra(
      `ainda há limpeza pendente: ${e.limpeza_pendente.join(", ")}`,
      "conclua só com a limpeza feita",
    );
  }
  const { falha: _, ...resto } = enc;
  const concluido = mudarTicket(ag, atual, "concluido", ctx.agora);
  return AgregadoDemanda.parse({
    ...concluido,
    demanda: CICLO_DA_DEMANDA.mudar(concluido.demanda, "concluida", ctx.agora),
    encerramento: { ...resto, limpeza_pendente: [] },
  });
}
