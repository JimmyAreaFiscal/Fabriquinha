// O que o pi tem de comum a todos os modos (F4 §6.1): o pacote P1, o nome das skills de artefato, a pasta do pi do
// Auditor e a confiança herdada. O resto vive no `HarnessPi`.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { dirDoPiDoAuditor } from "../../../../../shared/infra/isolamento_do_ambiente.ts";

/** O nome da skill de artefato (P1 §5.1) de uma evidência: sai do tipo. @testes as fitness conferem que o catálogo declara as skills que o tipo gera */
export const skillDoTipo = (tipo: string): string => "artefato-" + tipo.replace(/^relatorio_/, "").replaceAll("_", "-");

/**
 * F4 §6.1.1: a decisão de confiança mais próxima de `repo` (o próprio caminho ou um pai) no `trust.json` do pi.
 * `undefined`: vale o padrão do Auditor.
 */
export function confianca(repo: string): boolean | undefined {
  const arquivo = join(dirDoPiDoAuditor(), "trust.json");
  const decisoes = (existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")) : {}) as Record<string, unknown>;
  const maisProxima = (dir: string): boolean | undefined => {
    const decisao = decisoes[dir];
    if (typeof decisao === "boolean") return decisao;
    return dir === dirname(dir) ? undefined : maisProxima(dirname(dir));
  };
  return maisProxima(realpathSync(repo));
}
