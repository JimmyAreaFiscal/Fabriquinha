// Auditor automático: o prompt da triagem, a leitura da decisão e a chamada ao pi, com o `executar` trocado.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { executar } from "../processo.ts";
import { lerDecisao, promptDaTriagem, triarPergunta } from "./auditor_automatico.ts";

const contexto = { ticket: "I-7.T3", etapa: "implementar", demanda: "Cadastro" };
const comOpcoes = { pergunta: "Corrijo a issue S6328?", detalhes: "no a.ts:7", opcoes: ["Sim", "Não"] };
const livre = { pergunta: "Qual handle uso?", opcoes: [] };

test("o prompt traz as regras, o ticket, a pergunta, os detalhes e as opções", () => {
  const prompt = promptDaTriagem(contexto, comOpcoes);
  assert.match(prompt, /Banal \(responda\):[\s\S]*SonarQube[\s\S]*Estratégico \(escale\):[\s\S]*critério de aceite/);
  assert.match(prompt, /Ticket I-7\.T3, etapa implementar, da demanda "Cadastro"\./);
  assert.match(prompt, /Pergunta: Corrijo a issue S6328\?\n\nDetalhes: no a\.ts:7\n\nOpções:\n- Sim\n- Não$/);
  assert.match(
    promptDaTriagem(contexto, livre),
    /Pergunta: Qual handle uso\?\n\nOpções:\n\(sem opções: resposta em texto livre\)$/,
  );
});

test("lê a última decisão válida da saída; escalar, rótulo fora das opções ou saída ilegível escalam", () => {
  const responder = (resposta: string) => JSON.stringify({ decisao: "responder", resposta, justificativa: "regra" });
  assert.deepEqual(lerDecisao(`ruído do provedor\n{"x":1}\n${responder("Sim")}\nmais ruído`, comOpcoes), {
    resposta: "Sim",
    justificativa: "regra",
  });
  assert.deepEqual(lerDecisao(responder("use o handle fixo"), livre), {
    resposta: "use o handle fixo",
    justificativa: "regra",
  });
  assert.equal(lerDecisao(responder("Talvez"), comOpcoes), undefined);
  assert.equal(lerDecisao('{"decisao":"escalar","justificativa":"muda o critério"}', comOpcoes), undefined);
  assert.equal(lerDecisao("não sei", comOpcoes), undefined);
});

test("chama o pi uma vez, sem ferramentas e com o modelo do ticket; código diferente de 0 ou erro escalam", async () => {
  const chamadas: (readonly string[])[] = [];
  const pi =
    (saida: string, codigo = 0): typeof executar =>
    (_comando, args) => {
      chamadas.push(args);
      return Promise.resolve({ codigo, saida, erro: "", limiteEstourado: false });
    };
  const decisao = '{"decisao":"responder","resposta":"Sim","justificativa":"Sonar se corrige"}';

  const modelo = { provedor: "claude-bridge", nome: "claude-sonnet-5-5" };
  assert.deepEqual(await triarPergunta(modelo, contexto, comOpcoes, pi(decisao)), {
    resposta: "Sim",
    justificativa: "Sonar se corrige",
  });
  assert.deepEqual(chamadas[0]?.slice(0, 9), [
    "-p",
    "--no-session",
    "--no-tools",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-mcp",
    "--model",
    "claude-bridge/claude-sonnet-5-5",
  ]);
  assert.equal(await triarPergunta(undefined, contexto, comOpcoes, pi(decisao, 1)), undefined);
  assert.ok(!chamadas[1]?.includes("--model"));
  const quebra = (() => Promise.reject(new Error("spawn pi ENOENT"))) as unknown as typeof executar;
  assert.equal(await triarPergunta(modelo, contexto, comOpcoes, quebra), undefined);
});
