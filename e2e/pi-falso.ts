#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// pi falso do e2e (F4 §12), via FABRIQUINHA_PI: responde `--version`, lista modelos em `--list-models` e, no modo
// RPC, fala o protocolo do pi: grava cada mensagem no JSONL da sessão e a emite. O que faz com o `prompt` depende do
// texto dele:
// - "[ao vivo]": raciocínio, uma ferramenta que falha e um texto chegando em fluxo, sem terminar, até um `steer`, que
//   o redireciona e abre um diálogo `select`;
// - "# Auditoria" (o prompt da auditoria do Histórico, F4): chama `subagent` com três tarefas `scout`, recebe o
//   resultado e responde com as quatro seções; uma pergunta depois cai na resposta padrão;
// - "registre" (a mensagem inteira, ou em negrito): como o agente do registro, edita a issue e submete as evidências
//   pelo CLI `fabriquinha`; o prompt da etapa autônoma também diz "registre", e não conta;
// - "pergunte <select|confirm|input|editor>": abre esse diálogo;
// - "crie um ticket": como o agente da sessão em aberto, cria um ticket de desenvolvimento pelo CLI `fabriquinha`;
// - qualquer outro: responde $FALSO_PI_RESPOSTA (padrão "pronto") e assenta.
// Em `--mode json` (a Simulação, I-10) não fala o protocolo: espera o EOF do stdin, como o pi real, grava o `relatorio.json` em
// $FABRIQUINHA_SAIDA, como a ferramenta `relatar` da extensão navegador, e sai.
// A resposta a um diálogo é ecoada numa mensagem e assenta; `abort` para a mensagem em fluxo como abortada.
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Como o pi, grava a mensagem em `<session-dir>/<instante>_<session-id>.jsonl` e a emite. */
function mensagem(message: object): void {
  mkdirSync(arg("--session-dir"), { recursive: true });
  const completa = { ...message, timestamp: Date.now() };
  const entrada = { type: "message", timestamp: new Date().toISOString(), message: completa };
  appendFileSync(sessao, `${JSON.stringify(entrada)}\n`);
  emitir({ type: "message_end", message: completa });
}

const doAgente = (content: object[], stopReason = "stop") => ({
  role: "assistant",
  content,
  provider: "anthropic",
  model: "claude-opus-5-5",
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
  emitir({ type: "message_start", message: doAgente([]) });
  emitir({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  const fluxo = { texto: "" };
  emFluxo = fluxo;
  // O último pedaço demora: quem abre o chat depois do começo vê o parcial e o resto chegar.
  for (const [pausa, pedaco] of [
    [50, "Os testes "],
    [50, "esperam a "],
    [1000, "**ordem antiga**"],
  ] as const) {
    await dormir(pausa);
    // Um `steer` ou `abort` no meio já fechou a mensagem.
    if (emFluxo !== fluxo) return;
    fluxo.texto += pedaco;
    emitir({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: pedaco } });
  }
}

/** Termina a mensagem em fluxo, se há uma. */
function fecharFluxo(stopReason = "stop"): void {
  if (emFluxo === undefined) return;
  mensagem(doAgente([{ type: "text", text: emFluxo.texto }], stopReason));
  emFluxo = undefined;
}

/** O CLI `fabriquinha` como o agente o chama, com o escopo da execução no ambiente. */
const cli = (...args: string[]) =>
  execFileSync(process.execPath, [join(import.meta.dirname, "..", "src", "cli", "fabriquinha.ts"), ...args]);

/** A issue do prompt montado pela Fabriquinha (F4 §6.3). */
const issueDoPrompt = () => /Issue: I-(\d+)/.exec(readFileSync(sessao, "utf8"))?.[1] ?? "";

/** Como o agente do registro: título e tipo pelo CLI, e as duas evidências do registro (F3). */
function registrar(): void {
  const issue = issueDoPrompt();
  const saida = String(process.env.FABRIQUINHA_SAIDA);
  cli("issue", "editar", issue, "--titulo", "Exportar pedidos em CSV", "--tipo", "funcionalidade");
  writeFileSync(join(saida, "hoje.txt"), "a contabilidade copia os pedidos à mão\n");
  const comportamento = {
    descricao: "hoje a contabilidade copia os pedidos à mão",
    comoReproduzir: ["abrir o painel"],
  };
  writeFileSync(join(saida, "comportamento.json"), JSON.stringify(comportamento));
  cli(
    "evidencia",
    "add",
    "comportamento",
    "--dados",
    join(saida, "comportamento.json"),
    "--arquivo",
    join(saida, "hoje.txt"),
  );
  const criterios = [
    { id: "CA-1", dado: "pedidos no mês", quando: "exporto", entao: "o CSV traz número, data, cliente e total" },
    // Longo e com código, como os de um agente de verdade: a tabela cabe na coluna do chat sem rolar de lado.
    {
      id: "CA-2",
      dado: "pedidos de outro mês em `exportarPedidos.js`",
      quando: "o Auditor roda `node exportarPedidos.js --mes 2026-10`",
      entao:
        "só os do mês escolhido entram, o stderr fica vazio e o código de saída é 0; com `--mes` inválido, o stderr mostra o uso (`node exportarPedidos.js --mes <AAAA-MM>`)",
    },
  ];
  writeFileSync(join(saida, "criterios.json"), JSON.stringify({ criterios }));
  cli("evidencia", "add", "criterios_aceite", "--dados", join(saida, "criterios.json"));
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

const DIALOGOS: Record<string, object> = {
  select: { title: "Qual ordem os cupons devem ter?", options: ["Maior desconto primeiro", "Validade mais próxima"] },
  confirm: { title: "Posso apagar o cache?", message: "Os relatórios vão ficar lentos por uma hora." },
  input: { title: "Qual é o limite?", placeholder: "em segundos" },
  editor: { title: "Revise a mensagem", prefill: "linha 1\nlinha 2" },
};

const dialogo = (method: string) => {
  emitir({ type: "extension_ui_request", id: `d-${method}`, method, ...DIALOGOS[method] });
};

async function aoPrompt(texto: string): Promise<void> {
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  mensagem({ role: "user", content: texto });
  const pergunta = /pergunte (select|confirm|input|editor)/.exec(texto)?.[1];
  if (texto.startsWith("# Auditoria")) {
    auditar();
    emitir({ type: "agent_settled" });
    return;
  }
  if (texto.includes("[ao vivo]")) {
    await aoVivo();
    return;
  }
  if (pergunta) {
    responder("Preciso de uma resposta.");
    dialogo(pergunta);
    return;
  }
  if (texto.trim() === "registre" || texto.includes("**registre**")) {
    registrar();
    responder("Registrei o título, o tipo, o comportamento e os critérios de aceite.");
  } else if (texto.includes("crie um ticket")) {
    cli("ticket", "criar", `I-${issueDoPrompt()}`, "--titulo", "Criar o índice da busca");
    responder("Criei o ticket de desenvolvimento do índice.");
  } else responder(process.env.FALSO_PI_RESPOSTA ?? "pronto");
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
