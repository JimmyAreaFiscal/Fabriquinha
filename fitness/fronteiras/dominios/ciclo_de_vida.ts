// Regras de fronteira do domínio Ciclo de Vida (MELHORIAS §11). Os tickets 10 a 17 mudam só este arquivo; o motor
// (../motor.ts) explica os campos e como declarar o domínio migrado.
import { dirname, relative } from "node:path";
import type { Excecao, RegrasDoDominio } from "../motor.ts";

/** O catálogo de Etapas, que o motor lê na carga do módulo: fora de qualquer ciclo de import de valor. */
export const ARQUIVO_DO_CATALOGO = "modulos/ciclo_de_vida/etapas/nucleo/catalogo.ts";
/**
 * As pastas que podem citar o nome de uma Etapa como dado: o subdomínio Etapas, a Condução (uma condução e um gate por
 * Etapa) e os caminhos antigos de src/modulos/etapas/ (o ticket 22 os remove). Os demais subdomínios do Ciclo de Vida
 * perguntam ao catálogo.
 */
export const PASTAS_QUE_CITAM_NOME_DE_ETAPA = [
  "modulos/etapas/",
  "modulos/ciclo_de_vida/etapas/",
  "modulos/ciclo_de_vida/conducao/",
];
/** A catraca: arquivos de fora das pastas que ainda citam o nome de uma Etapa. Vazia; o que entrar sai no ticket indicado. */
export const ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA: string[] = [];
/** O único caso de uso que grava em `evidencia_demanda` (além do armazenamento): toda Evidência entra pela submissão. */
export const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "modulos/ciclo_de_vida/processo/aplicacao/submissao_de_evidencia.ts";
/**
 * O armazenamento das Evidências, pelo fim do caminho, e as entradas que o exportam (a API de Evidências e a fachada):
 * o `gravar*` dele só se importa da submissão do Processo e do armazenamento do agregado, por qualquer um desses caminhos.
 */
export const ARMAZENAMENTO_DE_EVIDENCIA = "armazenamento/evidencia_demanda.ts";
export const ENTRADAS_DO_ARMAZENAMENTO_DE_EVIDENCIA = [
  ARMAZENAMENTO_DE_EVIDENCIA,
  "ciclo_de_vida/evidencias/publico.ts",
  "ciclo_de_vida/publico.ts",
];
/** Os casos de uso do agente, os únicos que a API do agente alcança. */
export const PASTA_DOS_CASOS_DE_USO_DO_AGENTE = "modulos/etapas/agente/";

// provisório: remover no ticket 22. Os caminhos antigos que o CLI do agente empacota vêm da API de Etapas, sem a fachada:
// ela traz Verificações, que leem as fachadas de Repositório e Ambiente, e com elas o banco.
const CAMINHOS_ANTIGOS_QUE_O_CLI_DO_AGENTE_EMPACOTA: Excecao[] = (
  [
    ["modulos/compartilhado/nucleo/configuracao_agente.ts", "../../"],
    ["modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts", "../../../"],
    ["modulos/compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts", "../../../"],
    ["modulos/etapas/catalogo.ts", "../"],
    ["modulos/etapas/definicao/tipos_declaraveis.ts", "../../"],
  ] as const
).map(([arquivo, subidaAteModulos]) => ({
  arquivo,
  import: `${subidaAteModulos}ciclo_de_vida/etapas/publico.ts (de fora do domínio ciclo_de_vida, só pela fachada publico.ts)`,
  ticket: "22",
}));

