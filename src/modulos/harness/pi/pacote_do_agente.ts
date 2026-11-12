// O CLI do agente (pacote-pi/bin/fabriquinha) empacotado a partir de src/server/cli-agente. O arquivo não vai ao git;
// a versão dele é o hash do código-fonte, gravada ao lado, para o serviço regerar só quando o código muda.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PACOTE } from "./pi.ts";

const DESTINO_DO_CLI_DO_AGENTE = join(PACOTE, "bin", "fabriquinha");
const ENTRADA_DO_CLI_DO_AGENTE = fileURLToPath(new URL("../../../server/cli-agente/principal.ts", import.meta.url));

function hashDoCodigoFonte(arquivosDeEntrada: string[]): string {
  const hash = createHash("sha256");
  for (const arquivo of arquivosDeEntrada
    .map((a) => resolve(a))
    .filter((a) => !a.includes("/node_modules/"))
    .sort((a, b) => a.localeCompare(b))) {
    hash.update(arquivo).update(readFileSync(arquivo));
  }
  return hash.digest("hex");
}

/** @testes o script empacotar-cli-agente a chama por node -e; o serviço passa a chamá-la no ticket seguinte. Gera o pacote se ele não existe ou se o hash gravado diverge do código atual; devolve se gerou. Lança o erro do esbuild. */
export async function garantirPacoteDoAgente(
  destino: string = DESTINO_DO_CLI_DO_AGENTE,
  entrada: string = ENTRADA_DO_CLI_DO_AGENTE,
): Promise<boolean> {
  const resultado = await build({
    entryPoints: [entrada],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "silent",
    metafile: true,
    write: false,
  });
  const hash = hashDoCodigoFonte(Object.keys(resultado.metafile.inputs));
  const arquivoDaVersao = `${destino}.versao`;
  if (existsSync(destino) && existsSync(arquivoDaVersao) && readFileSync(arquivoDaVersao, "utf8") === hash)
    return false;
  mkdirSync(dirname(destino), { recursive: true });
  for (const { contents } of resultado.outputFiles) writeFileSync(destino, contents); // um só entryPoint, um só arquivo
  chmodSync(destino, 0o755);
  writeFileSync(arquivoDaVersao, hash);
  return true;
}
