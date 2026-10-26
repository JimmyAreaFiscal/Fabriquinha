// Transições do encerramento final da demanda (comparacao-sdlc-implementacao.md §5): tentativa, retomada e conflito.
// Funções puras (agregado, entrada, ator, contexto) → agregado; cada uma recebe o que a aplicação observou fora do domínio.
import { z } from "zod";
import { type Ator, exigirFabriquinha } from "./agregado.ts";
import { AgregadoDemanda, type TicketDemanda } from "./agregado_demanda.ts";
import { branchDemanda, DemandaId } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import {
  comStatus,
  type ContextoDemanda,
  exigirDemandaDaEntrada,
  exigirFase,
  novoTicketGlobal,
} from "./transicoes_demanda.ts";

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

/** O ticket mais recente da etapa (os tickets são anexados em ordem de id). */
const ticketAtual = (ag: AgregadoDemanda, etapa: TicketDemanda["etapa"]): TicketDemanda | undefined =>
  ag.tickets.findLast((t) => t.etapa === etapa);

function exigirEncerramento(ag: AgregadoDemanda, acao: string) {
  exigirFase(ag, "encerramento", acao);
  const atual = ticketAtual(ag, "encerrar_demanda");
  if (atual === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem ticket encerrar_demanda`, "volte à revisão integral");
  }
  return atual;
}

const resolverPendente = (ag: AgregadoDemanda): TicketDemanda | undefined =>
  ag.tickets.find((t) => t.ticket_id === ag.encerramento?.conflito_pendente?.ticket_id);

/** Elegibilidade para a aplicação: `encerrar_demanda` aberto e, havendo conflito, o `resolver_conflito` concluído. */
export function podeTentarEncerramento(ag: AgregadoDemanda): boolean {
  if (ag.demanda.fase !== "encerramento" || ticketAtual(ag, "encerrar_demanda")?.status !== "aberto") return false;
  return ag.encerramento?.conflito_pendente === undefined || resolverPendente(ag)?.status === "concluido";
}

/**
 * CA-1 a CA-3 e CA-13: grava PR, branch, base (da entrada) e SHA; com progresso reaproveita o PR gravado e recusa
 * outro PR ou outra base. A tentativa aceita limpa o conflito pendente e a falha do check final.
 */
export function registrarTentativaEncerramento(ag: AgregadoDemanda, entrada: unknown, ator: Ator): AgregadoDemanda {
  exigirFabriquinha(ator, "registrar a tentativa de encerramento");
  const e = EntradaTentativa.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  exigirEncerramento(ag, "registrar a tentativa de encerramento");
  if (!podeTentarEncerramento(ag)) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} não está liberada para nova tentativa de encerramento`,
      "o Auditor reabre o ticket falho; o conflito só libera com o resolver_conflito concluído",
    );
  }
  const enc = ag.encerramento;
  if (enc !== undefined && (enc.base !== e.base || (enc.pr !== undefined && enc.pr.numero !== e.pr.numero))) {
    throw new ErroDeRegra(
      `o encerramento da demanda ${ag.demanda.id} já guarda o PR ${String(enc.pr?.numero)} e a base ${enc.base}`,
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
      pr: enc?.pr ?? e.pr,
      sha_verificado: e.sha,
      ...(falha !== undefined && falha.etapa !== "check_final" && { falha }),
    },
  });
}

/** CA-4: integração com conflito; cria `resolver_conflito` aberto e devolve `encerrar_demanda` a `aberto`. Repetir não cria outro. */
export function registrarConflitoEncerramento(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirFabriquinha(ator, "registrar o conflito do encerramento");
  exigirDemandaDaEntrada(ag, EntradaConflito.parse(entrada).demanda_id);
  const atual = exigirEncerramento(ag, "registrar o conflito do encerramento");
  const enc = ag.encerramento;
  if (enc === undefined || enc.integracao !== undefined) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} ${enc === undefined ? "não tem tentativa de encerramento" : "já integrou na base"}`,
      "conflito só existe numa tentativa ainda sem integração",
    );
  }
  if (enc.conflito_pendente !== undefined) return ag;
  if (atual.status !== "aberto" && atual.status !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket ${String(atual.ticket_id)} está ${atual.status}`,
      "registre o conflito em tentativa ativa",
    );
  }
  const resolver = novoTicketGlobal(ag, "resolver_conflito", ctx.agora);
  const reaberto = comStatus(ag, atual, { status: "aberto", status_alterado_em: ctx.agora });
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
  exigirFabriquinha(ator, "concluir a resolução do conflito");
  const e = EntradaResolucao.parse(entrada);
  exigirDemandaDaEntrada(ag, e.demanda_id);
  exigirEncerramento(ag, "concluir a resolução do conflito");
  const faltam = (["testes", "fitness", "sonar"] as const).filter((k) => !e[k]);
  if (faltam.length > 0) {
    throw new ErroDeRegra(`a resolução não foi verificada: ${faltam.join(", ")}`, "refaça a resolução até tudo passar");
  }
  const resolver = resolverPendente(ag);
  if (ag.encerramento === undefined || resolver === undefined) {
    throw new ErroDeRegra(`a demanda ${ag.demanda.id} não tem conflito pendente`, "registre o conflito antes");
  }
  if (resolver.status === "concluido" && ag.encerramento.sha_verificado === e.sha) return ag;
  if (resolver.status !== "aberto" && resolver.status !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket ${String(resolver.ticket_id)} está ${resolver.status}`,
      "só conclua resolução ativa",
    );
  }
  return AgregadoDemanda.parse({
    ...comStatus(ag, resolver, { status: "concluido", status_alterado_em: ctx.agora }),
    encerramento: { ...ag.encerramento, sha_verificado: e.sha },
  });
}
