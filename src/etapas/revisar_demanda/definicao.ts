// A definição do `revisar_demanda`: o agente confere a demanda inteira na worktree dela e decide o gate.
import { type DefinicaoDaEtapa, evidenciaExigida, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";
import { secaoVerificacoesJaFeitas } from "../definicao/secoes_do_prompt.ts";

export const DEFINICAO_DO_REVISAR_DEMANDA: DefinicaoDaEtapa = {
  nome: "revisar_demanda",
  objetivo: "Conferir se a demanda inteira atende os critérios, com estresse e segurança analisados.",
  escopo: "demanda",
  executor: "agente_autonomo",
  evidencias: [
    evidenciaExigida("revisar_demanda", "comprovacao_criterios", "agente", true, "criterios_demanda_atendidos"),
    evidenciaExigida("revisar_demanda", "testes_estresse", "agente"),
    evidenciaExigida("revisar_demanda", "analise_seguranca", "agente"),
  ],
  verificacoes: [],
  metricas: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  capacidades: {
    skills: ["artefato-comprovacao-criterios", "artefato-testes-estresse", "artefato-analise-seguranca"],
    extensoes: EXTENSOES_DO_AGENTE,
  },
  instrucao: new URL("revisar_demanda.md", import.meta.url),
  secaoDoPrompt: secaoVerificacoesJaFeitas,
  gate: {
    nome: "gate_revisao_demanda",
    decisor: "agente",
    esperaEmEstadoProprio: false,
    reprovadoVaiPara: "em_execucao",
  },
};
