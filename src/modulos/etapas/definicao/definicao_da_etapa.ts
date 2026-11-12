// O que cada Etapa do SDLC declara (CONCEITOS.md §2), sem I/O: o motor lê a definição pelo catálogo, sem trazer a
// condução. Aqui ficam o tipo e os blocos que mais de uma definição reusa. O tipo não cita o nome de Etapa, Gate nem
// estado: cada definição o declara como literal (`as const`), e o catálogo deriva deles `EtapaTicket` e `NomeGate`.
import type {
  ProdutorDaEvidencia,
  RegraAprovacaoEtapa,
  TipoEvidencia,
  TipoMetrica,
  TipoVerificacao,
} from "./tipos_declaraveis.ts";
import type { ExibicaoDaEtapa } from "./exibicao_da_etapa.ts";

/** O Gate que decide depois do trabalho da Etapa; a mecânica é do motor, os efeitos ficam no `gate.ts` da Etapa. */
interface GateDaEtapa<NomeDoGate extends string> {
  nome: NomeDoGate;
  /** O Gate como as telas o citam no meio da frase: "aprovação do PR". */
  rotulo: string;
  decisor: "auditor" | "agente";
  /** O Gate espera a decisão num estado do ciclo só dele, com o nome do Gate; sem isso, decide no estado da Etapa. */
  esperaEmEstadoProprio: boolean;
  /** O estado do ciclo (de uma Etapa, de um Gate ou do motor) a que o ciclo vai quando o Gate reprova. */
  reprovadoVaiPara: string;
}

/**
 * O que uma Etapa só faz nas regras do motor que nenhuma outra cumpre: o motor pergunta ao catálogo qual Etapa tem o
 * papel, em vez de citá-la pelo nome.
 */
export type PapelDaEtapa =
  | "planeja_a_demanda"
  | "publica_o_pr_da_rodada"
  | "ajusta_o_pr_reprovado"
  | "integra_a_demanda"
  | "resolve_o_conflito_da_integracao";

/** Uma evidência exigida pela Etapa; a de `entender_e_desenhar` é da demanda, as das outras são do ticket. */
export interface EvidenciaExigida<NomeDaEtapa extends string = string> {
  etapa: NomeDaEtapa;
  tipo: TipoEvidencia;
  produtor: ProdutorDaEvidencia;
  obrigatoria: boolean;
  regraAprovacao: RegraAprovacaoEtapa | null;
  dono: "demanda" | "ticket";
}

/** A definição de uma Etapa; o catálogo a lê com o nome da Etapa e o do Gate tipados pelo que as Etapas declaram. */
export interface DefinicaoDaEtapa<NomeDaEtapa extends string = string, NomeDoGate extends string = string> {
  nome: NomeDaEtapa;
  objetivo: string;
  escopo: "demanda" | "rodada";
  executor: "agente_autonomo" | "agente_interativo" | "externo" | "fabriquinha";
  evidencias: readonly EvidenciaExigida<NomeDaEtapa>[];
  verificacoes: readonly TipoVerificacao[];
  metricas: readonly TipoMetrica[];
  capacidades: { skills: readonly string[]; extensoes: readonly string[] };
  exibicao: ExibicaoDaEtapa;
  /** O modo de trabalhar da Etapa: o `.md` na pasta dela, lido ao montar o prompt. */
  instrucao?: URL;
  gate?: GateDaEtapa<NomeDoGate>;
  /**
   * Fora da ordem do SDLC (`ORDEM_DO_SDLC` do catálogo): o estado a que a Etapa leva ao terminar. A Etapa na ordem ou
   * com `seguePara` é estado do ciclo do escopo dela; sem nenhum dos dois, roda dentro do estado de outra.
   */
  seguePara?: string;
  /** O estado a que a Etapa devolve o ciclo sem decisão de Gate, quando a conferência dela acha problema. */
  devolvePara?: string;
  papel?: PapelDaEtapa;
  /** A Fabriquinha verifica o código depois do agente e, reprovado, devolve o ticket a ele (D05). */
  devolveAoAgente?: true;
}

/** Uma evidência exigida pela Etapa; a de `entender_e_desenhar` é da demanda, as das outras são do ticket. */
export const evidenciaExigida = <NomeDaEtapa extends string>(
  etapa: NomeDaEtapa,
  tipo: TipoEvidencia,
  produtor: ProdutorDaEvidencia,
  obrigatoria = true,
  regraAprovacao: RegraAprovacaoEtapa | null = null,
): EvidenciaExigida<NomeDaEtapa> => ({
  etapa,
  tipo,
  produtor,
  obrigatoria,
  regraAprovacao,
  dono: etapa === "entender_e_desenhar" ? "demanda" : "ticket",
});

/** As evidências das verificações de código, que a Fabriquinha produz no `implementar` e no `resolver_conflito`. */
export const evidenciasDeVerificacao = <NomeDaEtapa extends string>(
  etapa: NomeDaEtapa,
): EvidenciaExigida<NomeDaEtapa>[] => [
  evidenciaExigida(etapa, "execucao_testes", "fabriquinha", true, "todos_comandos_exit_zero"),
  evidenciaExigida(etapa, "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
  evidenciaExigida(etapa, "relatorio_sonar", "fabriquinha", true, "sem_issue_aberta_arquivos_alterados"),
];

export const VERIFICACOES_DE_CODIGO: readonly TipoVerificacao[] = ["testes", "fitness", "sonar", "hooks_do_commit"];
export const EXTENSOES_DO_AGENTE: readonly string[] = ["guarda.ts", "pergunta.ts"];
export const SEM_CAPACIDADES = { skills: [], extensoes: [] };