// provisório: remover no ticket 22. O que a Condução ainda lê do código antigo: a pasta do processo do compartilhado e a
// configuração do serviço. A tabela `configuracao` é do Despacho, que depende da Condução: a Condução lê o timeout e a
// ociosidade pelo caminho antigo do compartilhado, que reexporta do arquivo do Despacho, até recebê-los como dado (hoje o
// Gate do PR e o chat do Auditor os leem sem passar pelo Despacho).
const IMPORTS_DO_CODIGO_ANTIGO: Record<string, string[]> = {
  "conducao/aplicacao/chat_do_auditor/marcas_da_conversa.ts": ["../../../../compartilhado/infra/registro.ts"],
  "conducao/aplicacao/conducao_de_etapa/conducao_de_etapa.ts": ["../../../../compartilhado/armazenamento/servico.ts"],
  "conducao/aplicacao/conducao_de_etapa/mensagem_do_auditor.ts": ["../../../../compartilhado/armazenamento/servico.ts"],
  "conducao/aplicacao/execucao/execucao_demanda.ts": ["../../../../compartilhado/infra/registro.ts"],
  "conducao/aplicacao/politica_dos_agentes/processo_do_ticket.ts": ["../../../../compartilhado/infra/registro.ts"],
};

// provisório: remover no ticket 22. Os caminhos antigos da Condução: os de src/modulos/etapas/ (que só o servidor e os
// testes importam) reexportam da API dela, e os de trabalho_agentico/, do próprio arquivo.
const API_DA_CONDUCAO = "modulos/ciclo_de_vida/conducao/publico.ts";
const CAMINHOS_ANTIGOS_DA_CONDUCAO: [string, string][] = [
  ...[
    "agente/adicionar_evidencia.ts",
    "agente/consultas.ts",
    "agente/criar_ticket_corretivo.ts",
    "agente/decidir_revisao.ts",
    "agente/escopo.ts",
    "agente/tipo_do_agente.ts",
    "ajustar_resultado/sessao_ajustes.ts",
    "conducao/conducao_de_etapa.ts",
    "conducao/mensagem_do_auditor.ts",
    "conducoes.ts",
    "encerrar_demanda/encerramento_demanda.ts",
    "encerrar_rodada/documentacao_do_pr/pr_rodada.ts",
    "encerrar_rodada/encerramento_rodada.ts",
    "gates.ts",
    "implementar/conducao_de_implementar.ts",
    "planejar/conducao_de_planejar.ts",
    "prompt/prompt_demanda.ts",
    "resolver_conflito/conducao_de_resolver_conflito.ts",
  ].map((arquivo): [string, string] => [`modulos/etapas/${arquivo}`, API_DA_CONDUCAO]),
  ...["condutor.ts", "trabalho_do_ticket.ts"].map((arquivo): [string, string] => [
    `modulos/trabalho_agentico/aplicacao/trabalho/${arquivo}`,
    `modulos/ciclo_de_vida/conducao/aplicacao/politica_dos_agentes/${arquivo}`,
  ]),
];

// provisório: remover no ticket 22. Os caminhos antigos do Despacho que ainda têm importador: a configuração do serviço,
// que a Condução lê pelo compartilhado (o ticket 22 a entrega como dado) e a configuração do agente de projeto/.
const DESPACHO = "modulos/ciclo_de_vida/despacho/";
const CAMINHOS_ANTIGOS_DO_DESPACHO: [string, string][] = [
  ["modulos/compartilhado/armazenamento/servico.ts", `${DESPACHO}armazenamento/configuracao_do_servico.ts`],
  ["modulos/projeto/aplicacao/configuracao_do_agente.ts", `${DESPACHO}aplicacao/configuracao_do_servico.ts`],
];

// provisório: remover no ticket 22. O contrato do servidor só importa o núcleo do código antigo, e o CLI do agente o
// empacota: os caminhos antigos do sdlc que ele lê reexportam dos arquivos do Processo, sem a fachada.
const PROCESSO = "modulos/ciclo_de_vida/processo/nucleo/";
const CAMINHOS_ANTIGOS_QUE_O_CONTRATO_LE: [string, string][] = [
  ["modulos/sdlc/nucleo/demanda/agregado_demanda.ts", `${PROCESSO}agregado/agregado_demanda.ts`],
  ["modulos/sdlc/nucleo/demanda/agregado_demanda.ts", `${PROCESSO}gate.ts`],
  ["modulos/sdlc/nucleo/demanda/pendencia.ts", `${PROCESSO}agregado/pendencia.ts`],
  ["modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts", `${PROCESSO}ciclos/ciclos.ts`],
];

