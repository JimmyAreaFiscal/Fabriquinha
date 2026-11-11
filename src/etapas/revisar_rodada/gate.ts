// O Gate da revisão da rodada, dono do `revisar_rodada`: o agente revisor aprova a rodada ou a devolve com os corretivos.
import type { AgregadoDemanda, Decisao, TicketDemanda } from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { FABRIQUINHA } from "../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { existe } from "../../compartilhado/nucleo/erros.ts";
import { ancoraNaRodada, type EntradaReprovada, Gate } from "../../sdlc/nucleo/gate.ts";
import { criarTicket } from "../../sdlc/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { type Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { correcaoDosTicketsDaRodada, materializar } from "../../sdlc/nucleo/demanda/plano.ts";
import { falhaQueExigeOAuditor } from "../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import { mudarTicket } from "../../sdlc/nucleo/transicoes/transicoes_demanda.ts";
import {
  montarMotivoFalhaDaTerceiraReprovacao,
  REPROVACOES_ATE_O_AUDITOR,
  rodadasComEstadoMudado,
} from "../../sdlc/nucleo/transicoes/transicoes_rodada.ts";
import { DEFINICAO_DO_REVISAR_RODADA } from "./definicao.ts";

/**
 * CA-2 e CA-3: só o agente do ticket `revisar_rodada` atual. Reprovada, as exigências vão inteiras em `motivo` e as
 * correções nascem na mesma operação (volta a `implementar`); aceita, abre `encerrar_rodada` e vai a `encerrar_rodada`.
 * Na terceira reprovação da rodada (as já gravadas mais esta) não há corretivos: o ticket falha e o estado segue em `revisar_rodada`.
 */
export class GateDaRevisaoDaRodada extends Gate {
  constructor() {
    super(DEFINICAO_DO_REVISAR_RODADA);
  }

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    return ancoraNaRodada(ag, endereco, "revisar_rodada", this.etapaAncora);
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return {
      ...concluido,
      tickets: [
        ...concluido.tickets,
        criarTicket(ag, {
          etapa: "encerrar_rodada",
          rodada: ticket.rodada_id,
          criado_por: FABRIQUINHA,
          agora: decisao.em,
        }),
      ],
      rodadas: rodadasComEstadoMudado(concluido, ticket, "encerrar_rodada", decisao.em),
    };
  }

  protected aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    { correcoes }: EntradaReprovada,
  ): AgregadoDemanda {
    const idsDeRevisaoDaRodada = new Set(
      ag.tickets
        .filter((t) => t.rodada_id === ticket.rodada_id && t.etapa === "revisar_rodada")
        .map((t) => t.ticket_id),
    );
    const motivosDasReprovacoes = ag.decisoes
      .filter((d) => idsDeRevisaoDaRodada.has(d.ticket_id) && d.resultado === "reprovado")
      .map((d) => String(d.motivo)); // reprovado sempre tem motivo (invariante do agregado)
    if (motivosDasReprovacoes.length >= REPROVACOES_ATE_O_AUDITOR) {
      const motivo = montarMotivoFalhaDaTerceiraReprovacao(motivosDasReprovacoes.reverse());
      return mudarTicket(ag, ticket, "falhou", decisao.em, {}, falhaQueExigeOAuditor(motivo));
    }
    // Os mesmos erros de correção vazia ou inválida recusam antes de qualquer retorno.
    const rodada_id = existe(ticket.rodada_id, "o ticket de revisão não tem rodada", "confira a rodada");
    const base = materializar(ag, correcaoDosTicketsDaRodada("revisao_rodada", decisao.por, rodada_id, correcoes), {
      agora: decisao.em,
    });
    const concluido = mudarTicket(base, ticket, "concluido", decisao.em);
    return { ...concluido, rodadas: rodadasComEstadoMudado(concluido, ticket, "implementar", decisao.em) };
  }
}
