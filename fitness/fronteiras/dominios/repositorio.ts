// Regras de fronteira do domínio Repositório (MELHORIAS §10), migrado no ticket 07: src/modulos/repositorio/ tem a
// fachada publico.ts e os subdomínios abaixo. O motor (../motor.ts) explica os campos.
import type { Excecao, RegrasDoDominio } from "../motor.ts";

const DE_FORA_SO_PELA_FACHADA = "de fora do domínio repositorio, só pela fachada publico.ts";
const DENTRO_NAO_PELA_FACHADA = "dentro do domínio, use a API do subdomínio, não a fachada";
const SEM_CODIGO_ANTIGO = "um domínio migrado não importa o código antigo";

// provisório: remover no ticket 22. Os caminhos antigos de src/modulos/repositorio/ (relativos a ele) reexportam da
// fachada: ficam fora da organização e importam a fachada por dentro do domínio.
const CAMINHOS_ANTIGOS = [
  "aplicacao/corpo_do_pr.ts",
  "aplicacao/espaco/ambiente_do_espaco.ts",
  "aplicacao/espaco/ciclo_do_espaco.ts",
  "armazenamento/commits_demanda.ts",
  "armazenamento/commits_humanos.ts",
  "infra/git/cadastro.ts",
  "infra/git/commit.ts",
  "infra/git/heatmap.ts",
  "infra/hospedagem/pr.ts",
  "infra/worktree/limpeza_demanda.ts",
  "infra/worktree/worktree-demanda.ts",
  "infra/worktree/worktree.ts",
  "nucleo/commits.ts",
  "nucleo/espaco_de_trabalho.ts",
];

const excecoesDoCaminhoAntigo = (caminho: string): Excecao[] => {
  const [pastaAntiga, ...resto] = caminho.split("/");
  const arquivo = `modulos/repositorio/${caminho}`;
  return [
    {
      arquivo,
      import: `fora da organização: subdomínio ${String(pastaAntiga)} não declarado nas regras de repositorio`,
      ticket: "22",
    },
    { arquivo, import: `${"../".repeat(resto.length)}publico.ts (${DENTRO_NAO_PELA_FACHADA})`, ticket: "22" },
  ];
};

// provisório: remover no ticket 22. O Hospedagem antigo vem do núcleo do Git, sem a fachada: o CLI do agente o empacota.
const CAMINHO_ANTIGO_DA_HOSPEDAGEM = "modulos/repositorio/nucleo/repositorio_do_projeto.ts";
const EXCECOES_DO_CAMINHO_ANTIGO_DA_HOSPEDAGEM: Excecao[] = [
  {
    arquivo: CAMINHO_ANTIGO_DA_HOSPEDAGEM,
    import: "fora da organização: subdomínio nucleo não declarado nas regras de repositorio",
    ticket: "22",
  },
  {
    arquivo: CAMINHO_ANTIGO_DA_HOSPEDAGEM,
    import: "../git/nucleo/repositorio_do_projeto.ts (entre subdomínios, só pelo publico.ts do subdomínio)",
    ticket: "22",
  },
];

// provisório: remover no ticket 22. Quem ainda importa um caminho antigo (cada ticket migra só os próprios imports).
const CONSUMIDORES_DOS_CAMINHOS_ANTIGOS: Record<string, string[]> = {
  "modulos/etapas/agente/adicionar_evidencia.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
  ],
  "modulos/etapas/ajustar_resultado/sessao_ajustes.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/infra/worktree/worktree.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
  ],
  "modulos/etapas/conducao/conducao_de_etapa.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/etapas/encerrar_demanda/conducao_de_encerrar_demanda.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/infra/worktree/limpeza_demanda.ts",
    "../../repositorio/infra/hospedagem/pr.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/etapas/encerrar_demanda/encerramento_demanda.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/aplicacao/corpo_do_pr.ts",
  ],
  "modulos/etapas/encerrar_demanda/publicacao_do_pr_final.ts": [
    "../../repositorio/armazenamento/commits_demanda.ts",
    "../../repositorio/infra/hospedagem/pr.ts",
    "../../repositorio/infra/worktree/worktree.ts",
  ],
  "modulos/etapas/encerrar_rodada/documentacao_do_pr/aula.ts": ["../../../repositorio/infra/worktree/worktree.ts"],
  "modulos/etapas/encerrar_rodada/documentacao_do_pr/pr_rodada.ts": ["../../../repositorio/aplicacao/corpo_do_pr.ts"],
  "modulos/etapas/encerrar_rodada/encerramento_rodada.ts": [
    "../../repositorio/aplicacao/corpo_do_pr.ts",
    "../../repositorio/armazenamento/commits_demanda.ts",
    "../../repositorio/infra/hospedagem/pr.ts",
    "../../repositorio/infra/worktree/worktree.ts",
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/etapas/encerrar_rodada/gate_do_pr/decisao_do_gate.ts": [
    "../../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/etapas/implementar/commit_do_ticket.ts": [
    "../../repositorio/nucleo/commits.ts",
    "../../repositorio/armazenamento/commits_demanda.ts",
    "../../repositorio/infra/git/commit.ts",
    "../../repositorio/infra/worktree/worktree.ts",
  ],
  "modulos/etapas/implementar/conducao_de_implementar.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
  ],
  "modulos/etapas/planejar/decisao_do_gate.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/etapas/resolver_conflito/conducao_de_resolver_conflito.ts": [
    "../../repositorio/armazenamento/commits_demanda.ts",
  ],
  "modulos/etapas/revisar_rodada/revisao_rodada.ts": [
    "../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../repositorio/infra/git/commit.ts",
    "../../repositorio/infra/worktree/worktree.ts",
    "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/projeto/aplicacao/cadastro.ts": [
    "../../repositorio/infra/git/cadastro.ts",
    "../../repositorio/infra/worktree/worktree.ts",
  ],
  "modulos/projeto/nucleo/projeto.ts": ["../../repositorio/nucleo/repositorio_do_projeto.ts"],
  "modulos/sdlc/aplicacao/execucao/execucao_demanda.ts": [
    "../../../repositorio/nucleo/espaco_de_trabalho.ts",
    "../../../repositorio/armazenamento/commits_demanda.ts",
    "../../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts",
    "../../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts",
  ],
  "modulos/sdlc/nucleo/demanda/agregado_demanda.ts": ["../../../repositorio/nucleo/espaco_de_trabalho.ts"],
  "server/consultas/demandas/demanda.ts": ["../../../modulos/repositorio/nucleo/espaco_de_trabalho.ts"],
  "server/consultas/projeto/heatmap.ts": ["../../../modulos/repositorio/infra/git/heatmap.ts"],
  "server/consultas/projeto/projeto.ts": ["../../../modulos/repositorio/nucleo/espaco_de_trabalho.ts"],
  "server/consultas/projeto/sdlc.ts": ["../../../modulos/repositorio/armazenamento/commits_humanos.ts"],
};

