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

// provisório: remover no ticket 22. O que a Condução e as transições que ela pede ao Processo ainda leem do código antigo:
// o agregado da demanda e o carregamento dele, o Gate ligado ao agregado e as transições que as regras dos gates usam, a
// submissão das Evidências e a decisão comum dos gates (sdlc), o projeto cadastrado e a varredura de commits humanos pelo
// adaptador de projeto/ (o Ciclo de Vida passa a receber o projeto como dado), a produtividade da rodada (Métricas, 17), a
// pasta do processo do compartilhado e a configuração do serviço. A tabela `configuracao` é do Despacho (16), que depende
// da Condução: a Condução lê o timeout e a ociosidade pelo caminho antigo do compartilhado, que reexporta do arquivo do
// Despacho, até o ticket 22 entregá-los como dado (hoje o Gate do PR e o chat do Auditor os leem sem passar pelo Despacho).
const IMPORTS_DO_CODIGO_ANTIGO: Record<string, string[]> = {
  "conducao/aplicacao/agente/adicionar_evidencia.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../sdlc/aplicacao/evidencias/submeter.ts",
  ],
  "conducao/aplicacao/agente/consultas.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../sdlc/aplicacao/consultas/visao_da_demanda.ts",
    "../../../../projeto/aplicacao/cadastro.ts",
  ],
  "conducao/aplicacao/agente/criar_ticket_corretivo.ts": ["../../../../sdlc/armazenamento/demandas.ts"],
  "conducao/aplicacao/agente/decidir_revisao.ts": ["../../../../sdlc/armazenamento/demandas.ts"],
  "conducao/aplicacao/agente/escopo.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
  ],
  "conducao/aplicacao/ajustar_resultado/conducao_de_ajustar_resultado.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
  ],
  "conducao/aplicacao/ajustar_resultado/sessao_ajustes.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../projeto/armazenamento/projetos.ts",
  ],
  "conducao/aplicacao/conducao_de_etapa/conducao_de_etapa.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../compartilhado/armazenamento/servico.ts",
  ],
  "conducao/aplicacao/conducao_de_etapa/mensagem_do_auditor.ts": [
    "../../../../compartilhado/armazenamento/servico.ts",
    "../../../../sdlc/aplicacao/sessoes/sessoes_demanda.ts",
  ],
  "conducao/aplicacao/encerrar_demanda/conducao_de_encerrar_demanda.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../projeto/nucleo/projeto.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../sdlc/aplicacao/evidencias/submeter.ts",
    "../../../../projeto/aplicacao/varredura_de_commits_humanos.ts",
  ],
  "conducao/aplicacao/encerrar_demanda/encerramento_demanda.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../metricas/aplicacao/produtividade_rodada.ts",
  ],
  "conducao/aplicacao/encerrar_demanda/publicacao_do_pr_final.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../projeto/nucleo/projeto.ts",
  ],
  "conducao/aplicacao/encerrar_rodada/conducao_de_encerrar_rodada.ts": ["../../../../sdlc/armazenamento/demandas.ts"],
  "conducao/aplicacao/encerrar_rodada/documentacao_do_pr/aula.ts": [
    "../../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
  ],
  "conducao/aplicacao/encerrar_rodada/documentacao_do_pr/pr_rodada.ts": [
    "../../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../../metricas/aplicacao/produtividade_rodada.ts",
  ],
  "conducao/aplicacao/encerrar_rodada/encerramento_rodada.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/aplicacao/evidencias/submeter.ts",
    "../../../../metricas/aplicacao/produtividade_rodada.ts",
    "../../../../projeto/aplicacao/varredura_de_commits_humanos.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
  ],
  "conducao/aplicacao/encerrar_rodada/gate.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/nucleo/gate.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_rodada.ts",
  ],
  "conducao/aplicacao/encerrar_rodada/gate_do_pr/aprovacao_pr_rodada.ts": [
    "../../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../../sdlc/nucleo/gate.ts",
  ],
  "conducao/aplicacao/encerrar_rodada/gate_do_pr/decisao_do_gate.ts": [
    "../../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../../sdlc/aplicacao/gates/decisao_do_gate.ts",
    "../../../../../sdlc/armazenamento/demandas.ts",
    "../../../../../projeto/armazenamento/projetos.ts",
  ],
  "conducao/aplicacao/entender_e_desenhar/gate.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/nucleo/gate.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
  ],
  "conducao/aplicacao/execucao/execucao_demanda.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../projeto/nucleo/projeto.ts",
    "../../../../projeto/aplicacao/varredura_de_commits_humanos.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../compartilhado/infra/registro.ts",
  ],
  "conducao/aplicacao/execucao/lancamento_do_ticket.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../projeto/nucleo/projeto.ts",
  ],
  "conducao/aplicacao/execucao/modelo_effort.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../projeto/nucleo/projeto.ts",
  ],
  "conducao/aplicacao/gates.ts": ["../../../sdlc/aplicacao/gates/decisao_do_gate.ts"],
  "conducao/aplicacao/implementar/commit_do_ticket.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../projeto/aplicacao/varredura_de_commits_humanos.ts",
  ],
  "conducao/aplicacao/implementar/conducao_de_implementar.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../projeto/nucleo/projeto.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../sdlc/aplicacao/evidencias/submeter.ts",
  ],
  "conducao/aplicacao/planejar/conducao_de_planejar.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
  ],
  "conducao/aplicacao/planejar/decisao_do_gate.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/aplicacao/gates/decisao_do_gate.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../projeto/aplicacao/varredura_de_commits_humanos.ts",
  ],
  "conducao/aplicacao/planejar/gate.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/nucleo/gate.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
  ],
  "conducao/aplicacao/politica_dos_agentes/processo_do_ticket.ts": ["../../../../compartilhado/infra/registro.ts"],
  "conducao/aplicacao/prompt/contexto_do_prompt.ts": ["../../../../sdlc/nucleo/demanda/agregado_demanda.ts"],
  "conducao/aplicacao/prompt/secoes_do_prompt.ts": ["../../../../sdlc/nucleo/demanda/agregado_demanda.ts"],
  "conducao/aplicacao/revisar_demanda/gate.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/nucleo/gate.ts",
    "../../../../sdlc/nucleo/demanda/plano.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
  ],
  "conducao/aplicacao/revisar_rodada/conducao_de_revisar_rodada.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
  ],
  "conducao/aplicacao/revisar_rodada/gate.ts": [
    "../../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../../sdlc/nucleo/gate.ts",
    "../../../../sdlc/nucleo/demanda/plano.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
    "../../../../sdlc/nucleo/transicoes/transicoes_rodada.ts",
  ],
  "conducao/aplicacao/revisar_rodada/revisao_rodada.ts": [
    "../../../../projeto/armazenamento/projetos.ts",
    "../../../../sdlc/armazenamento/demandas.ts",
    "../../../../sdlc/aplicacao/evidencias/submeter.ts",
  ],
  // O Despacho lê o agregado da demanda e o grava pela unidade de trabalho do sdlc, pede ao sdlc a reserva, a retomada
  // do ticket falho por infraestrutura e a revisão integral (as transições ainda moram lá), e a retomada lê o modelo
  // configurado no projeto cadastrado pelo caminho antigo de projeto/.
  "despacho/aplicacao/despacho.ts": [
    "../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../sdlc/armazenamento/demandas.ts",
    "../../../sdlc/aplicacao/revisao_demanda.ts",
  ],
  "despacho/aplicacao/retomada_infraestrutura.ts": [
    "../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
    "../../../projeto/armazenamento/projetos.ts",
    "../../../sdlc/armazenamento/demandas.ts",
  ],
  "despacho/armazenamento/despacho_demanda.ts": [
    "../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../sdlc/armazenamento/demandas.ts",
  ],
  "despacho/nucleo/despacho.ts": [
    "../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../sdlc/nucleo/transicoes/transicoes_encerramento.ts",
  ],
  "despacho/nucleo/reserva_ticket.ts": [
    "../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
  ],
  "processo/aplicacao/transicoes_pedidas.ts": [
    "../../../sdlc/nucleo/demanda/agregado_demanda.ts",
    "../../../sdlc/nucleo/gate.ts",
    "../../../sdlc/armazenamento/demandas.ts",
    "../../../sdlc/nucleo/despacho/reserva_ticket.ts",
    "../../../sdlc/nucleo/transicoes/transicoes_demanda.ts",
    "../../../sdlc/nucleo/transicoes/conclusao_ticket.ts",
    "../../../sdlc/nucleo/transicoes/transicoes_rodada.ts",
    "../../../sdlc/nucleo/transicoes/transicoes_encerramento.ts",
  ],
};

