// O Markdown dos PRs: o texto do agente e do Auditor neutralizado, as listas e o formato dos números.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dolares, inteiro, lista, neutro } from "./pr.ts";

test("o texto do PR #1 da demo: título vira subtítulo e o `<` do código inline sai cru, sem virar &lt;", () => {
  assert.equal(
    neutro(
      "## Necessidade\n\nUma calculadora.\n\n## Uso\n\n```\nnode calculadora.js <a> <op> <b>\n```\n\n" +
        "- `<op>` é uma de `+`, `-`, `*`, `/`.\n- Entrada inválida (`<a>` ou `<b>` que não é número): o uso.",
    ),
    "#### Necessidade\n\nUma calculadora.\n\n#### Uso\n\n```\nnode calculadora.js <a> <op> <b>\n```\n\n" +
      "- `<op>` é uma de `+`, `-`, `*`, `/`.\n- Entrada inválida (`<a>` ou `<b>` que não é número): o uso.",
  );
  assert.equal(
    neutro("`node calculadora.js <a> <op> <b>` imprime o resultado; a<b fora de código vira entidade."),
    "`node calculadora.js <a> <op> <b>` imprime o resultado; a&lt;b fora de código vira entidade.",
  );
});

test("código inline que só o parágrafo inteiro desfaz: o `<` volta a virar &lt;", () => {
  // Linha a linha, `<details>` estaria em código; no parágrafo, a crase de cima fecha na primeira e ele fica fora.
  assert.equal(neutro("Veja ` aqui\n`<details>` e `"), "Veja ` aqui\n`&lt;details>` e `");
});

test("texto do agente não esconde nem imita seção, e o código dele sai como ele escreveu", () => {
  // HTML aberto e títulos falsos, fora de código.
  assert.equal(
    neutro("Mudou.\n<!-- esconde o resto\n<details>\n<pre>\n## Evidências\n   ### falso\nEvidências\n---\nTítulo\n==="),
    "Mudou.\n&lt;!-- esconde o resto\n&lt;details>\n&lt;pre>\n#### Evidências\n   ##### falso\nEvidências\n" +
      "\\---\nTítulo\n\\===",
  );
  // O texto típico: blocos sh e yaml com #, --- e <!--, e código inline com <!--, tudo como foi escrito; e o código
  // inline que o CommonMark não reconhece: crases de tamanhos diferentes e crase escapada.
  assert.equal(
    lista(
      [
        "Instale assim:\n```sh\n# instala\nnpm i\n<!-- nada\n```\nE use `<!--` no HTML, ``a`<b``, ou a<b.",
        "Veja `<details>`` aqui.",
        "Veja \\`<details>` aqui.",
        "Configure:\n~~~yaml\n---\nchave: 1\n~~~",
      ],
      "Nenhuma.",
    ),
    "- Instale assim:\n  ```sh\n  # instala\n  npm i\n  <!-- nada\n  ```\n" +
      "  E use `<!--` no HTML, ``a`<b``, ou a&lt;b.\n" +
      "- Veja `&lt;details>`` aqui.\n" +
      "- Veja \\`&lt;details>` aqui.\n" +
      "- Configure:\n  ~~~yaml\n  ---\n  chave: 1\n  ~~~",
  );
  // ```a`b não abre bloco (info string com crase); cerca de crases não fecha com tis nem com menos crases; a cerca
  // esquecida aberta é fechada no fim.
  assert.equal(
    lista(["```a`b\n## Evidências", "````\na\n~~~\n```\n# dentro\n`````\n# fora", "Rode:\n~~~~\n# sem fim"], "-"),
    "- ```a`b\n  #### Evidências\n- ````\n  a\n  ~~~\n  ```\n  # dentro\n  `````\n  ### fora\n" +
      "- Rode:\n  ~~~~\n  # sem fim\n  ~~~~",
  );
  assert.equal(lista(["Recuado:\n\n    # comentário de shell"], "-"), "- Recuado:\n  \n      # comentário de shell");
  assert.equal(lista([], "Nenhuma."), "Nenhuma.");
});

test("números no formato pt-BR", () => {
  assert.equal(inteiro(1234567), "1.234.567");
  assert.equal(dolares(1.5), "US$ 1,5000");
});
