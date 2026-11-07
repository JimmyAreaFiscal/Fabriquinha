// Auditor automático: o prompt da triagem, a leitura da decisão e a chamada ao pi, com o `executar` trocado.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { executar } from "../processo.ts";
import { lerDecisao, promptDaTriagem, RESPOSTA_FORA_DA_REVISAO, triarPergunta } from "./auditor_automatico.ts";

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

test("o prompt da etapa de revisão lista o que fica fora da revisão; deploy de teste não é banal e oferta de acesso escala", () => {
  const prompt = promptDaTriagem({ ...contexto, etapa: "revisar_rodada" }, comOpcoes);
  assert.match(
    prompt,
    /Fora da revisão \(só em revisar_rodada e revisar_demanda\):\n- pergunta sobre Sonar, PR, deploy, cópia do banco, credencial ou ambiente de teste: .*\n\{"decisao":"fora_da_revisao",/,
  );
  const banal = prompt.slice(prompt.indexOf("Banal"), prompt.indexOf("Fora da revisão"));
  assert.doesNotMatch(banal, /deploy de teste/);
  assert.match(banal, /docker ou containers: permitido/);
  assert.match(
    prompt,
    /Estratégico \(escale\):\n- toda opção ou resposta que ofereça credencial, acesso ou deploy de teste ao agente;/,
  );
});

test("fora da revisão responde o texto fixo nas etapas de revisão, mesmo fora das opções, e escala nas outras", () => {
  const foraDaRevisao = '{"decisao":"fora_da_revisao","justificativa":"pede Sonar"}';
  const esperada = { resposta: RESPOSTA_FORA_DA_REVISAO, justificativa: "pede Sonar" };
  assert.equal(
    RESPOSTA_FORA_DA_REVISAO,
    "Fica fora da revisão; registre como verificado fora da revisão e decida pelo resto.",
  );
  assert.deepEqual(lerDecisao(foraDaRevisao, comOpcoes, "revisar_rodada"), esperada);
  assert.deepEqual(lerDecisao(foraDaRevisao, livre, "revisar_demanda"), esperada);
  assert.equal(lerDecisao(foraDaRevisao, comOpcoes, "implementar"), undefined);
});

test("lê a última decisão válida da saída; escalar, rótulo fora das opções ou saída ilegível escalam", () => {
  const responder = (resposta: string) => JSON.stringify({ decisao: "responder", resposta, justificativa: "regra" });
  assert.deepEqual(
    lerDecisao(`ruído do provedor\n{"x":1}\n${responder("Sim")}\nmais ruído`, comOpcoes, "implementar"),
    {
      resposta: "Sim",
      justificativa: "regra",
    },
  );
  assert.deepEqual(lerDecisao(responder("use o handle fixo"), livre, "implementar"), {
    resposta: "use o handle fixo",
    justificativa: "regra",
  });
  assert.equal(lerDecisao(responder("Talvez"), comOpcoes, "implementar"), undefined);
  // Oferta de credencial, acesso ou deploy de teste escala, mesmo com a decisão "responder" e o rótulo válido.
  const ofertas = { pergunta: "Como confiro?", opcoes: ["Executar deploy de teste", "Usar a verificação anterior"] };
  assert.equal(lerDecisao(responder("Executar deploy de teste"), ofertas, "revisar_rodada"), undefined);
  assert.deepEqual(lerDecisao(responder("Usar a verificação anterior"), ofertas, "revisar_rodada"), {
    resposta: "Usar a verificação anterior",
    justificativa: "regra",
  });
  for (const oferta of [
    "Use a credencial do bot",
    "Peça acesso ao Sonar",
    "Faça o deploy",
    "Autentique o gh",
    "Faça login na conta do Sonar e confira o projeto",
    "Acesse o painel",
    "Use o token do bot",
    "Entre no painel do Sonar e confira o projeto",
    "Consulte o dashboard do Sonar",
    "Conecte no banco de homologação",
    "Confira o PR no GitHub",
    "Restaure a cópia do banco no ambiente de teste",
  ]) {
    assert.equal(lerDecisao(responder(oferta), livre, "implementar"), undefined, oferta);
  }
  assert.equal(
    lerDecisao('{"decisao":"escalar","justificativa":"muda o critério"}', comOpcoes, "implementar"),
    undefined,
  );
  assert.equal(lerDecisao("não sei", comOpcoes, "implementar"), undefined);
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
