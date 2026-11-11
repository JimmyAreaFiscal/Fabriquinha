// O que cada Etapa do SDLC declara (CONCEITOS.md §2), sem I/O: o motor lê a definição pelo catálogo, sem trazer a
// condução. Aqui ficam o tipo e os blocos que mais de uma definição reusa.
import type { ItemCatalogoEtapa } from "./evidencia_exigida.ts";
import type { NomeGate } from "../../demanda/nucleo/agregado_demanda.ts";
import type { TipoMetrica } from "../../custos/nucleo/metrica.ts";
import type { EtapaTicket } from "../../compartilhado/nucleo/primitivos.ts";
import type { TipoVerificacao } from "../../qualidade/nucleo/verificacao.ts";
import type { ContextoDoPrompt } from "./secoes_do_prompt.ts";

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
  gate?: NomeGate;
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
