// Roda um comando externo com `spawn` e argumentos em lista, sem shell: nenhum argumento vira comando.
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { LIMITE_COMANDO_MS } from "../nucleo/primitivos.ts";

/**
 * `sinal` para o grupo de processos `pgid` inteiro. Grupo que já acabou é ignorado: quem ainda segura o stdout saiu
 * do grupo (setsid) e não é alcançável daqui.
 */
export function sinalNoGrupo(pgid: number, sinal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, sinal);
  } catch {
    // ESRCH: o grupo já acabou.
  }
}

interface Saida {
  codigo: number | null;
  saida: string;
  erro: string;
  /** O comando passou de `limiteMs` e o grupo dele foi morto. */
  limiteEstourado: boolean;
}

interface Opcoes {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Tempo máximo; passado ele, o grupo de processos inteiro leva SIGKILL (o que o shell lançou inclusive). */
  limiteMs?: number;
  /** Guarda só o fim de stdout e de stderr, pelo menos estes caracteres: saída enorme não esgota a memória. */
  ultimos?: number;
  /** O que escrever no stdin do comando, fechado em seguida; sem ela, o comando não tem stdin. */
  entrada?: string;
}

/**
 * Espera o comando terminar e devolve o código de saída, o stdout e o stderr. O stdin leva só a `entrada`, e fecha:
 * o comando nunca espera resposta de quem não está ali. Só lança se o programa nem chega a rodar (ex.: não está
 * instalado).
 */
