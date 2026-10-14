import assert from "node:assert/strict";
import { test } from "node:test";
import { Projeto } from "./projeto.ts";

const valido = {
  nome: "fabriquinha",
  repo: "/home/auditor/fabriquinha",
  branchBase: "main",
  hospedagem: "github",
  testes: ["npm test"],
  sonar: { projectKey: "Fabriquinha" },
  fitness: [{ nome: "dominio-sem-io", comando: "npm run fitness", descricao: "o domínio não faz I/O" }],
};
const erros = (entrada: unknown) =>
  Projeto.safeParse(entrada).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

test("Projeto mínimo válido ganha preparação e modelos vazios", () => {
  assert.deepEqual(Projeto.parse(valido), { ...valido, preparacao: [], modelos: {} });
});

test("Projeto aceita preparação e modelo por etapa", () => {
  const completo = {
    ...valido,
    hospedagem: "azure-devops",
    preparacao: ["npm ci"],
    modelos: { desenho: { provedor: "openai", modelo: "gpt-5" }, revisao: { provedor: "llamacpp", modelo: "qwen" } },
  };
  assert.deepEqual(Projeto.parse(completo), completo);
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
    [{ testes: [] }, "testes"],
    [{ testes: [" "] }, "testes.0"],
    [{ sonar: { projectKey: "" } }, "sonar.projectKey"],
    [{ sonar: undefined }, "sonar"],
    [{ fitness: [] }, "fitness"],
    [{ fitness: [{ nome: "x", comando: "c", descricao: "d".repeat(301) }] }, "fitness.0.descricao"],
    [{ fitness: [{ nome: "x", comando: " ", descricao: "d" }] }, "fitness.0.comando"],
    [{ fitness: [{ nome: "X", comando: "c", descricao: "d" }] }, "fitness.0.nome"],
    [{ modelos: { implementacao: { provedor: "openai", modelo: "gpt" } } }, "modelos"],
    [{ modelos: { desenho: { provedor: "OpenAI", modelo: "gpt" } } }, "modelos.desenho.provedor"],
  ];
  for (const [troca, esperado] of casos) {
    const achados = erros({ ...valido, ...troca });
    assert.ok(
      achados.some((e) => e.startsWith(esperado)),
      `${JSON.stringify(troca)} deveria dar ${esperado}, deu ${JSON.stringify(achados)}`,
    );
  }
});

test("Projeto recusa fitness function com nome repetido", () => {
  const f = { nome: "a", comando: "c", descricao: "d" };
  assert.deepEqual(erros({ ...valido, fitness: [f, { ...f, comando: "outro" }] }), [
    "fitness: nome de fitness function repetido",
  ]);
});
