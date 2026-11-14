// A definição do `entender_e_desenhar`: a conversa do Auditor com a ferramenta de fora, sem condução (CLI de
// `gestao_do_processo.ts`); as evidências são as da demanda.
import { type DefinicaoDaEtapa, evidenciaExigida, SEM_CAPACIDADES } from "../definicao/definicao_da_etapa.ts";

/** Obrigatórias da demanda no envio (CA-SDLC-01). */
export const OBRIGATORIAS_DEMANDA = ["criterios_aceite", "desenho_solucao"] as const;
const OPCIONAIS_DEMANDA = [
  "comportamento",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
] as const;
/** Os tipos que a própria demanda recebe, as obrigatórias primeiro. */
export const TIPOS_DA_DEMANDA = [...OBRIGATORIAS_DEMANDA, ...OPCIONAIS_DEMANDA] as const;

export const DEFINICAO_DO_ENTENDER_E_DESENHAR = {
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
  exibicao: {
    rotulo: "Demanda",
    acao: "Demanda",
    tituloPadrao: "Registrar a demanda",
    nasMetricas: { titulo: "Entender e desenhar", modo: "Não Gerenciado" },
    comoEstado: { rotulo: "Registro", tom: "neutro", colunaNoInicio: "Registro", colunaNoProjeto: "Registro" },
  },
  gate: {
    nome: "gate_demanda",
    rotulo: "aprovação da demanda",
    decisor: "auditor",
    esperaEmEstadoProprio: true,
    reprovadoVaiPara: "cancelada",
  },
} as const satisfies DefinicaoDaEtapa;
