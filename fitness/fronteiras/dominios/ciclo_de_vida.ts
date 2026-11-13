// Regras de fronteira do domínio Ciclo de Vida (MELHORIAS §11). Os tickets 10 a 17 mudam só este arquivo; o motor
// (../motor.ts) explica os campos e como declarar o domínio migrado.
import type { Excecao, RegrasDoDominio } from "../motor.ts";

/** O catálogo de Etapas, que o motor lê na carga do módulo: fora de qualquer ciclo de import de valor. */
export const ARQUIVO_DO_CATALOGO = "modulos/ciclo_de_vida/etapas/nucleo/catalogo.ts";
/**
 * As pastas que podem citar o nome de uma Etapa como dado: o subdomínio Etapas e o que resta de src/modulos/etapas/ (as
 * conduções, que saem no ticket 15). Os demais subdomínios do Ciclo de Vida perguntam ao catálogo.
 */
export const PASTAS_QUE_CITAM_NOME_DE_ETAPA = ["modulos/etapas/", "modulos/ciclo_de_vida/etapas/"];
/** A catraca: arquivos de fora das pastas que ainda citam o nome de uma Etapa. Vazia; o que entrar sai no ticket indicado. */
export const ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA: string[] = [];
/** O único caso de uso que grava em `evidencia_demanda` (além do armazenamento): toda Evidência entra pela submissão. */
export const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "modulos/sdlc/aplicacao/evidencias/submeter.ts";
/**
 * O armazenamento das Evidências, pelo fim do caminho, e as entradas que o exportam (a API de Evidências e a fachada):
 * o `gravar*` dele só se importa de `submeter.ts` e do armazenamento do agregado, por qualquer um desses caminhos.
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

export const REGRAS_DO_CICLO_DE_VIDA: RegrasDoDominio = {
  migrado: true,
  dependeDe: ["sessoes", "repositorio", "ambiente"],
  subdominios: {
    etapas: [],
    planejamento: ["etapas"],
    processo: ["etapas", "planejamento"],
    // O formato do `plano` e a escolha do último ticket concluído de uma Etapa são do Planejamento.
    evidencias: ["etapas", "planejamento"],
    verificacoes: ["etapas"],
    conducao: ["processo", "evidencias", "verificacoes", "etapas"],
    despacho: ["processo", "planejamento", "conducao"],
    metricas_de_qualidade: ["etapas", "planejamento", "processo", "evidencias", "verificacoes"],
  },
  posseDasTabelas: "inventario",
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
