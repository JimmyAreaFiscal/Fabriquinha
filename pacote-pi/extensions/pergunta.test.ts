import assert from "node:assert/strict";
import { test } from "node:test";
import pergunta from "./pergunta.ts";

type Execute = Parameters<Parameters<typeof pergunta>[0]["registerTool"]>[0]["execute"];
type Contexto = Parameters<Execute>[4];

const ferramentas: Parameters<Parameters<typeof pergunta>[0]["registerTool"]>[0][] = [];
pergunta({ registerTool: (f) => ferramentas.push(f) });
const ferramenta = ferramentas[0] ?? assert.fail("sem ferramenta");

/** Chama a ferramenta com um `ctx` falso e devolve o texto e os diálogos que ela abriu. */
async function perguntar(
  entrada: Parameters<Execute>[1],
  { select, editor, hasUI = true }: { select?: string; editor?: string; hasUI?: boolean } = {},
) {
  const dialogos: unknown[][] = [];
  const ctx: Contexto = {
    hasUI,
    ui: {
      select: (...args) => {
        dialogos.push(["select", ...args]);
        return Promise.resolve(select);
      },
      editor: (...args) => {
        dialogos.push(["editor", ...args]);
        return Promise.resolve(editor);
      },
    },
  };
  const { content } = await ferramenta.execute("1", entrada, undefined, undefined, ctx);
  return { texto: content.map((c) => c.text).join(""), dialogos };
}

const ordem = {
  question: "Qual ordem os cupons devem ter?",
  options: [
    { label: "Maior desconto primeiro" },
    { label: " Validade mais próxima ", description: "d" },
    { label: " " },
  ],
};

test("registra a ferramenta perguntar com os parâmetros da ask_user_question, em JSON Schema puro", () => {
  assert.equal(ferramenta.name, "perguntar");
  const parametros = ferramenta.parameters as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(Object.keys(parametros.properties), ["question", "details", "options", "multiSelect"]);
  assert.deepEqual(parametros.required, ["question"]);
  assert.equal(ferramenta.promptGuidelines.length, 7);
});

test("escolha única: o rótulo vira `n. rótulo` e o texto livre vira Other (CA-2, CA-3)", async () => {
  const opcao = await perguntar(ordem, { select: "Validade mais próxima" });
  assert.equal(opcao.texto, "User selected: 2. Validade mais próxima");
  assert.deepEqual(opcao.dialogos, [["select", ordem.question, ["Maior desconto primeiro", "Validade mais próxima"]]]);
  const outro = await perguntar(ordem, { select: "Por data de criação, só dos cupons ativos" });
  assert.equal(outro.texto, "User selected: Other: Por data de criação, só dos cupons ativos");
});

test("múltipla escolha: lista em JSON, opções pelo índice e Other por último (CA-6)", async () => {
  const entrada = { ...ordem, multiSelect: true };
  const lista = JSON.stringify(["e desempate pelo código", "Validade mais próxima", "Maior desconto primeiro"]);
  assert.equal(
    (await perguntar(entrada, { select: lista })).texto,
    "User selected:\n- 1. Maior desconto primeiro\n- 2. Validade mais próxima\n- Other: e desempate pelo código",
  );
  assert.equal(
    (await perguntar(entrada, { select: '["Maior desconto primeiro"]' })).texto,
    "User selected: 1. Maior desconto primeiro",
  );
  assert.equal((await perguntar(entrada, { select: "texto solto" })).texto, "User selected: Other: texto solto");
  assert.equal((await perguntar(entrada, { select: '{"a":1}' })).texto, 'User selected: Other: {"a":1}');
});

test("cancelar: select, lista vazia e editor sem resposta (CA-5)", async () => {
  const cancelada = "User cancelled the question";
  assert.equal((await perguntar(ordem)).texto, cancelada);
  assert.equal((await perguntar({ ...ordem, multiSelect: true }, { select: "[]" })).texto, cancelada);
  assert.equal((await perguntar({ question: "Qual?" })).texto, cancelada);
});

test("sem opções: o editor recebe a pergunta e os detalhes, e o texto é aparado", async () => {
  const livre = await perguntar({ question: "Qual?", details: " contexto ", options: [] }, { editor: " Sim \n" });
  assert.equal(livre.texto, "User answered: Sim");
  assert.deepEqual(livre.dialogos, [["editor", "Qual?\n\ncontexto"]]);
  assert.deepEqual((await perguntar({ question: "Qual?" }, { editor: "x" })).dialogos, [["editor", "Qual?"]]);
  assert.equal((await perguntar({ question: "Qual?" }, { editor: "  " })).texto, "User submitted an empty response");
});

test("sem UI, avisa que precisa do modo interativo", async () => {
  const { texto, dialogos } = await perguntar(ordem, { hasUI: false });
  assert.equal(texto, "ask_user_question requires interactive mode UI");
  assert.deepEqual(dialogos, []);
});
