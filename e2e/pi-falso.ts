#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// pi falso do e2e (F4 §12), via FABRIQUINHA_PI: responde `--version`, lista modelos em `--list-models` e, no modo
// RPC, fala o protocolo do pi: grava cada mensagem no JSONL da sessão e a emite. O que faz com o `prompt` depende do
// texto dele:
// - "[ao vivo]": raciocínio, uma ferramenta que falha e um texto chegando em fluxo, sem terminar, até um `steer`, que
//   o redireciona e abre um diálogo `select`;
// - "[longo]": uma resposta que passa da altura da janela e, depois, um texto em fluxo de vários segundos, sem
//   terminar, para a conversa rolar enquanto o agente escreve;
// - "eco: <texto>": responde exatamente <texto>;
// - "# Auditoria" (o prompt da auditoria do Histórico, F4): chama `subagent` com três tarefas `scout`, recebe o
//   resultado e responde com as quatro seções; uma pergunta depois cai na resposta padrão;
// - "# Avaliação" (a avaliação do SDLC, I-240): grava 3 achados em `achados.jsonl`, na pasta da avaliação (o cwd), ou 20
//   se o pedido diz "[20 achados]", e responde; uma pergunta depois cai na resposta padrão;
// - "pergunte <select|confirm|input|editor>": abre esse diálogo; "pergunte perguntar" e "pergunte multipla" abrem o
//   `select` dentro da ferramenta `perguntar` (única e de múltipla escolha), como o pi real;
// - qualquer outro: responde $FALSO_PI_RESPOSTA (padrão "pronto") e assenta.
// Em `--mode json` (a Simulação, I-10) não fala o protocolo: espera o EOF do stdin, como o pi real, grava o `relatorio.json` em
// $FABRIQUINHA_SAIDA, como a ferramenta `relatar` da extensão navegador, e sai.
// A resposta a um diálogo é ecoada numa mensagem e assenta; `abort` para a mensagem em fluxo como abortada.
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";

const argumentos = process.argv.slice(2);
const emitir = (evento: object) => process.stdout.write(`${JSON.stringify(evento)}\n`);
const arg = (nome: string) => argumentos[argumentos.indexOf(nome) + 1] ?? "";

if (argumentos.includes("--version")) {
  console.log("0.0.0-falso");
  process.exit(0);
}
if (argumentos.includes("--list-models")) {
  console.log("provider   model              context  max-out  thinking  images");
  console.log("anthropic  claude-opus-5-5    200K     64K      yes       yes");
  console.log("anthropic  claude-sonnet-5-5  200K     64K      yes       yes");
  process.exit(0);
}

if (arg("--mode") === "json") {
  await new Promise((pronto) => process.stdin.resume().on("end", pronto));
  await dormir(300);
  const relatorio = { usabilidade: ["O botão Enviar tem pouco contraste e fica no fim da página"], bugs: [] };
  writeFileSync(join(String(process.env.FABRIQUINHA_SAIDA), "relatorio.json"), JSON.stringify(relatorio));
  process.exit(0);
}

const sessao = join(arg("--session-dir"), `2026-10-12T00-00-00-000Z_${arg("--session-id")}.jsonl`);
// Como o pi, `--fork` começa a sessão nova com a conversa da sessão copiada (F4 §6.5).
if (argumentos.includes("--fork")) {
  mkdirSync(arg("--session-dir"), { recursive: true });
  copyFileSync(arg("--fork"), sessao);
}

/** Um instante por mensagem, sempre maior que o anterior: o chat distingue as mensagens pelo papel e pelo instante. */
let ultimo = 0;
const agora = () => (ultimo = Math.max(Date.now(), ultimo + 1));

/** Como o pi, grava a mensagem em `<session-dir>/<instante>_<session-id>.jsonl` e a emite. */
function mensagem(message: object): void {
  mkdirSync(arg("--session-dir"), { recursive: true });
  const completa = { ...message, timestamp: agora() };
  const entrada = { type: "message", timestamp: new Date().toISOString(), message: completa };
  appendFileSync(sessao, `${JSON.stringify(entrada)}\n`);
  emitir({ type: "message_end", message: completa });
}

