// O catálogo único das Etapas do SDLC (CONCEITOS.md §2): o que cada uma declara, sem I/O.
import type { ItemCatalogoEtapa } from "./evidencia_etapa.ts";
import { OBRIGATORIAS_DEMANDA, TIPOS_DA_DEMANDA } from "./evidencia_demanda.ts";
import type { NomeGate } from "./agregado_demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import type { EtapaTicket } from "./primitivos.ts";
import type { TipoVerificacao } from "./verificacao.ts";

export interface DefinicaoDaEtapa {
  nome: EtapaTicket;
  objetivo: string;
  escopo: "demanda" | "rodada";
  executor: "agente_autonomo" | "agente_interativo" | "externo" | "fabriquinha";
  evidencias: ItemCatalogoEtapa[];
  verificacoes: TipoVerificacao[];
  capacidades: { skills: string[]; extensoes: string[] };
  /** O nome do `.md` em `aplicacao/etapas/`. */
  instrucao?: string;
  gate?: NomeGate;
}

type Regra = ItemCatalogoEtapa["regraAprovacao"];
const item = (
  etapa: EtapaTicket,
  tipo: ItemCatalogoEtapa["tipo"],
  produtor: ItemCatalogoEtapa["produtor"],
  obrigatoria = true,
  regraAprovacao: Regra = null,
): ItemCatalogoEtapa => ({
  etapa,
  tipo,
  produtor,
  obrigatoria,
  regraAprovacao,
  dono: etapa === "entender_e_desenhar" ? "demanda" : "ticket",
});

