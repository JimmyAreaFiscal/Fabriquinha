// Fitness function: a forma de toda skill de artefato do pacote P1 (§5.2, §6). O pi carrega uma skill com frontmatter
// inválido só com aviso, e o F4 a acha pelo nome do diretório; uma skill fora de forma passaria despercebida.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Etapa } from "../src/dominio/primitivos.ts";
import { PACOTE, skillsDaEtapa } from "../src/execucao/pi.ts";

const MAX_LINHAS = 100;
/** As regras de nome e descrição do pi (`core/skills.js`), que só avisa e carrega assim mesmo. */
const NOME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NOME = 64;
const MAX_DESCRICAO = 1024;
const SECOES = ["Para que serve", "Como produzir", "Estrutura", "Antes de submeter"];
const DE_ARTEFATO = new Set(Etapa.options.flatMap(skillsDaEtapa));

/** O valor de `chave` no frontmatter, numa linha só, como as skills do pacote o escrevem. */
const campo = (frontmatter: string, chave: string): string | undefined =>
  new RegExp(`^${chave}:[ \\t]*(\\S.*)$`, "m").exec(frontmatter)?.[1]?.trim();

function problemas(skills: string): string[] {
  const achados: string[] = [];
  for (const dir of readdirSync(skills)) {
    const texto = readFileSync(join(skills, dir, "SKILL.md"), "utf8");
    const linhas = texto.trimEnd().split("\n");
    if (linhas.length > MAX_LINHAS) achados.push(`${dir}: ${String(linhas.length)} linhas`);
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(texto)?.[1] ?? "";
    const nome = campo(frontmatter, "name");
    if (nome !== dir) achados.push(`${dir}: name ${String(nome)} difere do diretório`);
    if (!NOME.test(dir) || dir.length > MAX_NOME) achados.push(`${dir}: nome inválido para o pi`);
    if (!DE_ARTEFATO.has(dir)) achados.push(`${dir}: não é de evidência de produtor agente`);
    const descricao = campo(frontmatter, "description") ?? "";
    if (!descricao || descricao.length > MAX_DESCRICAO) achados.push(`${dir}: description vazia ou longa`);
    const titulos = linhas.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
    if (titulos.join("|") !== SECOES.join("|")) achados.push(`${dir}: seções ${titulos.join(", ")}`);
  }
  return achados;
}

test("toda skill de artefato do pacote tem a forma do P1 §5.2", () => {
  assert.deepEqual(problemas(join(PACOTE, "skills")), []);
});

test("a fitness acusa cada desvio de forma", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-skills-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const skill = (dir: string, texto: string) => {
    mkdirSync(join(raiz, dir));
    writeFileSync(join(raiz, dir, "SKILL.md"), texto);
  };
  const corpo = SECOES.map((s) => `## ${s}\n\ntexto\n`).join("\n");
  skill("artefato-comportamento", `---\nname: artefato-comportamento\ndescription: Use ao produzir.\n---\n\n${corpo}`);
  skill(
    "artefato-criterios-aceite",
    `---\nname: outro\ndescription: ${"x".repeat(1025)}\n---\n\n## Como produzir\n${"passo\n".repeat(100)}`,
  );
  skill("Artefato_X", `---\nname: Artefato_X\n---\n\n${corpo}`);

  assert.deepEqual(problemas(raiz).sort(), [
    "Artefato_X: description vazia ou longa",
    "Artefato_X: nome inválido para o pi",
    "Artefato_X: não é de evidência de produtor agente",
    "artefato-criterios-aceite: 106 linhas",
    "artefato-criterios-aceite: description vazia ou longa",
    "artefato-criterios-aceite: name outro difere do diretório",
    "artefato-criterios-aceite: seções Como produzir",
  ]);
});
