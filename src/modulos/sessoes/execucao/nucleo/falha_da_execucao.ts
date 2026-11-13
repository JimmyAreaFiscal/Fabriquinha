// Como uma execução pode terminar mal, na situação técnica do processo e do modelo (MELHORIAS §9): o que isso
// significa para quem pediu a sessão (retomar, pedir o Auditor) é da política, que traduz esta falha para a dela.

/** As causas técnicas que a execução reconhece, de quem não é culpa do agente. */
type CausaDaFalhaDeInfraestrutura = "tempo_limite" | "cota" | "modelo_sem_resposta" | "servico_externo_inacessivel";

export type FalhaDaExecucao =
  /** O tempo, o provedor ou a rede falharam. */
  | { tipo: "falha_infraestrutura"; causa: CausaDaFalhaDeInfraestrutura; motivo: string }
  /** O processo morreu com o serviço: o reinício o interrompeu. */
  | { tipo: "servico_reiniciado" }
  /** Quem acompanha a sessão mandou abortar. */
  | { tipo: "abortada"; motivo: string }
  /** O agente parou com erro, recusou um comando ou saiu sozinho. */
  | { tipo: "falha_do_agente"; motivo: string };

/** O que o harness relata do provedor do modelo, e a causa de infraestrutura que cada relato revela; o primeiro que casa vale. */
const CAUSAS_DO_ERRO_DO_PROVEDOR: readonly (readonly [RegExp, CausaDaFalhaDeInfraestrutura])[] = [
  [/quota exceeded|usage limit|rate limit|session limit|insufficient_quota|\b429\b/i, "cota"],
  [/ETIMEDOUT|TimeoutError/i, "tempo_limite"],
  [
    /HTTP 5\d\d|\b50[234]\b|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|Connection error|overloaded/i,
    "servico_externo_inacessivel",
  ],
];

/** A falha do agente que parou com erro: de infraestrutura quando o provedor relata cota, rede ou tempo; senão, do agente. */
export function falhaDoErroDoModelo(motivo: string): FalhaDaExecucao {
  const causa = CAUSAS_DO_ERRO_DO_PROVEDOR.find(([relato]) => relato.test(motivo))?.[1];
  return causa === undefined ? { tipo: "falha_do_agente", motivo } : { tipo: "falha_infraestrutura", causa, motivo };
}
