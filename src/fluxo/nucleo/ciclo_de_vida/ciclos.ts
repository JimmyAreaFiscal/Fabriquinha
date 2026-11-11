// Os três ciclos de vida: o de cada Demanda, Rodada e Ticket, e o mapa de estado para Etapa.
import { CicloDeVida } from "./ciclo_de_vida.ts";
import type {
  EstadoDemanda,
  EstadoRodada,
  EstadoTicket,
  EtapaTicket,
} from "../../../compartilhado/nucleo/primitivos.ts";

export const CICLO_DA_DEMANDA = new CicloDeVida<EstadoDemanda>({
  transicoes: {
    entender_e_desenhar: ["gate_demanda", "cancelada"],
    gate_demanda: ["planejar", "cancelada"],
    planejar: ["gate_planejamento", "cancelada"],
    gate_planejamento: ["planejar", "em_execucao", "cancelada"],
    em_execucao: ["revisar_demanda", "cancelada"],
    revisar_demanda: ["em_execucao", "encerrar_demanda", "cancelada"],
    encerrar_demanda: ["concluida", "cancelada"],
    concluida: ["arquivada"],
    arquivada: [],
    cancelada: [],
  },
  terminais: ["concluida", "arquivada", "cancelada"],
  satisfazemDependencia: ["concluida", "arquivada"],
  emAndamento: [
    "entender_e_desenhar",
    "gate_demanda",
    "planejar",
    "gate_planejamento",
    "em_execucao",
    "revisar_demanda",
    "encerrar_demanda",
  ],
});

export const CICLO_DA_RODADA = new CicloDeVida<EstadoRodada>({
  transicoes: {
    implementar: ["revisar_rodada"],
    revisar_rodada: ["encerrar_rodada", "implementar"],
    encerrar_rodada: ["gate_pr", "implementar"],
    gate_pr: ["ajustar_resultado", "concluida"],
    ajustar_resultado: ["implementar"],
    concluida: [],
  },
  terminais: ["concluida"],
  satisfazemDependencia: ["concluida"],
  emAndamento: ["implementar", "revisar_rodada", "encerrar_rodada", "gate_pr", "ajustar_resultado"],
});

// `aberto` volta a `aberto` quando a Fabriquinha repete o registro do conflito ou da integração do encerramento.
export const CICLO_DO_TICKET = new CicloDeVida<EstadoTicket>({
  transicoes: {
    aberto: ["aberto", "em_execucao", "concluido", "falhou", "cancelado"],
    em_execucao: ["aberto", "concluido", "falhou", "cancelado"],
    falhou: ["aberto", "cancelado"],
    concluido: [],
    cancelado: [],
  },
  terminais: ["concluido", "cancelado"],
  satisfazemDependencia: ["concluido"],
  emAndamento: ["aberto", "em_execucao"],
});

/** A Etapa do trabalho de um estado: o próprio nome, ou a do ticket que o Gate espera; sem Etapa, `undefined`. */
export function etapaDoEstado(estado: EstadoDemanda | EstadoRodada): EtapaTicket | undefined {
  switch (estado) {
    case "gate_demanda":
      return "entender_e_desenhar";
    case "gate_planejamento":
      return "planejar";
    case "gate_pr":
      return "encerrar_rodada";
    case "em_execucao":
    case "concluida":
    case "arquivada":
    case "cancelada":
      return undefined;
    default:
      return estado;
  }
}
