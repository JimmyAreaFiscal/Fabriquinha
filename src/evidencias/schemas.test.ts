import assert from "node:assert/strict";
import { test } from "node:test";
import { z, ZodError } from "zod";
import { ErroDeRegra } from "../dominio/erros.ts";
import { jsonSchemaDe, schemaDe } from "./schemas.ts";

const caminhos = (erro: unknown) => (erro as ZodError).issues.map((i) => i.path.join("."));

/** Os caminhos dos campos recusados, ou `[]` se `dados` é válido para o tipo. */
const recusados = (tipo: "comportamento" | "criterios_aceite", dados: unknown): string[] => {
  const r = schemaDe(tipo).dados.safeParse(dados);
  return r.success ? [] : caminhos(r.error);
};

const CRITERIO = { id: "CA-1", dado: "um usuário", quando: "entra", entao: "vê o painel" };

test("comportamento: descrição e passos para reproduzir; um vídeo ou texto pelo menos", () => {
  assert.deepEqual(recusados("comportamento", { descricao: "lento", comoReproduzir: ["abrir"] }), []);
  assert.deepEqual(recusados("comportamento", { comoReproduzir: [] }), ["descricao", "comoReproduzir"]);
  assert.deepEqual(recusados("comportamento", { descricao: " ", comoReproduzir: [" "] }), [
    "descricao",
    "comoReproduzir.0",
  ]);
  assert.deepEqual(recusados("comportamento", { descricao: "a".repeat(2001), comoReproduzir: ["x"] }), ["descricao"]);
  assert.deepEqual(schemaDe("comportamento").arquivos, { classes: ["video", "texto"], min: 1 });
});

test("criterios_aceite: critérios CA-n com dado, quando e então, sem id repetido; nenhum arquivo", () => {
  assert.deepEqual(recusados("criterios_aceite", { criterios: [CRITERIO, { ...CRITERIO, id: "CA-2" }] }), []);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [] }), ["criterios"]);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [{ ...CRITERIO, id: "ca-1", entao: "" }] }), [
    "criterios.0.id",
    "criterios.0.entao",
  ]);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [{ ...CRITERIO, quando: undefined }] }), [
    "criterios.0.quando",
  ]);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [CRITERIO, CRITERIO] }), ["criterios"]);
  assert.deepEqual(schemaDe("criterios_aceite").arquivos, {
    classes: ["video", "imagem", "html", "texto"],
    min: 0,
    max: 0,
  });
});

test("jsonSchemaDe publica o JSON Schema de dados (z.toJSONSchema) e as regras de arquivo", () => {
  const { dados, arquivos } = jsonSchemaDe("criterios_aceite");
  assert.deepEqual(arquivos, schemaDe("criterios_aceite").arquivos);
  assert.deepEqual(dados, z.toJSONSchema(schemaDe("criterios_aceite").dados, { io: "input" }));
  assert.deepEqual(dados.required, ["criterios"]);
  assert.equal(JSON.stringify(dados).includes(String.raw`"pattern":"^CA-\\d+$"`), true);
  assert.deepEqual(jsonSchemaDe("comportamento").dados.required, ["descricao", "comoReproduzir"]);
});

test("tipo ainda sem schema é recusado com os tipos aceitos", () => {
  assert.throws(
    () => schemaDe("desenho_solucao"),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message ===
        "a Fabriquinha ainda não valida evidências do tipo desenho_solucao (os tipos aceitos hoje são comportamento, criterios_aceite)",
  );
});