const evidenciasDeVerificacao = (etapa: EtapaTicket): ItemCatalogoEtapa[] => [
  item(etapa, "execucao_testes", "fabriquinha", true, "todos_comandos_exit_zero"),
  item(etapa, "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
  item(etapa, "relatorio_sonar", "fabriquinha", true, "sem_issue_aberta_arquivos_alterados"),
];

const VERIFICACOES_DE_CODIGO: TipoVerificacao[] = ["testes", "fitness", "sonar", "hooks_do_commit"];
const EXTENSOES_DO_AGENTE = ["guarda.ts", "pergunta.ts"];
const SEM_CAPACIDADES = { skills: [], extensoes: [] };

export const CATALOGO_DE_ETAPAS: Record<EtapaTicket, DefinicaoDaEtapa> = {
  entender_e_desenhar: {
    nome: "entender_e_desenhar",
    objetivo: "Entender a necessidade e desenhar a solução, com critérios de aceite, até a demanda ser aprovada.",
    escopo: "demanda",
    executor: "externo",
    evidencias: TIPOS_DA_DEMANDA.map((t) =>
      item("entender_e_desenhar", t, "externo", (OBRIGATORIAS_DEMANDA as readonly string[]).includes(t)),
    ),
    verificacoes: [],
    capacidades: SEM_CAPACIDADES,
    gate: "gate_demanda",
  },
  planejar: {
    nome: "planejar",
    objetivo: "Dividir a demanda em rodadas e tickets que cubram todos os critérios de aceite.",
    escopo: "demanda",
    executor: "agente_interativo",
    evidencias: [item("planejar", "plano", "agente")],
    verificacoes: [],
    capacidades: { skills: ["artefato-plano"], extensoes: EXTENSOES_DO_AGENTE },
    instrucao: "planejar.md",
    gate: "gate_planejamento",
  },
  implementar: {
    nome: "implementar",
    objetivo: "Implementar o ticket, com testes, até as verificações passarem.",
    escopo: "rodada",
    executor: "agente_autonomo",
    evidencias: evidenciasDeVerificacao("implementar"),
    verificacoes: VERIFICACOES_DE_CODIGO,
    capacidades: { skills: [], extensoes: EXTENSOES_DO_AGENTE },
    instrucao: "implementar.md",
  },
  revisar_rodada: {
    nome: "revisar_rodada",
    objetivo: "Conferir se a rodada atende os critérios que cita, sem deixar a fitness quebrada.",
    escopo: "rodada",
    executor: "agente_autonomo",
    evidencias: [
      item("revisar_rodada", "arquivos_alterados", "fabriquinha"),
      item("revisar_rodada", "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
      item("revisar_rodada", "explicacao_fitness", "agente"),
      item("revisar_rodada", "comprovacao_criterios", "agente", true, "criterios_rodada_atendidos"),
    ],
    verificacoes: ["fitness"],
    capacidades: {
      skills: ["artefato-explicacao-fitness", "artefato-comprovacao-criterios"],
      extensoes: EXTENSOES_DO_AGENTE,
    },
    instrucao: "revisar_rodada.md",
    gate: "gate_revisao_rodada",
  },
  encerrar_rodada: {
    nome: "encerrar_rodada",
    objetivo: "Fechar a rodada: mensagem e aula do código, produtividade e PR aberto e conferido.",
    escopo: "rodada",
    executor: "agente_autonomo",
    evidencias: [
      item("encerrar_rodada", "mensagem_pr", "agente"),
      item("encerrar_rodada", "aula_codigo", "agente"),
      item("encerrar_rodada", "relatorio_produtividade", "fabriquinha"),
      item("encerrar_rodada", "pr_aberto", "fabriquinha"),
      item("encerrar_rodada", "video_demonstracao", "agente", false),
    ],
    verificacoes: ["conferencia_do_pr"],
    capacidades: {
      skills: ["artefato-mensagem-pr", "artefato-aula-codigo", "artefato-video-demonstracao"],
      extensoes: EXTENSOES_DO_AGENTE,
    },
    instrucao: "encerrar_rodada.md",
    gate: "gate_pr",
  },
  ajustar_resultado: {
    nome: "ajustar_resultado",
    objetivo: "Registrar os tickets corretivos do PR reprovado, sem mudar o código.",
    escopo: "rodada",
    executor: "agente_interativo",
    evidencias: [],
    verificacoes: [],
    capacidades: { skills: [], extensoes: EXTENSOES_DO_AGENTE },
    instrucao: "ajustar_resultado.md",
  },
  revisar_demanda: {
    nome: "revisar_demanda",
    objetivo: "Conferir se a demanda inteira atende os critérios, com estresse e segurança analisados.",
    escopo: "demanda",
    executor: "agente_autonomo",
    evidencias: [
      item("revisar_demanda", "comprovacao_criterios", "agente", true, "criterios_demanda_atendidos"),
      item("revisar_demanda", "testes_estresse", "agente"),
      item("revisar_demanda", "analise_seguranca", "agente"),
    ],
    verificacoes: [],
    capacidades: {
      skills: ["artefato-comprovacao-criterios", "artefato-testes-estresse", "artefato-analise-seguranca"],
      extensoes: EXTENSOES_DO_AGENTE,
    },
    instrucao: "revisar_demanda.md",
    gate: "gate_revisao_demanda",
  },
  encerrar_demanda: {
    nome: "encerrar_demanda",
    objetivo: "Integrar a demanda e limpar o que sobrou, com a árvore de PRs, critérios e custos.",
    escopo: "demanda",
    executor: "fabriquinha",
    evidencias: [
      item("encerrar_demanda", "arvore_prs_criterios_custos", "fabriquinha"),
      item("encerrar_demanda", "demonstracao_limpeza", "fabriquinha", true, "nada_sobrou"),
    ],
    verificacoes: ["conferencia_do_pr"],
    capacidades: SEM_CAPACIDADES,
    instrucao: "encerrar_demanda.md",
  },
  resolver_conflito: {
    nome: "resolver_conflito",
    objetivo: "Resolver o conflito de integração da demanda, com as mesmas verificações do Implementar.",
    escopo: "demanda",
    executor: "agente_autonomo",
    evidencias: evidenciasDeVerificacao("resolver_conflito"),
    verificacoes: VERIFICACOES_DE_CODIGO,
    capacidades: { skills: [], extensoes: EXTENSOES_DO_AGENTE },
    instrucao: "resolver_conflito.md",
  },
};

/** Só `entender_e_desenhar` não tem condução: é externo (CLI de `gestao_demandas.ts`) e existe só no catálogo. */
export function exigirEtapaConduzida(etapa: EtapaTicket): asserts etapa is Exclude<EtapaTicket, "entender_e_desenhar"> {
  if (etapa === "entender_e_desenhar") {
    throw new ErroDeRegra(
      "a etapa entender_e_desenhar não tem condução",
      "ela é feita pelo CLI externo, não pelo despacho",
    );
  }
}
