// Regras de fronteira do domínio Ambiente (MELHORIAS §8). O ticket 06 muda só este arquivo; o motor (../motor.ts)
// explica os campos e como declarar o domínio migrado.
import type { RegrasDoDominio } from "../motor.ts";

// O Ambiente em si: os adapters que executam no host e no container, e o gerador que cria e elimina os containers.
const PASTAS_DO_AMBIENTE_QUE_FALAM_COM_O_HOST = [
  "modulos/ambiente/execucao/infra/",
  "modulos/ambiente/sandboxes/infra/",
];

export const REGRAS_DO_AMBIENTE: RegrasDoDominio = {
  migrado: true,
  dependeDe: [],
  subdominios: {
    configuracao: [],
    redes: [],
    sandboxes: ["configuracao", "redes"],
    execucao: ["sandboxes"],
    monitoramento: ["sandboxes"],
  },
  // A tabela `ambiente` só passa por sandboxes/armazenamento. Fica de fora da posse estrita, até o ticket 22, a
  // Configuração do Ambiente, que lê e grava as colunas `ambiente_*` da linha única de `configuracao` (dono:
  // ciclo_de_vida/despacho) em configuracao/armazenamento/: §8 dá esses dados ao Ambiente, então a saída é a posse
  // deles, e não a leitura pela borda.
  posseDasTabelas: "estrita",
  excecoes: [],
  dependenciasToleradas: [],
  processoDoHost: {
    pastasLiberadas: PASTAS_DO_AMBIENTE_QUE_FALAM_COM_O_HOST,
    importamChildProcess: [],
    chamadoresDiretos: [],
  },
};
