import { existsSync, readdirSync, readFileSync } from "node:fs";

/** O estado e o grupo do processo `pid` em `/proc`; o nome vem entre parênteses e pode ter espaço, então se lê depois do último `)`. */
const estadoEGrupoDe = (pid: string): [string, string] | undefined => {
  try {
    const [estado, , grupo] = readFileSync(`/proc/${pid}/stat`, "utf8")
      .replace(/^.*\)\s/s, "")
      .split(" ");
    return [String(estado), String(grupo)];
  } catch {
    return undefined;
  }
};

/**
 * O grupo de processo existe e tem algum membro que não é zumbi. Sem um PID 1 que colha filhos (o sandbox roda
 * `tail -f`), o processo morto vira zumbi e `kill(-grupo, 0)` ainda o vê; onde há /proc, o zumbi não conta.
 */
export const grupoDeProcessoVivo = (grupo: number): boolean => {
  try {
    process.kill(-grupo, 0);
  } catch {
    return false;
  }
  if (!existsSync("/proc/self/stat")) return true;
  return readdirSync("/proc").some((pid) => {
    const processo = /^\d+$/.test(pid) ? estadoEGrupoDe(pid) : undefined;
    return processo?.[1] === String(grupo) && processo[0] !== "Z";
  });
};
