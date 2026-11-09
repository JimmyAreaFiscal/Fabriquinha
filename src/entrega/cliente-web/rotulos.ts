import type { EtapaTicket } from "../../nucleo/primitivos.ts";

/** A etapa do ticket como as telas a mostram: o `tsc` exige as nove chaves. */
export const ROTULO_DA_ETAPA: Record<EtapaTicket, string> = {
  entender_e_desenhar: "Demanda",
  planejar: "Planejamento",
  implementar: "Implementação",
  revisar_rodada: "Revisão da rodada",
  encerrar_rodada: "Encerramento da rodada",
  ajustar_resultado: "Sessão em aberto",
  revisar_demanda: "Revisão da demanda",
  encerrar_demanda: "Encerramento da demanda",
  resolver_conflito: "Resolução de conflito",
};

/** A etapa como ação, no formulário de configuração e nas métricas, na ordem do fluxo da demanda. */
export const ACAO_DA_ETAPA: Record<keyof typeof ROTULO_DA_ETAPA, string> = {
  entender_e_desenhar: "Demanda",
  planejar: "Planejar",
  implementar: "Implementar",
  revisar_rodada: "Revisar rodada",
  encerrar_rodada: "Encerrar rodada",
  ajustar_resultado: "Sessão em aberto",
  revisar_demanda: "Revisar demanda",
  encerrar_demanda: "Encerrar demanda",
  resolver_conflito: "Resolver conflito",
};

/** O título do ticket que não tem um: o que a etapa faz. */
export const TITULO_PADRAO_DA_ETAPA: Record<keyof typeof ROTULO_DA_ETAPA, string> = {
  entender_e_desenhar: "Registrar a demanda",
  planejar: "Planejar a demanda",
  implementar: "Implementar",
  revisar_rodada: "Revisar a rodada",
  encerrar_rodada: "Encerrar a rodada",
  ajustar_resultado: "Sessão de ajustes",
  resolver_conflito: "Resolver o conflito",
  revisar_demanda: "Revisar a demanda",
  encerrar_demanda: "Encerrar a demanda",
};

/** O nome da fase do processo (Registrar, Planejar, Implementar, Revisar, Encerrar) que a etapa abre: o verbo do título dela. */
export const faseDoProcesso = (etapa: EtapaTicket): string => TITULO_PADRAO_DA_ETAPA[etapa].replace(/ .*/, "");
