// Fumaça com o pi real (P1 §6): o pi sobe em modo RPC com a linha de comando e o ambiente do F4 e uma extensão de
// teste que, no início da sessão, grava o prompt de sistema e encerra o pi, sem modelo nem chamada de LLM. Fora da
// suíte padrão, porque depende do pi instalado e da configuração do Auditor: `npm run integracao`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { PACOTE, ambientePi, argumentosPi, binarioPi, skillsDaEtapa } from "../src/execucao/pi.ts";

const dir = mkdtempSync(join(tmpdir(), "fabriquinha-fumaca-pi-"));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SONDA = `import { writeFileSync } from "node:fs";
export default (pi) =>
  pi.on("session_start", (_evento, ctx) => {
    writeFileSync(process.env.FABRIQUINHA_SONDA, ctx.getSystemPrompt());
    ctx.shutdown();
  });
`;

const sonda = join(dir, "sonda.js");
writeFileSync(sonda, SONDA);

// Uma sessão por etapa que tem skills de artefato (o desenvolvimento não tem).
for (const etapa of ["registro", "desenho", "revisao", "encerramento"] as const) {
  test(`o pi das execuções de ${etapa} carrega a guarda e as skills da etapa com a configuração do Auditor`, (t) => {
    const prompt = join(dir, `prompt-${etapa}.md`);
    const args = argumentosPi({
      raiz: dir,
      sessaoPi: `fumaca-${etapa}`,
      etapa,
      modelo: undefined,
      confianca: undefined,
      modo: "autonomo",
    });
    // A API de extensões não lista as extensões carregadas; com `PI_TIMING=1`, o pi imprime no stderr cada uma que
    // importou e inicializou (`<caminho> factory`), na ordem de carga.
    const pi = spawnSync(binarioPi(), [...args, "-e", sonda], {
      cwd: dir,
      env: { ...ambientePi(dir, 1, dir), PI_TIMING: "1", FABRIQUINHA_SONDA: prompt },
      input: "",
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(pi.status, 0, pi.stderr);
    const fabrica = / factory: \d+ms$/;
    const extensoes = pi.stderr
      .split("\n")
      .filter((linha) => fabrica.test(linha))
      .map((linha) => linha.replace(fabrica, "").trim());
    // A lista alimenta a revisão periódica do pi do Auditor (P1 §2.4).
    for (const extensao of extensoes) t.diagnostic(`extensão carregada: ${extensao}`);
    assert.ok(extensoes.includes(join(PACOTE, "extensions", "guarda.ts")), pi.stderr);
    // O prompt de sistema desta sessão, que a sonda gravou no início dela. O pi ignora em silêncio um `--skill` que não
    // existe; a skill só conta se o nome e o caminho entraram no prompt.
    const sistema = readFileSync(prompt, "utf8");
    assert.ok(sistema.includes(`Current working directory: ${dir}`));
    for (const skill of skillsDaEtapa(etapa)) {
      assert.ok(sistema.includes(`<name>${skill}</name>`), skill);
      assert.ok(sistema.includes(`<location>${join(PACOTE, "skills", skill, "SKILL.md")}</location>`), skill);
    }
  });
}
