#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// O pi falso único dos testes, roteirizado por JSON. Duas faces no mesmo arquivo:
// - importado, `instalarPiFalso(dir)` aponta $FABRIQUINHA_PI para este arquivo e grava o roteiro e o registro em `dir`;
// - executado como o pi (`import.meta.main`), fala o que o pi real fala: `--version`, `--list-models`, `-p` (chamada
//   única) e o RPC (JSONL no stdin e no stdout).
// O roteiro é uma lista de `PassoPi` em $FALSO_PI_ROTEIRO (o caminho de um JSON ou o próprio JSON, se começa com `[`),
// relido a cada chamada. Cada chamada (prompt do RPC ou `-p`) consome um passo, e o último se repete.
// Sem roteiro, vale o passo `{ marcas: true }`: o comportamento do e2e, que depende de uma marca no texto do prompt.
// Cada início, comando e chamada vai para $FALSO_PI_REGISTRO (JSONL), se definido.
import { execFileSync, execSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";

/** Um evento a emitir no stdout, ou uma pausa antes do próximo. */
export type EventoDoRoteiro = { pausaMs: number } | { type: string; [campo: string]: unknown };

/** O que o pi falso faz numa chamada. Tudo é opcional: o passo vazio responde "pronto" e assenta, como um pi comum. */
export interface PassoPi {
  // --- Como a chamada termina (RPC)
  /** assenta: a resposta final e o `agent_settled`; nunca: para depois dos eventos; trava: nunca e não sai nem com o stdin fechado. */
  termina?: "assenta" | "nunca" | "trava";
  /** Sai com este código, escrevendo `stderr`: antes da sessão, ao iniciar (já com a sessão) ou ao receber o prompt (padrão). */
  sai?: { codigo: number; stderr?: string; quando?: "antes_da_sessao" | "ao_iniciar" | "ao_prompt" };
  /** Responde ao prompt com `success: false` e este erro, sem rodar o agente. */
  recusa?: string;
  /** Padrão: emite `agent_start`. */
  inicio?: boolean;
  /** Eventos crus emitidos depois do início: diálogos (`extension_ui_request`), ferramentas, pausas. */
  eventos?: EventoDoRoteiro[];
  /** Abre uma mensagem do assistente (`message_start`) que nunca fecha, como o modelo que trava. */
  mensagemAberta?: boolean;
  /** Ao receber SIGTERM, assenta e sai 50 ms depois, ou o ignora (só o SIGKILL o encerra); padrão: o sinal mata o processo. */
  sigterm?: "assenta" | "ignora";
  // --- A mensagem do assistente
  /** Texto da resposta; "" deixa o conteúdo vazio. Padrão: $FALSO_PI_RESPOSTA ou "pronto". */
  resposta?: string;
  /** O `stopReason` da mensagem do assistente (padrão: stop); "error" leva a `erro` como `errorMessage`. */
  parada?: "stop" | "error" | "aborted";
  erro?: string;
  /** O custo do `usage`; null o omite (padrão: 0,01). */
  custo?: number | null;
  /** Sobrescreve os campos do `usage` (input 10, output 2, cacheRead 0, cacheWrite 0, totalTokens 12); null omite o `usage`. */
  uso?: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens", number>> | null;
  /** Padrão: o par de --provider/--model, ou anthropic/claude-opus-5-5. */
  modelo?: { provedor: string; modelo: string };
  /** Emite `agent_end` antes do `agent_settled`. */
  fimDoAgente?: boolean;
  /** Ao abortar sem texto em fluxo, grava e emite uma mensagem do assistente `aborted`. */
  abortaComMensagem?: boolean;
  // --- A sessão (JSONL de --session-dir)
  /** Padrão: grava no JSONL da sessão; false só emite. */
  sessao?: boolean;
  /** Padrão: a mensagem do usuário é gravada e emitida. */
  usuario?: boolean;
  /** Abre a sessão já no início, com a linha `{ type: "session" }`. */
  cabecalhoDaSessao?: boolean;
  // --- O que o agente "faz" na pasta de trabalho, antes de responder
  /** Caminho → conteúdo a escrever, ou null para apagar. */
  escreve?: Record<string, string | null>;
  /** Caminho → conteúdo a acrescentar. */
  anexa?: Record<string, string>;
  /** Comando de shell rodado na pasta (o agente "mexendo" no git). */
  shell?: string;
  /** Chamadas ao CLI `fabriquinha`, como o agente as faz (`["revisao", "decidir", "I-1.T2", "aprovar"]`). */
  cli?: string[][];
  /** Módulo (default export assíncrono) que faz o que o CLI do agente faria. */
  agente?: string;
  // --- Os outros modos
  /** Tabela crua e falha opcional de `--list-models`; sem configuração vale a tabela padrão. */
  listaDeModelos?: { tabela?: string; stderr?: string; codigo?: number };
  /** Os modelos (com o `cost` de cada um) que o RPC `get_available_models` devolve; padrão: os da tabela, com preço. */
  catalogoDeModelos?: object[];
  /** Processo sem RPC: saída crua, término opcionalmente só depois do EOF do stdin. */
  saidaDoProcesso?: { stdout?: string; stderr?: string; codigo?: number; esperaEof?: boolean };
  /**
   * `-p`: imprime a saída (texto, ou objeto em JSON) e sai com `codigo`; sem saída, sai com 1. Com `uso`, grava no
   * `--session-dir` a sessão com a mensagem do assistente (anthropic/claude-opus-5-5), como o pi sem `--no-session`.
   */
  chamadaUnica?: { saida?: string | object; codigo?: number; uso?: { input: number; output: number; custo?: number } };
  /** O comportamento do e2e: o texto do prompt escolhe o que fazer ([ao vivo], [longo], eco:, pergunte...). */
  marcas?: boolean;
}

/** O catálogo padrão do `get_available_models`: os modelos da tabela padrão, com o preço em dólares por milhão de tokens. */
const CATALOGO_PADRAO = [
  { provider: "anthropic", id: "claude-opus-5-5", cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { provider: "anthropic", id: "claude-sonnet-5-5", cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
];

interface ComandoRpc {
  type?: string;
  message?: string;
  id?: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/** Uma linha do registro: o início do processo, um comando RPC ou uma chamada `-p`. */
export interface EntradaDoRegistro {
  evento: "inicio" | "comando" | "chamada_unica";
  argv?: string[];
  cwd?: string;
  execucao?: string;
  comando?: ComandoRpc;
  sessao?: string;
}

export interface PiFalso {
  /** O arquivo executável que $FABRIQUINHA_PI aponta. */
  caminho: string;
  /** Troca o roteiro (padrão: um passo comum) e zera o registro. */
  roteirizar: (passos?: PassoPi[]) => PiFalso;
  registro: () => EntradaDoRegistro[];
  /** Um item por prompt RPC que algum pi recebeu, na ordem. */
  prompts: () => { cwd: string; prompt: string; sessao: string }[];
}

/**
 * As entradas completas do registro. Outro pi falso pode estar no meio de um `appendFileSync` de um prompt longo: a
 * linha sem o "\n" final ainda não terminou de ser escrita e fica para a próxima leitura.
 */
const lerRegistro = (caminho: string): EntradaDoRegistro[] =>
  existsSync(caminho)
    ? readFileSync(caminho, "utf8")
        .split("\n")
        .slice(0, -1)
        .filter(Boolean)
        .map((linha) => JSON.parse(linha) as EntradaDoRegistro)
    : [];

/** Instala o pi falso: aponta $FABRIQUINHA_PI para este arquivo e o roteiro e o registro para `dir`. */
export function instalarPiFalso(dir: string): PiFalso {
  const roteiro = join(dir, "pi-roteiro.json");
  const registro = join(dir, "pi-registro.jsonl");
  process.env.FABRIQUINHA_PI = import.meta.filename;
  process.env.FALSO_PI_ROTEIRO = roteiro;
  process.env.FALSO_PI_REGISTRO = registro;
  const piFalso: PiFalso = {
    caminho: import.meta.filename,
    roteirizar(passos = [{}]) {
      writeFileSync(roteiro, JSON.stringify(passos));
      writeFileSync(registro, "");
      return piFalso;
    },
    registro: () => lerRegistro(registro),
    prompts: () =>
      lerRegistro(registro)
        .filter((entrada) => entrada.comando?.type === "prompt")
        .map((entrada) => ({
          cwd: String(entrada.cwd),
          prompt: String(entrada.comando?.message),
          sessao: String(entrada.sessao),
        })),
  };
  return piFalso.roteirizar();
}

async function executarPiFalso(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const emitir = (evento: object) => process.stdout.write(`${JSON.stringify(evento)}\n`);
  const arg = (nome: string) => (argumentos.includes(nome) ? (argumentos[argumentos.indexOf(nome) + 1] ?? "") : "");

  if (argumentos.includes("--version")) {
    console.log("0.0.0-falso");
    process.exit(0);
  }
  const caminhoDoRegistro = process.env.FALSO_PI_REGISTRO;
  // O pi falso não sobrevive à pasta do teste que o instalou (o `after` do teste a remove, passe ele ou falhe). Sem isso,
  // um teste que falha antes de encerrar a sessão deixa o pi esperando o stdin e o processo do teste esperando o pi, e o
  // `node --test` nunca termina.
  if (caminhoDoRegistro) {
    const pastaDoTeste = dirname(caminhoDoRegistro);
    setInterval(() => {
      if (!existsSync(pastaDoTeste)) process.exit(1);
    }, 200).unref();
  }
  const registradasNoProcesso: EntradaDoRegistro[] = [];
  const registrar = (entrada: EntradaDoRegistro) => {
    registradasNoProcesso.push(entrada);
    if (caminhoDoRegistro) appendFileSync(caminhoDoRegistro, `${JSON.stringify(entrada)}\n`);
  };
  const ehChamada = (e: EntradaDoRegistro) => e.comando?.type === "prompt" || e.evento === "chamada_unica";
  /** O passo da próxima chamada: o roteiro é relido a cada vez, e o número de chamadas já feitas escolhe o passo. */
  const proximoPasso = (): PassoPi => {
    const valor = process.env.FALSO_PI_ROTEIRO ?? "";
    if (!valor) return { marcas: true };
    const passos = JSON.parse(valor.startsWith("[") ? valor : readFileSync(valor, "utf8")) as PassoPi[];
    const jaFeitas = (caminhoDoRegistro ? lerRegistro(caminhoDoRegistro) : registradasNoProcesso).filter(ehChamada);
    return passos[Math.min(jaFeitas.length, passos.length - 1)] ?? {};
  };

  const passoDoInicio = proximoPasso();
  registrar({ evento: "inicio", argv: argumentos, cwd: process.cwd(), execucao: process.env.FABRIQUINHA_EXECUCAO });

  if (argumentos.includes("--list-models")) {
    const { tabela, stderr, codigo } = passoDoInicio.listaDeModelos ?? {};
    process.stdout.write(
      tabela ??
        "provider   model              context  max-out  thinking  images\nanthropic  claude-opus-5-5    200K     64K      yes       yes\nanthropic  claude-sonnet-5-5  200K     64K      yes       yes\n",
    );
    if (stderr) process.stderr.write(stderr);
    process.exit(codigo ?? 0);
  }
  if (passoDoInicio.saidaDoProcesso) {
    const { stdout, stderr, codigo, esperaEof } = passoDoInicio.saidaDoProcesso;
    if (esperaEof) await new Promise((pronto) => process.stdin.resume().on("end", pronto));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(codigo ?? 0);
  }

  if (argumentos.includes("-p")) {
    registrar({ evento: "chamada_unica", argv: argumentos, cwd: process.cwd() });
    const { saida, codigo, uso } = passoDoInicio.chamadaUnica ?? {};
    if (uso) {
      const dir = arg("--session-dir");
      mkdirSync(dir, { recursive: true });
      const usage = { input: uso.input, output: uso.output, cacheRead: 0, cacheWrite: 0, cost: { total: uso.custo } };
      const message = { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", usage };
      const entrada = { type: "message", timestamp: new Date().toISOString(), message };
      appendFileSync(join(dir, "consulta.jsonl"), `${JSON.stringify(entrada)}\n`);
    }
    if (saida !== undefined) process.stdout.write(`${typeof saida === "string" ? saida : JSON.stringify(saida)}\n`);
    process.exit(codigo ?? (saida === undefined ? 1 : 0));
  }
  falarRpc(passoDoInicio, { argumentos, arg, emitir, registrar, proximoPasso });
}

interface Apoio {
  argumentos: string[];
  arg: (nome: string) => string;
  emitir: (evento: object) => boolean;
  registrar: (entrada: EntradaDoRegistro) => void;
  proximoPasso: () => PassoPi;
}

/** O cliente empacotado `fabriquinha` como o agente o chama, com `FABRIQUINHA_API` e `FABRIQUINHA_TOKEN` no ambiente. */
const cliFabriquinha = (...args: string[]) =>
  execFileSync(process.execPath, [join(import.meta.dirname, "..", "..", "pacote-pi", "bin", "fabriquinha"), ...args]);

const DIALOGOS: Record<string, object> = {
  select: { title: "Qual ordem os cupons devem ter?", options: ["Maior desconto primeiro", "Validade mais próxima"] },
  confirm: { title: "Posso apagar o cache?", message: "Os relatórios vão ficar lentos por uma hora." },
  input: { title: "Qual é o limite?", placeholder: "em segundos" },
  editor: { title: "Revise a mensagem", prefill: "linha 1\nlinha 2" },
};

/** O RPC: lê os comandos do stdin e responde conforme o passo da chamada. */
function falarRpc(passoDoInicio: PassoPi, { argumentos, arg, emitir, registrar, proximoPasso }: Apoio) {
  let passo = passoDoInicio;
  let arquivoDaSessao: string | undefined;

  const sair = ({ codigo, stderr }: NonNullable<PassoPi["sai"]>) => {
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exit(codigo);
  };

  /** Como o pi, a sessão é `<session-dir>/<instante>_<session-id>.jsonl`; uma já existente com o id é reaproveitada. */
  function abrirSessao(): string | undefined {
    const dir = arg("--session-dir");
    if (!dir) return undefined;
    if (arquivoDaSessao) return arquivoDaSessao;
    mkdirSync(dir, { recursive: true });
    const id = arg("--session-id");
    const existente = readdirSync(dir).find((nome) => nome.endsWith(`_${id}.jsonl`));
    arquivoDaSessao = join(dir, existente ?? `2026-10-11T00-00-00-000Z_${id}.jsonl`);
    if (existente) return arquivoDaSessao;
    // Como o pi, `--fork` começa a sessão nova com a conversa da sessão copiada.
    if (argumentos.includes("--fork")) copyFileSync(arg("--fork"), arquivoDaSessao);
    else if (passo.cabecalhoDaSessao)
      appendFileSync(arquivoDaSessao, `${JSON.stringify({ type: "session", version: 3, id })}\n`);
    return arquivoDaSessao;
  }

  if (passo.sai?.quando === "antes_da_sessao") sair(passo.sai);
  if (passo.cabecalhoDaSessao || argumentos.includes("--fork")) abrirSessao();
  if (passo.sai?.quando === "ao_iniciar") sair(passo.sai);

  process.on("SIGTERM", () => {
    if (passo.sigterm === "ignora") return;
    if (passo.sigterm === "assenta") {
      emitir({ type: "agent_settled" });
      setTimeout(() => process.exit(0), 50);
      return;
    }
    process.removeAllListeners("SIGTERM");
    process.kill(process.pid, "SIGTERM");
  });

  /** Um instante por mensagem, sempre maior que o anterior: o chat distingue as mensagens pelo papel e pelo instante. */
  let ultimo = 0;
  const agora = () => (ultimo = Math.max(Date.now(), ultimo + 1));

  /** Grava a mensagem na sessão (a menos que o passo diga que não) e a emite. */
  function mensagem(message: object): void {
    const completa = { ...message, timestamp: agora() };
    const arquivo = passo.sessao === false ? undefined : abrirSessao();
    if (arquivo) {
      const entrada = { type: "message", timestamp: new Date().toISOString(), message: completa };
      appendFileSync(arquivo, `${JSON.stringify(entrada)}\n`);
    }
    emitir({ type: "message_end", message: completa });
  }

  const doAgente = (content: object[], stopReason: string = passo.parada ?? "stop") => ({
    role: "assistant",
    content,
    provider: passo.modelo?.provedor ?? (arg("--provider") || "anthropic"),
    model: passo.modelo?.modelo ?? (arg("--model") || "claude-opus-5-5"),
    stopReason,
    ...(passo.uso !== null && {
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
        ...passo.uso,
        ...(passo.custo !== null && { cost: { total: passo.custo ?? 0.01 } }),
      },
    }),
    ...(stopReason === "error" && { errorMessage: passo.erro ?? "limite de uso" }),
  });

  const responder = (texto: string) => {
    mensagem(doAgente(texto ? [{ type: "text", text: texto }] : []));
  };

  /** A resposta final do agente e o fim da chamada. */
  function concluir(texto = passo.resposta ?? process.env.FALSO_PI_RESPOSTA ?? "pronto"): void {
    responder(texto);
    if (passo.fimDoAgente) emitir({ type: "agent_end" });
    emitir({ type: "agent_settled" });
  }

  async function fazerOQueOAgenteFaz(): Promise<void> {
    for (const [caminho, conteudo] of Object.entries(passo.escreve ?? {})) {
      if (conteudo === null) rmSync(caminho);
      else writeFileSync(caminho, conteudo);
    }
    for (const [caminho, conteudo] of Object.entries(passo.anexa ?? {})) appendFileSync(caminho, conteudo);
    if (passo.shell) execSync(passo.shell, { stdio: "ignore" });
    for (const args of passo.cli ?? []) cliFabriquinha(...args);
    if (passo.agente) await ((await import(passo.agente)) as { default: () => Promise<void> }).default();
  }

  // --- Comportamento do e2e (`marcas`): o texto do prompt escolhe o que fazer.

  /** O texto que está chegando em fluxo, ainda sem `message_end`. */
  let emFluxo: { texto: string } | undefined;

  /** Abre uma mensagem em fluxo e emite os pedaços, cada um depois da sua pausa; um `steer` ou `abort` no meio a fecha. */
  async function transmitir(pedacos: readonly (readonly [number, string])[]): Promise<void> {
    emitir({ type: "message_start", message: doAgente([]) });
    emitir({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    const fluxo = { texto: "" };
    emFluxo = fluxo;
    for (const [pausa, pedaco] of pedacos) {
      await dormir(pausa);
      if (emFluxo !== fluxo) return;
      fluxo.texto += pedaco;
      emitir({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: pedaco } });
    }
  }

  /** Termina a mensagem em fluxo, se há uma. */
  function fecharFluxo(stopReason = "stop"): boolean {
    if (emFluxo === undefined) return false;
    mensagem(doAgente([{ type: "text", text: emFluxo.texto }], stopReason));
    emFluxo = undefined;
    return true;
  }

  /** "[ao vivo]": raciocínio, uma ferramenta que falha e um texto em fluxo, sem terminar, até um `steer`. */
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

  /** "[longo]": uma resposta de 40 parágrafos e, em seguida, 25 trechos em fluxo, um a cada 0,6 s. */
  async function longo(): Promise<void> {
    responder(Array.from({ length: 40 }, (_, i) => `Parágrafo ${String(i + 1)} da análise do checkout.`).join("\n\n"));
    await transmitir([
      [100, "Começo do fluxo."],
      ...Array.from({ length: 25 }, (_, i) => [600, `\n\nTrecho ${String(i + 1)} do fluxo.`] as const),
    ]);
  }

  /** Como o revisor: as evidências do ticket (do prompt) e, sem "[sem decidir]", a decisão de aprovar. */
  function revisar(texto: string): void {
    const saida = String(process.env.FABRIQUINHA_SAIDA);
    const ticket = /revisao decidir (I-\d+\.T\d+) aprovar/.exec(texto)?.[1] ?? "";
    const evidencia = (tipo: string, dados: object, ...anexos: string[]) => {
      writeFileSync(join(saida, `${tipo}.json`), JSON.stringify(dados));
      cliFabriquinha(
        "evidencia",
        "add",
        ticket,
        tipo,
        "--dados",
        join(saida, `${tipo}.json`),
        ...anexos.flatMap((a) => ["--arquivo", a]),
      );
    };
    writeFileSync(join(saida, "prova.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const comprovacao = {
      criterios: [{ id: "CA-1", atendido: true, comoVerificado: "li o código", arquivos: ["prova.png"] }],
    };
    if (texto.includes("Modo de trabalhar: revisar rodada")) {
      evidencia("explicacao_fitness", { explicacoes: [{ nome: "f", explicacao: "passou" }] });
    } else {
      const nao = { aplicavel: false, justificativa: "não há carga nem entrada externa" };
      evidencia("testes_estresse", { ...nao, cenarios: [] });
      evidencia("analise_seguranca", { ...nao, ameacas: [], achados: [] });
    }
    evidencia("comprovacao_criterios", comprovacao, join(saida, "prova.png"));
    if (!texto.includes("[sem decidir]")) cliFabriquinha("revisao", "decidir", ticket, "aprovar");
  }

  const dialogo = (method: string) => {
    emitir({ type: "extension_ui_request", id: `d-${method}`, method, ...DIALOGOS[method] });
  };

  /** O `select` aberto de dentro da `perguntar`: o `tool_execution_start` vem antes e o `end`, com a resposta. */
  function perguntar(multiSelect: boolean): void {
    const { title: question, options } = DIALOGOS.select as { title: string; options: string[] };
    const args = {
      question,
      multiSelect,
      options: options.map((label) => ({ label, description: `Ordem: ${label}` })),
    };
    emitir({ type: "tool_execution_start", toolCallId: "p1", toolName: "perguntar", args });
    emitir({ type: "extension_ui_request", id: "d-select", method: "select", title: question, options });
  }

  async function aoPromptPorMarca(texto: string): Promise<void> {
    const pergunta = /pergunte (select|confirm|input|editor|perguntar|multipla)/.exec(texto)?.[1];
    if (texto.includes("Modo de trabalhar: revisar ")) {
      revisar(texto);
      responder("Revisei.");
    } else if (texto.includes("[ao vivo]")) {
      await aoVivo();
      return;
    } else if (texto.includes("[longo]")) {
      await longo();
      return;
    } else if (pergunta) {
      responder("Preciso de uma resposta.");
      if (pergunta === "perguntar" || pergunta === "multipla") perguntar(pergunta === "multipla");
      else dialogo(pergunta);
      return;
    } else if (texto.startsWith("eco: ")) {
      responder(texto.slice("eco: ".length));
    } else {
      responder(process.env.FALSO_PI_RESPOSTA ?? "pronto");
    }
    emitir({ type: "agent_settled" });
  }

  // --- Os comandos do RPC

  async function aoPrompt(texto: string): Promise<void> {
    if (passo.sai && (passo.sai.quando ?? "ao_prompt") === "ao_prompt") sair(passo.sai);
    if (passo.recusa !== undefined) {
      emitir({ type: "response", command: "prompt", success: false, error: passo.recusa });
      return;
    }
    if (!passo.marcas) await fazerOQueOAgenteFaz();
    emitir({ type: "response", command: "prompt", success: true });
    if (passo.inicio !== false) emitir({ type: "agent_start" });
    if (passo.usuario !== false) mensagem({ role: "user", content: texto });
    if (passo.marcas) {
      await aoPromptPorMarca(texto);
      return;
    }
    for (const evento of passo.eventos ?? []) {
      if (typeof evento.pausaMs === "number") await dormir(evento.pausaMs);
      else emitir(evento);
    }
    if (passo.mensagemAberta) emitir({ type: "message_start", message: doAgente([]) });
    if (passo.termina === "trava") setInterval(() => undefined, 1000);
    if ((passo.termina ?? "assenta") === "assenta") concluir();
  }

  function aoComando(comando: ComandoRpc): void {
    if (comando.type === "prompt") passo = proximoPasso();
    registrar({ evento: "comando", comando, cwd: process.cwd(), sessao: arg("--session-id") });
    switch (comando.type) {
      case "prompt":
        void aoPrompt(comando.message ?? "");
        break;
      case "steer":
        emitir({ type: "response", command: "steer", success: true });
        if (passo.marcas) {
          fecharFluxo();
          mensagem({ role: "user", content: comando.message });
          responder(`Redirecionado: ${String(comando.message)}`);
          dialogo("select");
        }
        break;
      case "follow_up":
        emitir({ type: "response", command: "follow_up", success: true });
        break;
      case "extension_ui_response":
        if (passo.marcas) {
          const { type: _, id: __, ...resposta } = comando;
          emitir({ type: "tool_execution_end", toolCallId: "p1", toolName: "perguntar" });
          responder(`Resposta do diálogo: ${JSON.stringify(resposta)}`);
          emitir({ type: "agent_settled" });
        } else if (!comando.cancelled) {
          concluir();
        }
        break;
      case "get_available_models":
        emitir({
          type: "response",
          command: "get_available_models",
          success: true,
          data: { models: passo.catalogoDeModelos ?? CATALOGO_PADRAO },
        });
        break;
      case "abort":
        emitir({ type: "response", command: "abort", success: true });
        if (!fecharFluxo("aborted") && passo.abortaComMensagem) mensagem(doAgente([], "aborted"));
        emitir({ type: "agent_settled" });
        break;
    }
  }

  let resto = "";
  process.stdin.setEncoding("utf8").on("data", (parte: string) => {
    const linhas = (resto + parte).split("\n");
    resto = linhas.pop() ?? "";
    for (const linha of linhas) if (linha) aoComando(JSON.parse(linha) as ComandoRpc);
  });
}

if (import.meta.main) await executarPiFalso();
