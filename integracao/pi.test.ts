// Fumaça com o pi real (P1 §6): o pi sobe em modo RPC com a linha de comando e o ambiente do F4 e uma extensão de
// teste que, no início da sessão, grava o prompt de sistema e encerra o pi, sem modelo nem chamada de LLM. Fora da
// suíte padrão, porque depende do pi instalado e da configuração do Auditor: `npm run integracao`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { HarnessPi } from "../src/modulos/harness/pi/harness_pi.ts";
import { PACOTE } from "../src/modulos/harness/pi/pi.ts";
import { skillsDaEtapaDemanda } from "../src/modulos/sdlc/aplicacao/execucao/lancamento_do_ticket.ts";
import { condutor } from "../src/modulos/trabalho_agentico/aplicacao/trabalho/condutor.ts";

const harness = new HarnessPi();
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

// Uma sessão por etapa que tem skills de artefato.
for (const etapa of ["planejar", "revisar_rodada", "encerrar_rodada", "revisar_demanda"] as const) {
  test(`o pi das execuções de ${etapa} carrega a guarda, a pergunta e as skills da etapa com a configuração do Auditor`, (t) => {
    const prompt = join(dir, `prompt-${etapa}.md`);
    const args = harness.argumentos({
      raiz: dir,
      sessao: `fumaca-${etapa}`,
      skills: skillsDaEtapaDemanda(etapa),
      modelo: undefined,
      confianca: undefined,
      modo: "autonomo",
    });
    // A API de extensões não lista as extensões carregadas; com `PI_TIMING=1`, o pi imprime no stderr cada uma que
    // importou e inicializou (`<caminho> factory`), na ordem de carga.
    const pi = spawnSync(harness.binarioPi(), [...args, "-e", sonda], {
      cwd: dir,
      env: { ...harness.variaveisDeAmbiente(dir, dir, "ticket"), PI_TIMING: "1", FABRIQUINHA_SONDA: prompt },
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
    // A `perguntar` convive com a `guarda` e com a `ask_user_question` do Auditor, que a exclusão tira.
    for (const extensao of ["guarda.ts", "pergunta.ts"])
      assert.ok(extensoes.includes(join(PACOTE, "extensions", extensao)), pi.stderr);
    // O prompt de sistema desta sessão, que a sonda gravou no início dela. O pi ignora em silêncio um `--skill` que não
    // existe; a skill só conta se o nome e o caminho entraram no prompt.
    const sistema = readFileSync(prompt, "utf8");
    // Desde o pi 1.1.0, o diretório de trabalho vem num bloco `<cwd>`.
    assert.ok(sistema.includes(`<cwd>\n${dir}\n</cwd>`), sistema);
    for (const skill of skillsDaEtapaDemanda(etapa)) {
      assert.ok(sistema.includes(`<name>${skill}</name>`), skill);
      assert.ok(sistema.includes(`<location>${join(PACOTE, "skills", skill, "SKILL.md")}</location>`), skill);
    }
  });
}

test("a consulta do condutor, sem ferramentas, roda sem as credenciais de hospedagem e do Sonar, e devolve o que o pi respondeu", async () => {
  const credenciais = ["GH_TOKEN", "GITHUB_TOKEN", "AZURE_DEVOPS_EXT_PAT", "SYSTEM_ACCESSTOKEN", "SONAR_TOKEN"];
  // Um pi falso que responde com os nomes das variáveis do próprio ambiente.
  const piQueImprimeOAmbiente = join(dir, "pi-ambiente");
  writeFileSync(
    piQueImprimeOAmbiente,
    '#!/usr/bin/env node\nprocess.stdout.write(Object.keys(process.env).join("\\n"));\n',
  );
  chmodSync(piQueImprimeOAmbiente, 0o755);
  const antes = { ...process.env };
  for (const nome of credenciais) process.env[nome] = "segredo";
  process.env.FABRIQUINHA_PI = piQueImprimeOAmbiente;
  try {
    const nomes = (await condutor.consultar("oi", undefined, 30_000))?.saida.split("\n") ?? [];
    assert.ok(nomes.includes("PATH"), "a consulta devolve o texto do pi");
    for (const nome of credenciais) assert.ok(!nomes.includes(nome), nome);
  } finally {
    for (const nome of credenciais) Reflect.deleteProperty(process.env, nome);
    if (antes.FABRIQUINHA_PI === undefined) delete process.env.FABRIQUINHA_PI;
    else process.env.FABRIQUINHA_PI = antes.FABRIQUINHA_PI;
  }
});