const doAgente = (content: object[], stopReason = "stop") => ({
  role: "assistant",
  content,
  // A auditoria sobe com o modelo da Configuração (--provider/--model); sem ele, o padrão do pi.
  provider: argumentos.includes("--provider") ? arg("--provider") : "anthropic",
  model: argumentos.includes("--model") ? arg("--model") : "claude-opus-5-5",
  stopReason,
  usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 0.01 } },
});

const responder = (texto: string) => {
  mensagem(doAgente([{ type: "text", text: texto }]));
};

/** O texto que está chegando em fluxo, ainda sem `message_end`. */
let emFluxo: { texto: string } | undefined;

async function aoVivo(): Promise<void> {
  mensagem(
    doAgente(
      [
        { type: "thinking", thinking: "Vou rodar os testes antes de mexer no código." },
        { type: "toolCall", id: "t1", name: "bash", arguments: { command: "npm test" } },
      ],
      "toolUse",
    ),
  );
  emitir({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
  const saida = Array.from({ length: 40 }, (_, i) => `ok ${String(i + 1)} - caso ${String(i + 1)}`);
  mensagem({
    role: "toolResult",
    toolCallId: "t1",
    toolName: "bash",
    content: [{ type: "text", text: [...saida, "FAIL test/cupons.spec.ts", "3 failed"].join("\n") }],
    isError: true,
  });
  emitir({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: true });
  await transmitir([
    [50, "Os testes "],
    [50, "esperam a "],
    [1000, "**ordem antiga**"],
  ]);
}

/**
 * Abre uma mensagem do agente em fluxo e emite os pedaços, cada um depois da sua pausa. O último demora: quem abre o
 * chat depois do começo vê o parcial e o resto chegar.
 */
async function transmitir(pedacos: readonly (readonly [number, string])[]): Promise<void> {
  emitir({ type: "message_start", message: doAgente([]) });
  emitir({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  const fluxo = { texto: "" };
  emFluxo = fluxo;
  for (const [pausa, pedaco] of pedacos) {
    await dormir(pausa);
    // Um `steer` ou `abort` no meio já fechou a mensagem.
    if (emFluxo !== fluxo) return;
    fluxo.texto += pedaco;
    emitir({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: pedaco } });
  }
}

/** "[longo]": uma resposta de 40 parágrafos e, em seguida, 25 trechos em fluxo, um a cada 0,6 s. */
async function longo(): Promise<void> {
  responder(Array.from({ length: 40 }, (_, i) => `Parágrafo ${String(i + 1)} da análise do checkout.`).join("\n\n"));
  await transmitir([
    [100, "Começo do fluxo."],
    ...Array.from({ length: 25 }, (_, i) => [600, `\n\nTrecho ${String(i + 1)} do fluxo.`] as const),
  ]);
}

/** Termina a mensagem em fluxo, se há uma. */
function fecharFluxo(stopReason = "stop"): void {
  if (emFluxo === undefined) return;
  mensagem(doAgente([{ type: "text", text: emFluxo.texto }], stopReason));
  emFluxo = undefined;
}

/** Como o agente da auditoria: três tarefas `scout` em paralelo, o resultado e as seções da resposta. */
function auditar(): void {
  const tasks = ["Oportunidades de melhoria", "Custos", "Qualidade"].map((analise) => ({
    agent: "scout",
    task: `${analise}: leia o indice.md e as sessões`,
  }));
  mensagem(doAgente([{ type: "toolCall", id: "a1", name: "subagent", arguments: { tasks } }], "toolUse"));
  mensagem({
    role: "toolResult",
    toolCallId: "a1",
    toolName: "subagent",
    content: [{ type: "text", text: "3 subagentes (scout) concluídos: melhorias, custos, qualidade." }],
    isError: false,
  });
  responder(
    [
      "## Oportunidades de melhoria\n\nO prompt do desenvolvimento repete o desenho inteiro.",
      "## Custos\n\nO desenvolvimento levou a maior parte do gasto.",
      "## Qualidade\n\nHouve retrabalho e correções do Auditor no mês.",
      "## Melhorias propostas\n\n1. Resumo por ticket no prompt do desenvolvimento.",
    ].join("\n\n"),
  );
}

/** Como o agente da avaliação: um achado por linha em `achados.jsonl`, como a ferramenta `registrar_achado`. */
function avaliar(texto: string): void {
  const n = texto.includes("[20 achados]") ? 20 : 3;
  const achados = Array.from({ length: n }, (_, i) => ({
    titulo: `Achado ${String(i + 1)}: o prompt repete o desenho`,
    descricao: `O prompt do desenvolvimento traz o desenho inteiro em cada ticket (${String(i + 1)}).`,
    evidencia: `sessoes/I-10-s${String(i + 1)}.md: o desenho aparece de novo no começo da sessão`,
  }));
  appendFileSync(join(process.cwd(), "achados.jsonl"), achados.map((a) => `${JSON.stringify(a)}\n`).join(""));
  responder(`Registrei ${String(n)} achados.`);
}

const DIALOGOS: Record<string, object> = {
  select: { title: "Qual ordem os cupons devem ter?", options: ["Maior desconto primeiro", "Validade mais próxima"] },
  confirm: { title: "Posso apagar o cache?", message: "Os relatórios vão ficar lentos por uma hora." },
  input: { title: "Qual é o limite?", placeholder: "em segundos" },
  editor: { title: "Revise a mensagem", prefill: "linha 1\nlinha 2" },
};

const dialogo = (method: string) => {
  emitir({ type: "extension_ui_request", id: `d-${method}`, method, ...DIALOGOS[method] });
};

/** O `select` aberto de dentro da `perguntar`: o `tool_execution_start` vem antes e o `end`, com a resposta. */
function perguntar(multiSelect: boolean): void {
  const { title: question, options } = DIALOGOS.select as { title: string; options: string[] };
  const args = { question, multiSelect, options: options.map((label) => ({ label, description: `Ordem: ${label}` })) };
  emitir({ type: "tool_execution_start", toolCallId: "p1", toolName: "perguntar", args });
  emitir({ type: "extension_ui_request", id: "d-select", method: "select", title: question, options });
}

async function aoPrompt(texto: string): Promise<void> {
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  mensagem({ role: "user", content: texto });
  const pergunta = /pergunte (select|confirm|input|editor|perguntar|multipla)/.exec(texto)?.[1];
  if (texto.startsWith("# Auditoria")) {
    auditar();
    emitir({ type: "agent_settled" });
    return;
  }
  if (texto.startsWith("# Avaliação")) {
    avaliar(texto);
    emitir({ type: "agent_end" });
    emitir({ type: "agent_settled" });
    return;
  }
  if (texto.includes("[ao vivo]")) {
    await aoVivo();
    return;
  }
  if (texto.includes("[longo]")) {
    await longo();
    return;
  }
  if (pergunta) {
    responder("Preciso de uma resposta.");
    if (pergunta === "perguntar" || pergunta === "multipla") perguntar(pergunta === "multipla");
    else dialogo(pergunta);
    return;
  }
  if (texto.startsWith("eco: ")) responder(texto.slice("eco: ".length));
  else responder(process.env.FALSO_PI_RESPOSTA ?? "pronto");
  emitir({ type: "agent_settled" });
}

interface Comando {
  type?: string;
  message?: string;
  id?: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

function aoComando(c: Comando): void {
  if (c.type === "prompt") void aoPrompt(c.message ?? "");
  if (c.type === "steer") {
    emitir({ type: "response", command: "steer", success: true });
    fecharFluxo();
    mensagem({ role: "user", content: c.message });
    responder(`Redirecionado: ${String(c.message)}`);
    dialogo("select");
  }
  if (c.type === "follow_up") emitir({ type: "response", command: "follow_up", success: true });
  if (c.type === "extension_ui_response") {
    const { type: _, id: __, ...resposta } = c;
    emitir({ type: "tool_execution_end", toolCallId: "p1", toolName: "perguntar" });
    responder(`Resposta do diálogo: ${JSON.stringify(resposta)}`);
    emitir({ type: "agent_settled" });
  }
  if (c.type === "abort") {
    emitir({ type: "response", command: "abort", success: true });
    fecharFluxo("aborted");
    emitir({ type: "agent_settled" });
  }
}

let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte: string) => {
  const linhas = (resto + parte).split("\n");
  resto = linhas.pop() ?? "";
  for (const linha of linhas) aoComando(JSON.parse(linha) as Comando);
});
