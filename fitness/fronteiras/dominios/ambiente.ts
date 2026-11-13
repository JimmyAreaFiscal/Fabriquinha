// Regras de fronteira do domínio Ambiente (MELHORIAS §8); o motor (../motor.ts) explica os campos.
import type { RegrasDoDominio } from "../motor.ts";

// O Ambiente em si: os adapters que executam no host e no container, e o gerador que cria e elimina os containers.
const PASTAS_DO_AMBIENTE_QUE_FALAM_COM_O_HOST = [
  "modulos/ambiente/execucao/infra/",
  "modulos/ambiente/sandboxes/infra/",
];

export const REGRAS_DO_AMBIENTE: RegrasDoDominio = {
  dependeDe: [],
  subdominios: {
    configuracao: [],
    redes: [],
    sandboxes: ["configuracao", "redes"],
    execucao: ["sandboxes"],
    monitoramento: ["sandboxes"],
  },
  processoDoHost: {
    pastasLiberadas: PASTAS_DO_AMBIENTE_QUE_FALAM_COM_O_HOST,
    importamChildProcess: [],
    chamadoresDiretos: [],
  },
};