// provisório: remover no ticket 22. O Ambiente segue em src/modulos/sandbox/ até o ticket 06 entrar (o 22 troca para a
// fachada dele), e os nomes das branches, a identidade da demanda e o Endereço seguem no vocabulário do SDLC.
const IMPORTS_DO_CODIGO_ANTIGO: Record<string, string[]> = {
  "modulos/repositorio/commits/infra/commit.ts": ["../../../sandbox/infra/ambiente.ts"],
  "modulos/repositorio/coordenacao/aplicacao/ciclo_do_espaco.ts": [
    "../../../sandbox/infra/ambiente.ts",
    "../../../sandbox/aplicacao/conjunto_de_ambientes/conjunto.ts",
    "../../../sandbox/aplicacao/ambiente_do_servico.ts",
  ],
  "modulos/repositorio/espaco_de_trabalho/aplicacao/ambiente_do_espaco.ts": [
    "../../../sandbox/infra/ambiente.ts",
    "../../../sandbox/aplicacao/conjunto_de_ambientes/conjunto.ts",
    "../../../sandbox/aplicacao/ambiente_do_servico.ts",
  ],
  "modulos/repositorio/espaco_de_trabalho/infra/limpeza_demanda.ts": [
    "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts",
    "../../../sandbox/infra/ambiente.ts",
  ],
  "modulos/repositorio/espaco_de_trabalho/infra/worktree-demanda.ts": [
    "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts",
    "../../../sandbox/infra/ambiente.ts",
  ],
  "modulos/repositorio/espaco_de_trabalho/infra/worktree.ts": ["../../../sandbox/infra/ambiente.ts"],
  "modulos/repositorio/espaco_de_trabalho/nucleo/espaco_de_trabalho.ts": [
    "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts",
    "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts",
  ],
  "modulos/repositorio/git/infra/comandos_git.ts": ["../../../sandbox/infra/ambiente.ts"],
};

const excecoesDosImports = (importsPorArquivo: Record<string, string[]>, motivo: string): Excecao[] =>
  Object.entries(importsPorArquivo).flatMap(([arquivo, alvos]) =>
    alvos.map((alvo) => ({ arquivo, import: `${alvo} (${motivo})`, ticket: "22" })),
  );

export const REGRAS_DO_REPOSITORIO: RegrasDoDominio = {
  migrado: true,
  dependeDe: ["ambiente"],
  // Os subdomínios não importam uns aos outros além do Git; só a Coordenação os combina (§10, regra 1).
  subdominios: {
    git: [],
    espaco_de_trabalho: ["git"],
    commits: ["git"],
    historico: ["git"],
    hospedagem: ["git"],
    coordenacao: ["git", "espaco_de_trabalho", "commits", "historico", "hospedagem"],
  },
  // As tabelas do Repositório ainda são tocadas por Métricas (ticket 17), Projetos (18) e Processo (12).
  posseDasTabelas: "inventario",
  excecoes: [
    ...CAMINHOS_ANTIGOS.flatMap(excecoesDoCaminhoAntigo),
    ...EXCECOES_DO_CAMINHO_ANTIGO_DA_HOSPEDAGEM,
    ...excecoesDosImports(CONSUMIDORES_DOS_CAMINHOS_ANTIGOS, DE_FORA_SO_PELA_FACHADA),
    ...excecoesDosImports(IMPORTS_DO_CODIGO_ANTIGO, SEM_CODIGO_ANTIGO),
  ],
  dependenciasToleradas: [],
  // Cada um fala com o `gh`/`az`, o cadastro, o blame ou a rede do git com as credenciais do serviço.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: [
      "modulos/repositorio/commits/infra/commits_humanos.ts",
      "modulos/repositorio/espaco_de_trabalho/infra/limpeza_demanda.ts",
      "modulos/repositorio/espaco_de_trabalho/infra/worktree.ts",
      "modulos/repositorio/git/infra/comandos_git.ts",
      "modulos/repositorio/historico/infra/heatmap.ts",
      "modulos/repositorio/hospedagem/infra/conferencia_do_projeto.ts",
      "modulos/repositorio/hospedagem/infra/pr.ts",
    ],
  },
};
