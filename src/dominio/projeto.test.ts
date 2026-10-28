import assert from "node:assert/strict";
import { test } from "node:test";
import { Projeto } from "./projeto.ts";

const valido = {
  nome: "fabriquinha",
  repo: "/home/auditor/fabriquinha",
  branchBase: "main",
  hospedagem: "github",
  sonar: { projectKey: "Fabriquinha" },
};
const erros = (entrada: unknown) =>
  Projeto.safeParse(entrada).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

test("Projeto mínimo válido ganha preparação vazia", () => {
  assert.deepEqual(Projeto.parse(valido), { ...valido, preparacao: [] });
});

test("Projeto aceita preparação; os campos do fluxo legado são recusados", () => {
  const completo = { ...valido, hospedagem: "azure-devops", preparacao: ["npm ci"] };
  assert.deepEqual(Projeto.parse(completo), completo);
  for (const legado of ["testes", "fitness", "modelos", "efforts"]) {
    assert.equal(Projeto.safeParse({ ...valido, [legado]: [] }).success, false, legado);
  }
});

test("linkProduto: http(s) válido passa, vazio vira ausente, o resto dá a mensagem do campo", () => {
  assert.equal(
    Projeto.parse({ ...valido, linkProduto: "https://demo.exemplo.com" }).linkProduto,
    "https://demo.exemplo.com",
  );
  assert.equal(
    Projeto.parse({ ...valido, linkProduto: "http://localhost:3000/app" }).linkProduto,
    "http://localhost:3000/app",
  );
  assert.equal(Projeto.parse({ ...valido, linkProduto: "" }).linkProduto, undefined);
  for (const ruim of ["isso nao e um link", "ftp://produto.exemplo.com", "javascript:alert(1)"]) {
    assert.deepEqual(erros({ ...valido, linkProduto: ruim }), [
      "linkProduto: Informe um link http(s) válido, como https://produto.exemplo.com",
    ]);
  }
});

test("Projeto recusa cada campo fora da regra, com o caminho do campo", () => {
  const casos: [Record<string, unknown>, string][] = [
    [{ nome: "Com Espaco" }, "nome"],
    [{ repo: "relativo/repo" }, "repo: caminho absoluto"],
    [{ branchBase: "" }, "branchBase"],
    [{ hospedagem: "gitlab" }, "hospedagem"],
    [{ preparacao: ["  "] }, "preparacao.0"],
    [{ sonar: { projectKey: "" } }, "sonar.projectKey"],
    [{ sonar: undefined }, "sonar"],
  ];
  for (const [troca, esperado] of casos) {
    const achados = erros({ ...valido, ...troca });
    assert.ok(
      achados.some((e) => e.startsWith(esperado)),
      `${JSON.stringify(troca)} deveria dar ${esperado}, deu ${JSON.stringify(achados)}`,
    );
  }
});