// provisório: remover no ticket 22. As transições pedidas ao Processo ficam fora da API dele: elas importam o agregado do
// sdlc, que importa a fachada do Ciclo de Vida, e a API na fachada fecharia o ciclo de import (TDZ na carga do agregado).
const ARQUIVO_DAS_TRANSICOES_PEDIDAS = "modulos/ciclo_de_vida/processo/aplicacao/transicoes_pedidas.ts";
const QUEM_PEDE_TRANSICAO_AO_PROCESSO = [
  "agente/criar_ticket_corretivo.ts",
  "ajustar_resultado/sessao_ajustes.ts",
  "conducao_de_etapa/conducao_de_etapa.ts",
  "encerrar_demanda/conducao_de_encerrar_demanda.ts",
  "encerrar_rodada/encerramento_rodada.ts",
  "encerrar_rodada/gate_do_pr/decisao_do_gate.ts",
  "execucao/execucao_demanda.ts",
  "implementar/conducao_de_implementar.ts",
  "planejar/decisao_do_gate.ts",
  "resolver_conflito/conducao_de_resolver_conflito.ts",
].map((arquivo) => `modulos/ciclo_de_vida/conducao/aplicacao/${arquivo}`);

// provisório: remover no ticket 22. Os caminhos antigos da Condução. A API dela fica fora da fachada pelo mesmo ciclo
// com o sdlc; os de src/modulos/etapas/ (que só o servidor e os testes importam) reexportam dela, e os que o sdlc importa
// reexportam do próprio arquivo, sem trazer a Condução inteira de volta ao sdlc no meio da carga dele.
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
  ["modulos/sdlc/aplicacao/despacho/fechamento_ticket.ts", ARQUIVO_DAS_TRANSICOES_PEDIDAS],
  ...["execucao_demanda.ts", "lancamento_do_ticket.ts", "modelo_effort.ts"].map((arquivo): [string, string] => [
    `modulos/sdlc/aplicacao/execucao/${arquivo}`,
    `modulos/ciclo_de_vida/conducao/aplicacao/execucao/${arquivo}`,
  ]),
  [
    "modulos/sdlc/nucleo/contexto_do_prompt.ts",
    "modulos/ciclo_de_vida/conducao/aplicacao/prompt/contexto_do_prompt.ts",
  ],
  ...["condutor.ts", "trabalho_do_ticket.ts"].map((arquivo): [string, string] => [
    `modulos/trabalho_agentico/aplicacao/trabalho/${arquivo}`,
    `modulos/ciclo_de_vida/conducao/aplicacao/politica_dos_agentes/${arquivo}`,
  ]),
];

