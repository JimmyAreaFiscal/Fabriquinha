// Regras de fronteira do domínio Demandas (MELHORIAS §12), migrado no ticket 18: src/modulos/demandas/ tem a fachada
// publico.ts e os subdomínios Projetos (18), Pedidos e Dependências (19). O motor (../motor.ts) explica os campos.
import type { Excecao, RegrasDoDominio } from "../motor.ts";

// provisório: remover no ticket 22. O contrato da API do agente, que o CLI do agente (pacote-pi) empacota, lê o Projeto
// pelo caminho antigo, e a fachada levaria o banco e o git para dentro do pacote: o caminho antigo reexporta direto do
// núcleo de Projetos, e o núcleo lê o Hospedagem pelo caminho antigo do Repositório, pelo mesmo motivo.
const EXCECOES_DO_PROJETO_NO_CLI_DO_AGENTE: Excecao[] = [
  {
    arquivo: "modulos/projeto/nucleo/projeto.ts",
    import: "../../demandas/projetos/nucleo/projeto.ts (de fora do domínio demandas, só pela fachada publico.ts)",
    ticket: "22",
  },
  {
    arquivo: "modulos/demandas/projetos/nucleo/projeto.ts",
    import:
      "../../../repositorio/nucleo/repositorio_do_projeto.ts (de fora do domínio repositorio, só pela fachada publico.ts)",
    ticket: "22",
  },
];

export const REGRAS_DE_DEMANDAS: RegrasDoDominio = {
  migrado: true,
  // Do Ciclo de Vida, só os tipos públicos de configuração, pela fachada.
  dependeDe: ["repositorio", "ciclo_de_vida"],
  subdominios: {
    projetos: [],
    pedidos: ["projetos"],
    dependencias: ["pedidos"],
  },
  // As tabelas de Demandas ainda são tocadas por SQL de fora: `projeto` pelas Métricas (ticket 17); `demanda`, cuja linha
  // guarda também as colunas do processo (estado, branch, enviada), pelo agregado do sdlc e pelas leituras que juntam
  // domínios (Processo, 22; consultas, 21); `dependencia_demanda` pela leitura das predecessoras com o estado (Despacho,
  // 20); e a remoção do projeto toca as de Pedidos (22).
  posseDasTabelas: "inventario",
  excecoes: [
    ...EXCECOES_DO_PROJETO_NO_CLI_DO_AGENTE,
    // provisório: remover no ticket 22, que decide o dono do mapeador das colunas da configuração do agente.
    {
      arquivo: "modulos/demandas/projetos/armazenamento/projetos.ts",
      import:
        "../../../compartilhado/armazenamento/configuracao_agente.ts (um domínio migrado não importa o código antigo)",
      ticket: "22",
    },
  ],
  dependenciasToleradas: [],
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [], chamadoresDiretos: [] },
};
