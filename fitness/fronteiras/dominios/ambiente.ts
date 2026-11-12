// Regras de fronteira do domínio Ambiente (MELHORIAS §8). O ticket 06 muda só este arquivo; o motor (../motor.ts)
// explica os campos e como declarar o domínio migrado.
import type { RegrasDoDominio } from "../motor.ts";

export const REGRAS_DO_AMBIENTE: RegrasDoDominio = {
  migrado: false,
  dependeDe: [],
  subdominios: {
    configuracao: [],
    redes: [],
    sandboxes: ["configuracao", "redes"],
    execucao: ["sandboxes"],
    monitoramento: ["sandboxes"],
  },
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  // O Ambiente em si: a interface e os adapters, a infra do sandbox.
  processoDoHost: { pastasLiberadas: ["modulos/sandbox/infra/"], importamChildProcess: [], chamadoresDiretos: [] },
};