// provisório: remover no ticket 22. A API do Despacho fica fora da fachada pelo mesmo ciclo com o sdlc. Quem a usa por
// fora do domínio (a composição, as consultas e o fluxo do despacho do servidor) importa a API; a API do servidor, que
// não pode ter exceção, segue pelos caminhos antigos, que reexportam do arquivo de origem; e o sdlc lê a seleção e a
// configuração do serviço direto do arquivo, sem trazer a Condução de volta ao sdlc no meio da carga dele.
const API_DO_DESPACHO = "modulos/ciclo_de_vida/despacho/publico.ts";
const DESPACHO = "modulos/ciclo_de_vida/despacho/";
const CAMINHOS_ANTIGOS_DO_DESPACHO: [string, string][] = [
  ["modulos/sdlc/aplicacao/despacho/despacho.ts", API_DO_DESPACHO],
  ["modulos/sdlc/aplicacao/despacho/despacho.ts", API_DA_CONDUCAO],
  ["modulos/sdlc/aplicacao/despacho/retomada_infraestrutura.ts", API_DO_DESPACHO],
  ["modulos/sdlc/nucleo/despacho/despacho.ts", `${DESPACHO}nucleo/despacho.ts`],
  ["modulos/sdlc/nucleo/despacho/reserva_ticket.ts", `${DESPACHO}nucleo/reserva_ticket.ts`],
  ["modulos/sdlc/armazenamento/despacho_demanda.ts", `${DESPACHO}armazenamento/despacho_demanda.ts`],
  ["modulos/compartilhado/armazenamento/servico.ts", `${DESPACHO}armazenamento/configuracao_do_servico.ts`],
  ["modulos/projeto/aplicacao/configuracao_do_agente.ts", `${DESPACHO}aplicacao/configuracao_do_servico.ts`],
  ["modulos/sdlc/nucleo/demanda/pendencia.ts", `${DESPACHO}nucleo/despacho.ts`],
  ["modulos/sdlc/aplicacao/sessoes/sessoes_demanda.ts", `${DESPACHO}armazenamento/configuracao_do_servico.ts`],
  ...[
    "composicao/servico.ts",
    "consultas/configuracao.ts",
    "consultas/demandas/demanda.ts",
    "consultas/demandas/pendencias.ts",
    "fluxos/ciclo_do_servico/despacho_do_trabalho.ts",
  ].map((arquivo): [string, string] => [`server/${arquivo}`, `modulos/ciclo_de_vida/despacho/publico.ts`]),
  // O fluxo do despacho entrega ao Despacho as conduções que a composição monta (o tipo delas é da Condução).
  ["server/fluxos/ciclo_do_servico/despacho_do_trabalho.ts", API_DA_CONDUCAO],
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
  ...QUEM_PEDE_TRANSICAO_AO_PROCESSO.map((arquivo) => ({
    arquivo,
    import: `${importRelativo(arquivo, ARQUIVO_DAS_TRANSICOES_PEDIDAS)} (entre subdomínios, só pelo publico.ts do subdomínio)`,
    ticket: "22",
  })),
  ...[...CAMINHOS_ANTIGOS_DA_CONDUCAO, ...CAMINHOS_ANTIGOS_DO_DESPACHO].map(([arquivo, alvo]) => ({
    arquivo,
    import: `${importRelativo(arquivo, alvo)} (de fora do domínio ciclo_de_vida, só pela fachada publico.ts)`,
    ticket: "22",
  })),
];

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
    // As conduções leem o plano e o ticket atual de cada Etapa, e a recuperação acha os tickets presos, no Planejamento.
    conducao: ["processo", "evidencias", "verificacoes", "etapas", "planejamento"],
    // O vocabulário do SDLC e o catálogo (o executor e o papel de cada Etapa) são de Etapas.
    despacho: ["processo", "planejamento", "conducao", "etapas"],
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
    ...EXCECOES_DA_CONDUCAO,
  ],
  // O compartilhado reexporta o vocabulário, a configuração do agente e os estados do ticket da fachada, e o Planejamento
  // lê dele o mapeador das colunas da configuração do agente: os dois somem no ticket 22.
  // A Condução e as transições pedidas ao Processo ainda leem o agregado da demanda no sdlc, o projeto cadastrado e a
  // produtividade da rodada pelos caminhos antigos, que importam a fachada.
  dependenciasToleradas: [
    { de: "modulos/compartilhado", para: "modulos/ciclo_de_vida", removidaEm: "22" },
    { de: "modulos/ciclo_de_vida", para: "modulos/sdlc", removidaEm: "22" },
    { de: "modulos/ciclo_de_vida", para: "modulos/projeto", removidaEm: "22" },
    { de: "modulos/ciclo_de_vida", para: "modulos/metricas", removidaEm: "22" },
  ],
  // O sonar-scanner fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: ["modulos/ciclo_de_vida/verificacoes/infra/tipos_de_verificacao/sonar.ts"],
  },
};
