// A definição do `planejar`: o agente propõe o plano numa sessão com o Auditor, e o gate do planejamento decide.
import { type DefinicaoDaEtapa, evidenciaExigida, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";
import { secaoDoPromptDoPlanejar } from "./secao_do_prompt.ts";

export const DEFINICAO_DO_PLANEJAR: DefinicaoDaEtapa = {
  nome: "planejar",
  objetivo: "Dividir a demanda em rodadas e tickets que cubram todos os critérios de aceite.",
  escopo: "demanda",
  executor: "agente_interativo",
  evidencias: [evidenciaExigida("planejar", "plano", "agente")],
  verificacoes: [],
  metricas: ["uso", "conformidade_com_o_plano"],
  capacidades: { skills: ["artefato-plano"], extensoes: EXTENSOES_DO_AGENTE },
  instrucao: new URL("planejar.md", import.meta.url),
  secaoDoPrompt: secaoDoPromptDoPlanejar,
  gate: { nome: "gate_planejamento", decisor: "auditor", esperaEmEstadoProprio: true, reprovadoVaiPara: "planejar" },
  papel: "planeja_a_demanda",
};
