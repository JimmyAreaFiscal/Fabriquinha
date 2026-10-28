// Fitness function: a forma de toda skill de artefato do pacote P1 (§5.2, §6) e o catálogo completo: exatamente uma
// skill por evidência de produtor agente das etapas e por evidência da demanda. O pi carrega uma skill com frontmatter inválido só com aviso e
// ignora em silêncio um `--skill` que não existe; uma skill fora de forma ou faltando passaria despercebida.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TipoEvidenciaDemanda } from "../src/dominio/evidencia_demanda.ts";
import { CATALOGO_ETAPAS } from "../src/dominio/evidencia_etapa.ts";
import { PACOTE, skillDoTipo } from "../src/execucao/pi.ts";

const MAX_LINHAS = 100;
/** As regras de nome e descrição do pi (`core/skills.js`), que só avisa e carrega assim mesmo. */
const NOME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NOME = 64;
const MAX_DESCRICAO = 1024;
const SECOES = ["Para que serve", "Como produzir", "Estrutura", "Antes de submeter"];
/** A evidência da demanda que a ferramenta de fora submete sem skill: os custos vêm da própria sessão dela. */
const SEM_SKILL: readonly string[] = ["custos_realizados"];
/** Skills do fluxo externo (CLI da ferramenta de fora): não são de evidência de agente e têm forma própria. */
const EXTERNAS = ["demanda-externa"];
/** As evidências de produtor agente das etapas e as da demanda, que a ferramenta de fora registra. */
const DE_ARTEFATO = new Set([
  ...CATALOGO_ETAPAS.filter((c) => c.produtor === "agente").map((c) => skillDoTipo(c.tipo)),
  ...TipoEvidenciaDemanda.options.filter((tipo) => !SEM_SKILL.includes(tipo)).map(skillDoTipo),
]);

/** O valor de `chave` no frontmatter, numa linha só, como as skills do pacote o escrevem. */
const campo = (frontmatter: string, chave: string): string | undefined =>
  new RegExp(`^${chave}:[ \\t]*(\\S.*)$`, "m").exec(frontmatter)?.[1]?.trim();

function problemas(skills: string): string[] {
  const dirs = readdirSync(skills);
  const achados = [...DE_ARTEFATO].filter((s) => !dirs.includes(s)).map((s) => `${s}: falta a skill`);
  for (const dir of dirs) {
    const texto = readFileSync(join(skills, dir, "SKILL.md"), "utf8");
    const linhas = texto.trimEnd().split("\n");
    if (linhas.length > MAX_LINHAS) achados.push(`${dir}: ${String(linhas.length)} linhas`);
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(texto)?.[1] ?? "";
    const nome = campo(frontmatter, "name");
    if (nome !== dir) achados.push(`${dir}: name ${String(nome)} difere do diretório`);
    if (!NOME.test(dir) || dir.length > MAX_NOME) achados.push(`${dir}: nome inválido para o pi`);
    const descricao = campo(frontmatter, "description") ?? "";
    if (!descricao || descricao.length > MAX_DESCRICAO) achados.push(`${dir}: description vazia ou longa`);
    if (EXTERNAS.includes(dir)) continue;
    if (!DE_ARTEFATO.has(dir)) achados.push(`${dir}: não é de evidência de produtor agente`);
    const titulos = linhas.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
    if (titulos.join("|") !== SECOES.join("|")) achados.push(`${dir}: seções ${titulos.join(", ")}`);
  }
  return achados;
}

test("o pacote tem exatamente uma skill para cada evidência de produtor agente, com a forma do P1 §5.2", () => {
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

  const faltando = [...DE_ARTEFATO]
    .filter((s) => s !== "artefato-comportamento" && s !== "artefato-criterios-aceite")
    .map((s) => `${s}: falta a skill`);
  assert.deepEqual(
    problemas(raiz).sort(),
    [
      ...faltando,
      "Artefato_X: description vazia ou longa",
      "Artefato_X: nome inválido para o pi",
      "Artefato_X: não é de evidência de produtor agente",
      "artefato-criterios-aceite: 106 linhas",
      "artefato-criterios-aceite: description vazia ou longa",
      "artefato-criterios-aceite: name outro difere do diretório",
      "artefato-criterios-aceite: seções Como produzir",
    ].sort(),
  );
});

test("CA-14: nenhuma skill do pacote cita comando removido; acima de 30 arquivos, demandas separadas com --dep", () => {
  const skills = join(PACOTE, "skills");
  const texto = (dir: string) => readFileSync(join(skills, dir, "SKILL.md"), "utf8");
  for (const dir of readdirSync(skills)) {
    assert.doesNotMatch(
      texto(dir),
      /fabriquinha (issue|necessidade|ticket (enviar|editar|remover)|evidencia ver)\b|`fabriquinha ticket criar`/,
      dir,
    );
  }
  for (const dir of ["artefato-criterios-aceite", "artefato-desenho-solucao"]) {
    assert.match(texto(dir), /Mais de 30|mais de 30/, dir);
    assert.match(texto(dir), /`fabriquinha demanda registrar \.\.\. --dep I-<n>`/, dir);
  }
});
