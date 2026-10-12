#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// Ponto de entrada do `fabriquinha` (F7 §3): o Node roda o TypeScript direto, com type stripping; o aviso do SQLite
// experimental sairia no stderr e quebraria o erro em uma linha.
import { principal } from "./cli.ts";

process.exitCode = await principal(process.argv.slice(2), {
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  parada: () =>
    new Promise((parou) => {
      process.once("SIGINT", parou);
      process.once("SIGTERM", parou);
    }),
});
