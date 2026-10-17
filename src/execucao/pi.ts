// O processo do pi em modo RPC (F4 §6.1): linha de comando, ambiente, confiança herdada, framing do stdout e parada
// do grupo de processos.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { CATALOGO } from "../dominio/evidencia.ts";
import type { ModoExecucao } from "../dominio/agregado.ts";
import type { Effort, Etapa, Modelo } from "../dominio/primitivos.ts";
import { ambienteSemCredenciais, sinalNoGrupo } from "../processo.ts";
import { anotar } from "../persistencia/execucoes.ts";

/** Um evento ou resposta do pi: um objeto JSON por linha do stdout. */
export type EventoPi = Record<string, unknown> & { type?: unknown };

/** Entre o SIGTERM e o SIGKILL no grupo (F4 §6.7). */
const GRACA_MS = 10_000;

/** A raiz do pacote P1 `pi-fabriquinha`, versionado junto com a Fabriquinha (F4 §6.1). */
export const PACOTE = fileURLToPath(new URL("../../pacote-pi", import.meta.url));

/** O binário do pi: `$FABRIQUINHA_PI` ou `pi` do PATH (F4 §10). */
export const binarioPi = (): string => process.env.FABRIQUINHA_PI || "pi";

/** Skills de artefato da etapa (P1 §5.1): uma por evidência de produtor agente; o nome sai do tipo. */
export const skillsDaEtapa = (etapa: Etapa): string[] =>
  CATALOGO.filter((c) => c.etapa === etapa && c.produtor === "agente").map(
    (c) => "artefato-" + c.tipo.replace(/^relatorio_/, "").replaceAll("_", "-"),
  );

/**
 * F4 §6.1.1: a decisão de confiança mais próxima de `repo` (o próprio caminho ou um pai) no `trust.json` do pi, que
 * mora em `$PI_CODING_AGENT_DIR` ou `~/.pi/agent`, como o próprio pi procura. `undefined`: vale o padrão do Auditor.
 */
export function confianca(repo: string): boolean | undefined {
  const arquivo = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "trust.json");
  const decisoes = (existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")) : {}) as Record<string, unknown>;
  const maisProxima = (dir: string): boolean | undefined => {
    const decisao = decisoes[dir];
    if (typeof decisao === "boolean") return decisao;
    return dir === dirname(dir) ? undefined : maisProxima(dirname(dir));
  };
  return maisProxima(realpathSync(repo));
}

export interface Lancamento {
  raiz: string;
  sessaoPi: string;
  etapa: Etapa;
  modelo: Modelo | undefined;
  effort?: Effort;
  confianca: boolean | undefined;
  modo: ModoExecucao;
  /**
   * O arquivo da sessão principal que a consulta copia (F4 §6.5): na primeira execução dela, ou na retomada se a
   * cópia ainda não existe.
   */
  fork?: string;
}

/**
 * F4 §6.1: a configuração do Auditor vale inteira; a Fabriquinha só soma as skills da etapa e a guarda. A consulta
 * (F4 §6.5) copia a sessão principal para a sessão nova `sessaoPi` e tira só as ferramentas embutidas de escrita;
 * além das três da spec, o `powershell`, que o pi 0.84.4 também embute e que altera arquivos se houver `pwsh`.
 */
export const argumentosPi = (l: Lancamento): string[] => [
  "--mode",
  "rpc",
  "--session-dir",
  join(l.raiz, "sessoes"),
  "--session-id",
  l.sessaoPi,
  ...(l.modelo ? ["--provider", l.modelo.provedor, "--model", l.modelo.modelo] : []),
  ...(l.effort ? ["--thinking", l.effort] : []),
  ...skillsDaEtapa(l.etapa).flatMap((skill) => ["--skill", join(PACOTE, "skills", skill)]),
  "-e",
  join(PACOTE, "extensions", "guarda.ts"),
  ...(l.confianca === undefined ? [] : [l.confianca ? "--approve" : "--no-approve"]),
  ...(l.fork ? ["--fork", l.fork] : []),
  ...(l.modo === "consulta" ? ["--exclude-tools", "edit,write,bash,powershell"] : []),
];

/**
 * A auditoria do Histórico: a sessão `sessao` em `<raiz>/sessoes`, sem as ferramentas embutidas de escrita (as da
 * consulta, F4 §6.5) e com a guarda, que só deixa o `subagent` chamar o `scout`. Não herda skills nem modelo de etapa.
 */
export const argumentosDaAuditoria = (raiz: string, sessao: string): string[] => [
  "--mode",
  "rpc",
  "--session-dir",
  join(raiz, "sessoes"),
  "--session-id",
  sessao,
  "-e",
  join(PACOTE, "extensions", "guarda.ts"),
  "--exclude-tools",
  "edit,write,bash,powershell",
];

