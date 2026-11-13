// Auditor automático: o prompt da triagem, a leitura da decisão e a chamada ao pi, com o `executar` do harness trocado.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { migrar } from "../../../compartilhado/armazenamento/banco.ts";
import { MIGRACOES } from "../../../compartilhado/armazenamento/migracoes/migracoes.ts";
import { carregarTrabalhosDoTicket, comTrabalhosDoTicket } from "../../armazenamento/trabalho_agentico.ts";
import type { executar } from "../../../compartilhado/infra/processo.ts";
import { HarnessPi } from "../../../sessoes/publico.ts";
import { lerDecisao, promptDaTriagem, RESPOSTA_FORA_DA_REVISAO, triarPergunta } from "./auditor_automatico.ts";
import { condutor } from "./condutor.ts";

/** A triagem com o pi da consulta trocado por `rodar`, no harness do condutor do serviço. */
const triarCom = (rodar: typeof executar, ...argumentos: Parameters<typeof triarPergunta>) => {
  condutor.montarHarness(new HarnessPi(rodar));
  return triarPergunta(...argumentos);
};

const contexto = { ticket: "I-7.T3", etapa: "implementar" as const, demanda: "Cadastro" };
const comOpcoes = { pergunta: "Corrijo a issue S6328?", detalhes: "no a.ts:7", opcoes: ["Sim", "Não"] };
const livre = { pergunta: "Qual handle uso?", opcoes: [] };

test("o prompt traz as regras, o ticket, a pergunta, os detalhes e as opções", () => {
  const prompt = promptDaTriagem(contexto, comOpcoes);
  assert.match(prompt, /Banal \(responda\):[\s\S]*SonarQube[\s\S]*Estratégico \(escale\):[\s\S]*critério de aceite/);
  assert.match(prompt, /Ticket I-7\.T3, etapa implementar, da demanda "Cadastro"\./);
  assert.match(prompt, /Pergunta: Corrijo a issue S6328\?\n\nDetalhes: no a\.ts:7\n\nOpções:\n- Sim\n- Não$/);
  const comDescricao = { ...comOpcoes, descricoes: ["corrige agora", ""] };
  assert.match(promptDaTriagem(contexto, comDescricao), /Opções:\n- Sim: corrige agora\n- Não$/);
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
  // "Sim" e a instrução de chave só escalam pelo contexto: pergunta, detalhes ou descrição da opção que ofereçam acesso.
  const sim = (extra: object, resposta = "Sim") =>
    lerDecisao(responder(resposta), { pergunta: "Posso seguir?", opcoes: ["Sim", "Não"], ...extra }, "implementar");
  assert.equal(sim({ pergunta: "Posso usar o acesso ao Sonar?" }), undefined);
  assert.equal(sim({ detalhes: "com a credencial do bot" }), undefined);
  assert.equal(sim({ descricoes: ["Usar a chave fornecida", ""] }), undefined);
  assert.equal(sim({ descricoes: ["", "Executar deploy de teste"] }), undefined);
  assert.equal(sim({ pergunta: "Posso usar o acesso ao Sonar?", opcoes: [] }, "Pode, sim"), undefined);
  assert.equal(lerDecisao(responder("Utilize a chave privada fornecida"), livre, "implementar"), undefined);
  assert.equal(sim({ descricoes: ["Usar o token", ""] }, "Não")?.resposta, "Não");
  assert.deepEqual(sim({ descricoes: ["corrige agora", ""] }), { resposta: "Sim", justificativa: "regra" });
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
  assert.deepEqual(await triarCom(pi(decisao), modelo, contexto, comOpcoes), {
    resposta: "Sim",
    justificativa: "Sonar se corrige",
  });
  // O 3º argumento é o diretório temporário da sessão, que muda a cada chamada.
  assert.deepEqual(chamadas[0]?.toSpliced(2, 1).slice(0, 9), [
    "-p",
    "--session-dir",
    "--no-tools",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-mcp",
    "--model",
    "claude-bridge/claude-sonnet-5-5",
  ]);
  assert.equal(await triarCom(pi(decisao, 1), undefined, contexto, comOpcoes), undefined);
  assert.ok(!chamadas[1]?.includes("--model"));
  const quebra = (() => Promise.reject(new Error("spawn pi ENOENT"))) as unknown as typeof executar;
  assert.equal(await triarCom(quebra, modelo, contexto, comOpcoes), undefined);
});

test("o Uso da consulta é somado à execução do ticket que perguntou, e a consulta sem resposta não grava nada", async () => {
  const T = "'2026-01-01T00:00:00.000Z'";
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrar(banco, MIGRACOES);
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda VALUES ('I-7', 'p', 't', 'funcionalidade', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-7');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-7', 3, 'implementar', 'em_execucao', ${T});`);
  const ticket = { demanda_id: "I-7", ticket_id: 3 };
  comTrabalhosDoTicket(banco, ticket, (estado) => ({
    ...estado,
    sessoes: [{ ...ticket, id: "s1", modo: "autonomo", conversa_referencia: "s1" }],
    execucoes: [{ id: "e1", trabalho_id: "s1", inicio: "2026-01-01T00:00:00.000Z", falha: false }],
  }));
  const decisao = '{"decisao":"responder","resposta":"Sim","justificativa":"Sonar se corrige"}';
  // Como o pi real, grava a sessão no `--session-dir` com o `usage` da resposta.
  const pi =
    (codigo: number): typeof executar =>
    (_comando, args) => {
      const sessao = {
        role: "assistant",
        provider: "p",
        model: "m",
        usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
      };
      const entrada = { type: "message", timestamp: "2026-01-01T00:00:00.000Z", message: sessao };
      writeFileSync(join(String(args[args.indexOf("--session-dir") + 1]), "s.jsonl"), `${JSON.stringify(entrada)}\n`);
      return Promise.resolve({ codigo, saida: decisao, erro: "", limiteEstourado: false });
    };
  const execucaoQuePerguntou = { banco, ticket, execucao: "e1" };

  assert.equal(await triarCom(pi(1), undefined, contexto, comOpcoes, execucaoQuePerguntou), undefined);
  assert.deepEqual(carregarTrabalhosDoTicket(banco, ticket).usos, []);

  await triarCom(pi(0), undefined, contexto, comOpcoes, execucaoQuePerguntou);
  await triarCom(pi(0), undefined, contexto, comOpcoes, execucaoQuePerguntou);
  assert.deepEqual(carregarTrabalhosDoTicket(banco, ticket).usos, [
    {
      execucao_id: "e1",
      modelo_provedor: "p",
      modelo_nome: "m",
      tokens_entrada: 200,
      tokens_saida: 20,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
    },
  ]);
});
