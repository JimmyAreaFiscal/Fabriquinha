// O que o pi tem de comum a todos os modos (F4 §6.1): o pacote P1, a forma de um evento, o nome das skills de artefato
// e a confiança herdada. O resto vive no `HarnessPi`.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Um evento ou resposta do pi: um objeto JSON por linha do stdout. */
export type EventoPi = Record<string, unknown> & { type?: unknown };

/** A raiz do pacote P1 `pi-fabriquinha`, versionado junto com a Fabriquinha (F4 §6.1). */
export const PACOTE = fileURLToPath(new URL("../../../pacote-pi", import.meta.url));

/** O nome da skill de artefato (P1 §5.1) de uma evidência: sai do tipo. @testes as fitness conferem que o catálogo declara as skills que o tipo gera */
export const skillDoTipo = (tipo: string): string => "artefato-" + tipo.replace(/^relatorio_/, "").replaceAll("_", "-");

/** Onde o pi do Auditor guarda `auth.json` e `trust.json`: `$PI_CODING_AGENT_DIR` ou `~/.pi/agent`, como o próprio pi procura. */
export const dirDoPiDoAuditor = (): string => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

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