export function executar(
  comando: string,
  args: readonly string[],
  { env = process.env, cwd, limiteMs, ultimos = Infinity, entrada }: Opcoes = {},
): Promise<Saida> {
  return new Promise((resolve, reject) => {
    // Com limite, o filho lidera um grupo novo, para o SIGKILL no grupo pegar também os netos.
    const detached = limiteMs !== undefined;
    const filho = spawn(comando, args, {
      env,
      cwd,
      detached,
      stdio: [entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
    filho.stdin?.end(entrada);
    let saida = "";
    let erro = "";
    let limiteEstourado = false;
    const relogio = detached
      ? setTimeout(() => {
          limiteEstourado = true;
          sinalNoGrupo(Number(filho.pid), "SIGKILL");
        }, limiteMs)
      : undefined;
    // Corta só quando passa do dobro, para não copiar a string inteira a cada pedaço.
    const juntar = (atual: string, parte: string) => {
      const junto = atual + parte;
      return junto.length > 2 * ultimos ? junto.slice(-ultimos) : junto;
    };
    filho.stdout.setEncoding("utf8").on("data", (parte: string) => (saida = juntar(saida, parte)));
    filho.stderr.setEncoding("utf8").on("data", (parte: string) => (erro = juntar(erro, parte)));
    filho.on("error", (falha) => {
      clearTimeout(relogio);
      reject(
        new ErroDeRegra(`não foi possível rodar ${comando}: ${falha.message}`, `instale ${comando} ou confira o PATH`),
      );
    });
    // Desarma só no close: neto em segundo plano que sobrevive ao shell segura o stdout e também leva o SIGKILL.
    filho.on("close", (codigo) => {
      clearTimeout(relogio);
      resolve({ codigo, saida, erro, limiteEstourado });
    });
  });
}

/**
 * Lança o comando solto, em grupo próprio e sem stdio, e volta assim que ele nasce: ele segue vivo depois que o
 * chamador sai (o navegador do `abrir`). Só lança se o programa nem chega a rodar.
 */
export async function lancarSolto(comando: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  const filho = spawn(comando, args, { env, detached: true, stdio: "ignore" });
  await once(filho, "spawn");
  filho.unref();
}

/**
 * O git do core roda no host com as credenciais, em repositórios que um container pode escrever (`.git/hooks`,
 * `.git/config`). Por isso hooks e fsmonitor ficam desligados, e `core.sshCommand` e `credential.*.helper` valem os do
 * sistema e do usuário do serviço, lidos como o git os leria dentro de `dir` (com os `includeIf` por diretório), mas
 * sem os escopos do repositório.
 */
async function lerConfigsFixasDoServico(dir: string): Promise<string[]> {
  const configs = (
    await executar("git", ["-C", dir, "config", "--show-scope", "-z", "--list"], { limiteMs: LIMITE_COMANDO_MS })
  ).saida
    .split("\0")
    // O -z separa o escopo, a chave e o valor assim: `escopo\0chave\nvalor\0`.
    .reduce<{ escopo: string; chave: string; valor: string }[]>((lidas, campo, i, campos) => {
      if (i % 2 === 1) {
        const [chave = "", ...valor] = campo.split("\n");
        lidas.push({ escopo: campos[i - 1] ?? "", chave, valor: valor.join("\n") });
      }
      return lidas;
    }, []);
  const doServico = configs.filter(({ escopo }) => escopo === "system" || escopo === "global");
  const ehHelper = ({ chave }: { chave: string }) => /^credential\.(.*\.)?helper$/i.test(chave);
  const sshCommand = doServico.findLast(({ chave }) => chave.toLowerCase() === "core.sshcommand")?.valor ?? "ssh";
  // Valor vazio zera a lista da chave, inclusive o que o repositório definiu nela: zera toda chave vista e repete as do serviço.
  const chavesDeHelper = new Set(["credential.helper", ...configs.filter(ehHelper).map(({ chave }) => chave)]);
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.sshCommand=${sshCommand}`,
    ...[...chavesDeHelper].flatMap((chave) => ["-c", `${chave}=`]),
    ...doServico.filter(ehHelper).flatMap(({ chave, valor }) => ["-c", `${chave}=${valor}`]),
  ];
}

/**
 * O git segue o `commondir` de um `.git` e executa a config que achar lá (`core.fsmonitor`, `receivepack`...) com o env do
 * serviço. O container não escreve no topo do `.git` do clone, mas o core confere antes de usar: um `.git` de clone com
 * `commondir` é forjado. O core só roda git na raiz do clone (nunca numa worktree, que o container controla).
 */
function suspeitaDeCommondirForjado(dir: string): string | null {
  const commondir = join(dir, ".git", "commondir");
  return existsSync(commondir)
    ? `${commondir} existe num clone: recusado, o container não deveria tê-lo gravado`
    : null;
}

/**
 * `git -C <dir> <args>`, sem terminal para pedir senha (falha em vez de esperar quem não está ali) e em LC_ALL=C:
 * mensagens e saídas lidas pelo texto (como a do `clean`) nunca vêm traduzidas. Passado `limiteMs`, o grupo do git
 * é morto e o stderr diz por quê: um `fetch` parado nunca prende a execução.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export async function gitComLimite(limiteMs: number, dir: string, ...args: string[]): Promise<Saida> {
  const suspeita = suspeitaDeCommondirForjado(dir);
  if (suspeita) return { codigo: 128, saida: "", erro: suspeita, limiteEstourado: false };
  const r = await executar("git", [...(await lerConfigsFixasDoServico(dir)), "-C", dir, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    limiteMs,
  });
  return r.limiteEstourado ? { ...r, erro: `${r.erro}passou do limite de ${String(limiteMs)} ms e foi morto` } : r;
}

/** `gitComLimite` com o limite dos comandos configurados (F3 §6, F5 §3.2). */
export const git = (dir: string, ...args: string[]): Promise<Saida> => gitComLimite(LIMITE_COMANDO_MS, dir, ...args);

interface Resultado {
  /** `null` quando o comando morreu por sinal ou estourou o limite. */
  codigo: number | null;
  estourou: boolean;
  duracaoMs: number;
  /**
   * O stderr do próprio shell (ex.: erro de sintaxe, que sai antes de o `exec 2>&1` rodar) e depois stdout e stderr
   * do comando intercalados; em UTF-8 sem byte nulo, com no máximo `limiteLog` bytes (os do fim).
   */
  log: string;
}

/**
 * Comando de shell configurado pelo Auditor (testes, fitness, preparação): `/bin/sh -c`, com `cwd` na worktree e
 * `limiteMs`. O `exec 2>&1` na mesma linha junta stderr ao stdout na ordem em que o comando escreve, sem mudar o
 * número das linhas nas mensagens do shell. Erro de sintaxe impede o shell de rodar a linha, `exec` inclusive: a
 * mensagem chega pelo stderr, e por isso o stderr entra no log antes do stdout.
 * ponytail: só o fim do log; se precisar do início, guardar as duas pontas (F3 §6).
 */
export async function executarNoShell(
  comando: string,
  cwd: string,
  {
    env,
    limiteMs = LIMITE_COMANDO_MS,
    limiteLog,
  }: {
    env?: NodeJS.ProcessEnv;
    limiteMs?: number;
    /** Bytes guardados do fim do log; cada chamador diz quanto cabe no destino dele. */
    limiteLog: number;
  },
): Promise<Resultado> {
  const inicio = performance.now();
  const r = await executar("/bin/sh", ["-c", `exec 2>&1; ${comando}`], { env, cwd, limiteMs, ultimos: limiteLog });
  const duracaoMs = Math.round(performance.now() - inicio);
  // A saída já veio decodificada (byte inválido vira U+FFFD); o byte nulo, que a classe `texto` recusa, também.
  const bytes = Buffer.from((r.erro + r.saida).replaceAll("\0", "\uFFFD"));
  let corte = Math.max(0, bytes.length - limiteLog);
  // Não começa no meio de um caractere: pula os bytes de continuação (10xxxxxx).
  while ((bytes[corte] ?? 0) >> 6 === 0b10) corte++;
  return {
    codigo: r.limiteEstourado ? null : r.codigo,
    estourou: r.limiteEstourado,
    duracaoMs,
    log: bytes.subarray(corte).toString("utf8"),
  };
}