/**
 * F4 §6.1.2: o ambiente do serviço sem credenciais, com `gh` e `az` apontando para um diretório vazio da execução, e
 * as variáveis da Fabriquinha.
 */
export const ambientePi = (raiz: string, execucao: number, dir: string): NodeJS.ProcessEnv => ({
  ...ambienteSemCredenciais(process.env, join(dir, "vazio")),
  FABRIQUINHA_EXECUCAO: String(execucao),
  FABRIQUINHA_ROOT: raiz,
  FABRIQUINHA_SAIDA: join(dir, "saida"),
});

/**
 * Divide o stdout em registros JSONL só em `\n`, tirando um `\r` final (F4 §6.1.2). O `readline` do Node não serve:
 * ele também quebra em U+2028 e U+2029, que são válidos dentro de strings JSON.
 */
export function divisorJsonl(): (parte: string) => string[] {
  let resto = "";
  return (parte) => {
    const tudo = resto + parte;
    const fim = tudo.lastIndexOf("\n") + 1;
    resto = tudo.slice(fim);
    return tudo
      .slice(0, fim)
      .split("\n")
      .map((linha) => linha.replace(/\r$/, ""))
      .filter((linha) => linha !== "");
  };
}

/**
 * O objeto JSON da linha, ou `undefined` se ela não é JSON ou não é objeto (`null`, número): um neto que herda o
 * stdout pode escrever qualquer coisa nele, e o ouvinte do `data` não pode lançar.
 */
function objetoJson(linha: string): EventoPi | undefined {
  try {
    const valor: unknown = JSON.parse(linha);
    return typeof valor === "object" && valor !== null ? (valor as EventoPi) : undefined;
  } catch {
    return undefined;
  }
}

export interface ProcessoPi {
  /** O grupo de processos do pi (F4 §7). */
  readonly pgid: number;
  /** Um comando RPC, como uma linha JSON no stdin. */
  enviar(comando: object): void;
  /** Resolve com o código de saída quando o pi termina e o stdout fecha, inclusive se ele nem chegou a rodar. */
  readonly saiu: Promise<number | null>;
  /** SIGTERM no grupo, até 10 s para o pi fechar, e SIGKILL no grupo, para não sobrar o que o agente abriu. */
  parar(): Promise<void>;
}

/**
 * Lança o pi num grupo próprio, com o stderr no `log`. Cada linha JSON do stdout vai para `aoEvento`; linha fora do
 * protocolo vai para o log. Com `fecharStdin`, o stdin fecha já: o `--mode json` do pi só começa depois do EOF dele,
 * e o modo RPC precisa do stdin aberto.
 */
export function lancarPi(
  args: readonly string[],
  { cwd, env, log, fecharStdin }: { cwd: string; env: NodeJS.ProcessEnv; log: string; fecharStdin?: boolean },
  aoEvento: (evento: EventoPi) => void,
): ProcessoPi {
  const filho = spawn(binarioPi(), args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const pgid = Number(filho.pid);
  // Escrever no stdin de um pi que já saiu dá EPIPE; sem ouvinte, o erro derrubaria o serviço.
  const falhou = (erro: Error) => {
    anotar(log, `pi: ${erro.message}`);
  };
  filho.on("error", falhou);
  filho.stdin.on("error", falhou);
  if (fecharStdin) filho.stdin.end();
  filho.stderr.on("data", (parte: Buffer) => {
    appendFileSync(log, parte);
  });
  const dividir = divisorJsonl();
  filho.stdout.setEncoding("utf8").on("data", (parte: string) => {
    for (const linha of dividir(parte)) {
      const evento = objetoJson(linha);
      if (evento) aoEvento(evento);
      else anotar(log, `pi, fora do protocolo: ${linha}`);
    }
  });
  const saiu = new Promise<number | null>((resolve) => filho.on("close", resolve));
  return {
    pgid,
    saiu,
    enviar(comando) {
      filho.stdin.write(JSON.stringify(comando) + "\n");
    },
    async parar() {
      sinalNoGrupo(pgid, "SIGTERM");
      await Promise.race([saiu, dormir(GRACA_MS, undefined, { ref: false })]);
      sinalNoGrupo(pgid, "SIGKILL");
    },
  };
}

/**
 * O ambiente da auditoria `dir` (`<raiz>/auditorias/<sessão>`): como o da execução, mas sem `FABRIQUINHA_EXECUCAO`,
 * porque ela não é de nenhum ticket, e com `FABRIQUINHA_AUDITORIA`, que liga a regra do `scout` na guarda.
 */
export function ambienteDaAuditoria(raiz: string, dir: string): NodeJS.ProcessEnv {
  const env = ambienteSemCredenciais(process.env, join(dir, "vazio"));
  delete env.FABRIQUINHA_EXECUCAO;
  return { ...env, FABRIQUINHA_ROOT: raiz, FABRIQUINHA_AUDITORIA: "1" };
}
