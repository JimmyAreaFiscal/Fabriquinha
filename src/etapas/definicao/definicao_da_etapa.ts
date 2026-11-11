// O que cada Etapa do SDLC declara (CONCEITOS.md §2), sem I/O: o motor lê a definição pelo catálogo, sem trazer a
// condução. Aqui ficam o tipo e os blocos que mais de uma definição reusa.
import type { ItemCatalogoEtapa } from "./evidencia_exigida.ts";
import type { NomeGate } from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { TipoMetrica } from "../../custos/nucleo/metrica.ts";
import type { EstadoDemanda, EstadoRodada, EtapaTicket } from "../../compartilhado/nucleo/primitivos.ts";
import type { TipoVerificacao } from "../../qualidade/nucleo/verificacao.ts";
import type { ContextoDoPrompt } from "./secoes_do_prompt.ts";

/** Um estado do Ciclo de Vida da demanda ou da rodada, aonde uma Etapa leva. */
type EstadoDoCiclo = EstadoDemanda | EstadoRodada;

/** O Gate que decide depois do trabalho da Etapa; a mecânica é do motor, os efeitos ficam no `gate.ts` da Etapa. */
interface GateDaEtapa {
  nome: NomeGate;
  decisor: "auditor" | "agente";
  /** O Gate espera a decisão num estado do ciclo só dele, com o nome do Gate; sem isso, decide no estado da Etapa. */
  esperaEmEstadoProprio: boolean;
  /** O estado a que o ciclo vai quando o Gate reprova. */
  reprovadoVaiPara: EstadoDoCiclo;
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

export interface DefinicaoDaEtapa {
  nome: EtapaTicket;
  objetivo: string;
  escopo: "demanda" | "rodada";
  executor: "agente_autonomo" | "agente_interativo" | "externo" | "fabriquinha";
  evidencias: ItemCatalogoEtapa[];
  verificacoes: TipoVerificacao[];
  metricas: TipoMetrica[];
  capacidades: { skills: string[]; extensoes: string[] };
  /** O modo de trabalhar da Etapa: o `.md` na pasta dela, lido ao montar o prompt. */
  instrucao?: URL;
  /** As seções do prompt que só a Etapa lê, com dados que já existem quando o agente dela é lançado. */
  secaoDoPrompt?: (contexto: ContextoDoPrompt) => string;
  gate?: GateDaEtapa;
  /**
   * Fora da ordem do SDLC (`ORDEM_DO_SDLC` do catálogo): o estado a que a Etapa leva ao terminar. A Etapa na ordem ou
   * com `seguePara` é estado do ciclo do escopo dela; sem nenhum dos dois, roda dentro do estado de outra.
   */
  seguePara?: EstadoDoCiclo;
  /** O estado a que a Etapa devolve o ciclo sem decisão de Gate, quando a conferência dela acha problema. */
  devolvePara?: EstadoDoCiclo;
  papel?: PapelDaEtapa;
  /** A Fabriquinha verifica o código depois do agente e, reprovado, devolve o ticket a ele (D05). */
  devolveAoAgente?: true;
}

type RegraDeAprovacao = ItemCatalogoEtapa["regraAprovacao"];

/** Uma evidência exigida pela Etapa; a de `entender_e_desenhar` é da demanda, as das outras são do ticket. */
export const evidenciaExigida = (
  etapa: EtapaTicket,
  tipo: ItemCatalogoEtapa["tipo"],
  produtor: ItemCatalogoEtapa["produtor"],
  obrigatoria = true,
  regraAprovacao: RegraDeAprovacao = null,
): ItemCatalogoEtapa => ({
  etapa,
  tipo,
  produtor,
  obrigatoria,
  regraAprovacao,
  dono: etapa === "entender_e_desenhar" ? "demanda" : "ticket",
});

/** As evidências das verificações de código, que a Fabriquinha produz no `implementar` e no `resolver_conflito`. */
export const evidenciasDeVerificacao = (etapa: EtapaTicket): ItemCatalogoEtapa[] => [
  evidenciaExigida(etapa, "execucao_testes", "fabriquinha", true, "todos_comandos_exit_zero"),
  evidenciaExigida(etapa, "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
  evidenciaExigida(etapa, "relatorio_sonar", "fabriquinha", true, "sem_issue_aberta_arquivos_alterados"),
];

export const VERIFICACOES_DE_CODIGO: TipoVerificacao[] = ["testes", "fitness", "sonar", "hooks_do_commit"];
export const EXTENSOES_DO_AGENTE = ["guarda.ts", "pergunta.ts"];
export const SEM_CAPACIDADES = { skills: [], extensoes: [] };
