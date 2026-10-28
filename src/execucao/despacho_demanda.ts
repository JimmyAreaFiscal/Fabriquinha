// Despacho das demandas (comparacao-sdlc-implementacao.md §§4.1, 4.2 e 6): a cada ciclo do agendador e no "Executar agora",
// escolhe o trabalho pela seleção global (o agente não escolhe), reserva e cria a execução na mesma transação e entrega
// ao serviço da etapa. pi, git e testes ficam fora da transação: rodam em segundo plano, depois dela.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import { formatarTicketRef } from "../dominio/demanda.ts";
import { ErroDeRegra, existe } from "../dominio/erros.ts";
import { reservarTicket } from "../dominio/reserva_ticket.ts";
import { selecionarTrabalhoGlobal } from "../dominio/selecao_trabalho.ts";
import { escrever } from "../persistencia/banco.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { demandasParaDespacho, ocupacaoDoLimite, retomadasDePlanejamento } from "../persistencia/despacho_demanda.ts";
import { noLog } from "../persistencia/execucoes.ts";
import { type Configuracao, limiteParalelismo } from "../persistencia/servico.ts";
import { carregarSessoesDoTicket } from "../persistencia/sessoes.ts";
import { concluirEncerramentoRodada, iniciarEncerramentoRodada } from "./encerramento_rodada.ts";
import { conduzirEncerramentoDemanda, type DepsEncerramentoDemanda } from "./encerramento_demanda.ts";
import { iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { falharTicketDemanda } from "./fechamento_ticket.ts";
import { iniciarOuRetomarPlanejamento } from "./planejamento.ts";
import { conduzirRevisaoIntegral, iniciarRevisaoIntegral } from "./revisao_demanda.ts";
import { conduzirRevisaoRodada } from "./revisao_rodada.ts";

export interface DepsDespacho {
  /** Início da execução do `implementar`; injetável nos testes para não subir o pi (padrão: `iniciarExecucaoDemanda`). */
  iniciarExecucao?: typeof iniciarExecucaoDemanda;
  /** Espera da verificação do PR no `encerrar_demanda`; injetável nos testes. */
  verificacao?: DepsEncerramentoDemanda["verificacao"];
}

/** Espera a etapa em segundo plano; o erro vai ao log, então a promessa devolvida nunca rejeita. */
const acompanhar = (fim: Promise<unknown>): Promise<void> => fim.then(() => undefined, noLog);

const rodadaDe = (t: TicketDemanda) => ({
  demanda_id: t.demanda_id,
  rodada_id: existe(t.rodada_id, `o ticket ${formatarTicketRef(t)} não é de uma rodada`, "use um ticket de rodada"),
});

/** Encerra a rodada: conduz o agente e, ao fim, confere e publica o PR; a falha do agente ou da publicação falha o ticket. */
async function encerrarRodada(banco: DatabaseSync, t: TicketDemanda, limiteMin: number): Promise<unknown> {
  const rodada = rodadaDe(t);
  const { id, fim } = iniciarEncerramentoRodada(banco, rodada, limiteMin);
  await fim;
  const erro = carregarSessoesDoTicket(banco, t).execucoes.find((e) => e.id === id)?.erro;
  if (erro !== undefined) {
    falharTicketDemanda(banco, t, erro);
    return;
  }
  return falharSePreso(banco, t, () => concluirEncerramentoRodada(banco, rodada));
}

/** Roda `etapa`; se ela recusar sem falhar o ticket (documentação, estado), falha-o para não ficar preso em execução. */
async function falharSePreso<T>(banco: DatabaseSync, t: TicketDemanda, etapa: () => Promise<T>): Promise<T> {
  try {
    return await etapa();
  } catch (erro) {
    const atual = carregarDemanda(banco, t.demanda_id).tickets.find((x) => x.ticket_id === t.ticket_id);
    if (atual?.status === "em_execucao") falharTicketDemanda(banco, t, (erro as Error).message);
    throw erro;
  }
}

/**
 * Reserva o ticket e inicia a etapa dele. Chamada dentro de `escrever`: a recusa síncrona desfaz a reserva. A promessa
 * devolvida é da etapa em segundo plano (as revisões, que são `async`, recusam por ela).
 */
function iniciarEtapa(banco: DatabaseSync, t: TicketDemanda, c: Configuracao, deps: DepsDespacho): Promise<unknown> {
  const { demanda_id, ticket_id } = t;
  const limiteMin = c.timeoutMin;
  if (t.etapa === "planejar") return iniciarOuRetomarPlanejamento(banco, demanda_id, limiteMin).fim;
  if (t.etapa === "implementar" || t.etapa === "resolver_conflito" || t.etapa === "encerrar_demanda") {
    const ctx = { agora: new Date().toISOString() };
    comDemanda(banco, demanda_id, (ag) => reservarTicket(ag, { ticket_id }, FABRIQUINHA, ctx, true));
    if (t.etapa === "encerrar_demanda") {
      return falharSePreso(banco, t, () =>
        conduzirEncerramentoDemanda(banco, demanda_id, { verificacao: deps.verificacao }),
      );
    }
    // A instrução do ticket aberto vem da devolução técnica (D05) ou da reabertura do Auditor: vai ao prompt.
    const retomada = t.instrucao
      ? { tipo: t.devolucoes > 0 ? ("devolucao" as const) : ("reabertura" as const), motivo: t.instrucao }
      : undefined;
    return (deps.iniciarExecucao ?? iniciarExecucaoDemanda)(banco, t, { limiteMin, retomada }).fim;
  }
  if (t.etapa === "revisar_rodada") {
    return conduzirRevisaoRodada(banco, rodadaDe(t), { limiteMin });
  }
  if (t.etapa === "revisar_demanda") return conduzirRevisaoIntegral(banco, demanda_id, { limiteMin });
  return encerrarRodada(banco, t, limiteMin); // a seleção só devolve as sete etapas acima
}

/** Roda `inicio` numa transação (a recusa síncrona desfaz a reserva) e acompanha a etapa; o que falhar vai ao log. */
function disparar(banco: DatabaseSync, inicio: () => Promise<unknown>): Promise<void>[] {
  const etapas: Promise<unknown>[] = [];
  try {
    escrever(banco, () => {
      etapas.push(inicio());
    });
  } catch (erro) {
    noLog(erro);
  }
  return etapas.map(acompanhar);
}

/**
 * Um ciclo do agendador: (1) a demanda cujas rodadas todas concluíram vai à revisão integral; (2) retomam-se os
 * planejamentos reprovados, até as vagas; (3) a seleção global escolhe o resto no que sobra do limite. Devolve as etapas
 * em segundo plano (nunca rejeitam); o ciclo não as espera.
 */
export function despacharDemandas(banco: DatabaseSync, c: Configuracao, deps: DepsDespacho = {}): Promise<void>[] {
  for (const { agregado: ag } of demandasParaDespacho(banco)) {
    if (ag.demanda.fase !== "execucao" || !ag.rodadas.every((r) => r.fase === "concluida")) continue;
    try {
      iniciarRevisaoIntegral(banco, ag.demanda.id);
    } catch (erro) {
      noLog(erro);
    }
  }
  const limite = limiteParalelismo(banco);
  const vagas = limite - ocupacaoDoLimite(banco);
  const retomados = retomadasDePlanejamento(banco).slice(0, Math.max(0, vagas));
  const fins = retomados.flatMap((id) =>
    disparar(banco, () => iniciarOuRetomarPlanejamento(banco, id, c.timeoutMin).fim),
  );
  const escolhidos = selecionarTrabalhoGlobal(demandasParaDespacho(banco), {
    limite,
    emAndamento: ocupacaoDoLimite(banco),
  });
  return [...fins, ...escolhidos.flatMap((t) => disparar(banco, () => iniciarEtapa(banco, t, c, deps)))];
}

/**
 * "Executar agora": a mesma elegibilidade e o mesmo limite global do ciclo, na mesma transação da reserva. Recusa com o
 * motivo, sem criar execução; duas tentativas seguidas geram uma só (a 2ª encontra o ticket já em execução). Devolve a
 * etapa em segundo plano, que nunca rejeita.
 */
export function executarAgoraDemanda(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
  c: Configuracao,
  deps: DepsDespacho = {},
): Promise<void> {
  return escrever(banco, () => {
    const { agregado, predecessoras_satisfeitas } = existe(
      demandasParaDespacho(banco).find((d) => d.agregado.demanda.id === ref.demanda_id),
      `a demanda ${ref.demanda_id} não está em planejamento, execução, revisão da demanda nem encerramento`,
      "só se executa agora o ticket de uma demanda dessas fases",
    );
    const ticket = existe(
      agregado.tickets.find((t) => t.ticket_id === ref.ticket_id),
      `o ticket ${formatarTicketRef(ref)} não existe`,
      "confira o endereço do ticket",
    );
    if (ticket.status !== "aberto") {
      throw new ErroDeRegra(
        `o ticket ${formatarTicketRef(ref)} está ${ticket.status}`,
        "só se executa agora um ticket aberto",
      );
    }
    if (ocupacaoDoLimite(banco) >= limiteParalelismo(banco)) {
      throw new ErroDeRegra("o limite global de paralelismo está ocupado", "espere uma execução terminar");
    }
    // Ensaio da reserva: a recusa diz por que a seleção não escolheria o ticket (predecessora pendente, rodada ocupada...).
    reservarTicket(
      agregado,
      { ticket_id: ref.ticket_id },
      FABRIQUINHA,
      { agora: new Date().toISOString() },
      predecessoras_satisfeitas,
    );
    return acompanhar(iniciarEtapa(banco, ticket, c, deps));
  });
}
