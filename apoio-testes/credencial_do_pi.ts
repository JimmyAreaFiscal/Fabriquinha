import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Grava o `auth.json` do pi como o operador o prepara: o arquivo mora numa pasta só da credencial (`credencial-do-pi`, ao
 * lado da pasta do agente) e o `<dirDoPi>/auth.json` é um symlink para ele. Devolve a pasta só da credencial.
 */
export function gravarCredencialDoPi(dirDoPi: string, conteudo = "{}"): string {
  const pastaDaCredencial = join(dirname(dirDoPi), "credencial-do-pi");
  mkdirSync(pastaDaCredencial, { recursive: true });
  mkdirSync(dirDoPi, { recursive: true });
  writeFileSync(join(pastaDaCredencial, "auth.json"), conteudo);
  if (!lstatSync(join(dirDoPi, "auth.json"), { throwIfNoEntry: false }))
    symlinkSync(join(pastaDaCredencial, "auth.json"), join(dirDoPi, "auth.json"));
  return pastaDaCredencial;
}
