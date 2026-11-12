import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { confianca } from "./pi.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-pi-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("confiança herdada: a decisão mais próxima do repositório (ou de um pai) em trust.json, pelo caminho real", () => {
  const agente = join(base, "agente");
  const repos = join(base, "repos");
  for (const nome of ["confiado", "rejeitado", "nulo", "solto"]) mkdirSync(join(repos, nome), { recursive: true });
  const link = join(base, "link-confiado");
  symlinkSync(join(repos, "confiado"), link);
  process.env.PI_CODING_AGENT_DIR = agente;
  try {
    assert.equal(confianca(join(repos, "confiado")), undefined, "sem trust.json, vale o padrão do Auditor");
    mkdirSync(agente);
    writeFileSync(
      join(agente, "trust.json"),
      JSON.stringify({ [repos]: false, [join(repos, "confiado")]: true, [join(repos, "nulo")]: null }),
    );
    assert.equal(confianca(link), true);
    assert.equal(confianca(join(repos, "rejeitado")), false, "herdada do pai");
    assert.equal(confianca(join(repos, "nulo")), false, "null não decide: sobe para o pai");
    assert.equal(confianca(base), undefined, "nenhuma decisão até a raiz");
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
  }
});

test("padrão do Auditor: o trust.json em ~/.pi/agent", () => {
  const home = join(base, "home");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "trust.json"), JSON.stringify({ [home]: true }));
  const { HOME } = process.env;
  process.env.HOME = home;
  try {
    assert.equal(confianca(home), true);
  } finally {
    process.env.HOME = HOME;
  }
});
