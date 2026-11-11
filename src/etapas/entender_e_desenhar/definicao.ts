// A definição do `entender_e_desenhar`: a conversa do Auditor com a ferramenta de fora, sem condução (CLI de
// `gestao_demandas.ts`); as evidências são as da demanda.
import { OBRIGATORIAS_DEMANDA, TIPOS_DA_DEMANDA } from "../../qualidade/nucleo/evidencias/evidencia_demanda.ts";
import { type DefinicaoDaEtapa, evidenciaExigida, SEM_CAPACIDADES } from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_ENTENDER_E_DESENHAR: DefinicaoDaEtapa = {
  nome: "entender_e_desenhar",
  objetivo: "Entender a necessidade e desenhar a solução, com critérios de aceite, até a demanda ser aprovada.",
  escopo: "demanda",
  executor: "externo",
  evidencias: TIPOS_DA_DEMANDA.map((tipo) =>
    evidenciaExigida(
      "entender_e_desenhar",
      tipo,
      "externo",
      (OBRIGATORIAS_DEMANDA as readonly string[]).includes(tipo),
    ),
  ),
  verificacoes: [],
  metricas: ["uso", "aprovacoes_e_reprovacoes"],
  capacidades: SEM_CAPACIDADES,
  gate: "gate_demanda",
};