const importRelativo = (arquivo: string, alvo: string): string => relative(dirname(arquivo), alvo);

const EXCECOES_DA_CONDUCAO: Excecao[] = [
  ...Object.entries(IMPORTS_DO_CODIGO_ANTIGO).flatMap(([arquivo, alvos]) =>
    alvos.map((alvo) => ({
      arquivo: `modulos/ciclo_de_vida/${arquivo}`,
      import: `${alvo} (um domínio migrado não importa o código antigo)`,
      ticket: "22",
    })),
  ),
  ...[...CAMINHOS_ANTIGOS_DA_CONDUCAO, ...CAMINHOS_ANTIGOS_DO_DESPACHO, ...CAMINHOS_ANTIGOS_QUE_O_CONTRATO_LE].map(
    ([arquivo, alvo]) => ({
      arquivo,
      import: `${importRelativo(arquivo, alvo)} (de fora do domínio ciclo_de_vida, só pela fachada publico.ts)`,
      ticket: "22",
    }),
  ),
];

export const REGRAS_DO_CICLO_DE_VIDA: RegrasDoDominio = {
  migrado: true,
  dependeDe: ["sessoes", "repositorio", "ambiente"],
  subdominios: {
    etapas: [],
    planejamento: ["etapas"],
    // O agregado da demanda carrega as Evidências, e as transições as conferem antes de avançar.
    processo: ["etapas", "planejamento", "evidencias"],
    // O formato do `plano` e a escolha do último ticket concluído de uma Etapa são do Planejamento.
    evidencias: ["etapas", "planejamento"],
    verificacoes: ["etapas"],
    // As conduções leem o plano e o ticket atual de cada Etapa, e a recuperação acha os tickets presos, no Planejamento.
    // A documentação do PR da rodada e o encerramento leem a produtividade da rodada nas Métricas de Qualidade.
    conducao: ["processo", "evidencias", "verificacoes", "etapas", "planejamento", "metricas_de_qualidade"],
    // O vocabulário do SDLC e o catálogo (o executor e o papel de cada Etapa) são de Etapas.
    despacho: ["processo", "planejamento", "conducao", "etapas"],
    metricas_de_qualidade: ["etapas", "planejamento", "processo", "evidencias", "verificacoes"],
  },
  posseDasTabelas: "estrita",
  excecoes: [
    // O mapeador das colunas da configuração do agente ainda mora no compartilhado (Sessões e Projetos também o usam);
    // o ticket 22 o traz para o Ciclo de Vida.
    {
      arquivo: "modulos/ciclo_de_vida/planejamento/armazenamento/itens_do_planejamento.ts",
      import:
        "../../../compartilhado/armazenamento/configuracao_agente.ts (um domínio migrado não importa o código antigo)",
      ticket: "22",
    },
    // A hospedagem do `pr_aberto` é do Repositório. Vem do caminho antigo, que a lê do núcleo do Git, porque a fachada
    // do Repositório levaria o banco e o git para o pacote do CLI do agente, que chega a Evidências pela fachada do
    // Ciclo de Vida; o ticket 22 decide de onde ela vem.
    {
      arquivo: "modulos/ciclo_de_vida/evidencias/nucleo/formatos.ts",
      import:
        "../../../repositorio/nucleo/repositorio_do_projeto.ts (de fora do domínio repositorio, só pela fachada publico.ts)",
      ticket: "22",
    },
    ...CAMINHOS_ANTIGOS_QUE_O_CLI_DO_AGENTE_EMPACOTA,
    ...EXCECOES_DA_CONDUCAO,
  ],
  // O compartilhado reexporta o vocabulário, a configuração do agente e os estados do ticket da fachada, e o Planejamento
  // lê dele o mapeador das colunas da configuração do agente: os dois somem no ticket 22.
  dependenciasToleradas: [{ de: "modulos/compartilhado", para: "modulos/ciclo_de_vida", removidaEm: "22" }],
  // O sonar-scanner fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: ["modulos/ciclo_de_vida/verificacoes/infra/tipos_de_verificacao/sonar.ts"],
  },
};
