// O grupo de processo visto pelos testes: vivo é o que tem algum processo que não seja zumbi.
import { existsSync, readdirSync, readFileSync } from "node:fs";

/** O estado e o grupo de `/proc/<pid>/stat` (`pid (comm) S ppid pgrp ...`); `undefined` se o processo já saiu. */
function estadoEGrupoDoProcesso(pid: string): { estado: string; grupo: number } | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // O `comm` pode ter espaços e parênteses: os campos úteis vêm depois do último `)`.
    const [estado = "", , grupo = ""] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { estado, grupo: Number(grupo) };
  } catch {
    return undefined;
  }
}

/**
 * O grupo `pgid` existe e tem um processo que não é zumbi. O `kill -0` sozinho conta o zumbi, e onde o PID 1 não recolhe
 * órfãos (um container sem init) o processo morto fica zumbi para sempre.
 * shortcut: lê `/proc`, só no Linux; fora dele vale o `kill -0`, e o zumbi conta como vivo.
 */
export function grupoEstaVivo(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
  } catch {
    return false;
  }
  if (!existsSync("/proc/self/stat")) return true;
  return readdirSync("/proc")
    .filter((nome) => /^\d+$/.test(nome))
    .some((pid) => {
      const processo = estadoEGrupoDoProcesso(pid);
      return processo?.grupo === pgid && processo.estado !== "Z";
    });
}
