// CLI `fabriquinha` (F7 §3): sem `FABRIQUINHA_EXECUCAO`, o serviço (`servidor`, `abrir`) e a ferramenta externa
// (`demanda ...`); com ela, só o agente da execução da demanda. Converte a entrada, chama o comando e traduz o resultado
// em uma linha de JSON e o erro em uma linha de texto. Nenhuma regra mora aqui.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { z, ZodError } from "zod";
import { ErroDeRegra, encontrado, mensagem } from "../dominio/erros.ts";
import { iniciarServico } from "../execucao/servico.ts";
import { abrir as abrirBanco, raizPadrao } from "../persistencia/banco.ts";
import {
  type ChamadaDemanda,
  COMANDOS_DEMANDA as LEITURAS_DEMANDA,
  type ComandoDemanda,
  resolverAgenteDemanda,
} from "./agente_demanda.ts";
import { COMANDOS_DEMANDA_EXTERNA, type ComandoExterno, ErroDeUso } from "./demanda_externa.ts";
import { COMANDOS_EVIDENCIA_DEMANDA } from "./evidencia_agente_demanda.ts";

const COMANDOS_DEMANDA: readonly ComandoDemanda[] = [...LEITURAS_DEMANDA, ...COMANDOS_EVIDENCIA_DEMANDA];

/** O processo visto pelo CLI; o ponto de entrada passa o real, os testes passam o seu. */
export interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(texto: string): unknown };
  readonly stderr: { write(texto: string): unknown };
  /** Resolve quando o `servidor` deve parar (SIGINT ou SIGTERM). */
  parada(): Promise<unknown>;
}

/** Um comando do serviço: sem argumentos, sem banco aberto pelo CLI. */
interface ComandoDoServico {
  readonly palavras: readonly string[];
  readonly argumentos: readonly string[];
  rodar(io: Io): Promise<unknown>;
}

/** O banco da raiz para um comando, fechado no fim. */
async function comBanco<T>(io: Io, rodar: (banco: DatabaseSync) => T | Promise<T>): Promise<T> {
  const banco = abrirBanco(raizPadrao(io.env));
  try {
    return await rodar(banco);
  } finally {
    banco.close();
  }
}

const COMANDOS_DO_SERVICO: readonly ComandoDoServico[] = [
  {
    palavras: ["servidor"],
    argumentos: [],
    async rodar(io) {
      const servico = await iniciarServico(raizPadrao(io.env));
      // Os sinais passam a ser ouvidos antes da linha, que sai quando o serviço já atende: quem a lê pode mandar o
      // SIGTERM na hora, e sem ouvinte o sinal mataria o processo sem parar o serviço.
      const parou = io.parada();
      io.stdout.write(`${JSON.stringify({ porta: servico.porta })}\n`);
      await parou;
      await servico.parar();
    },
  },
  {
    palavras: ["abrir"],
    argumentos: [],
    async rodar(io) {
      const arquivo = join(raizPadrao(io.env), "web.url");
      if (!existsSync(arquivo)) {
        throw new ErroDeRegra(`o serviço não está rodando: falta ${arquivo}`, "suba-o com fabriquinha servidor");
      }
      const url = readFileSync(arquivo, "utf8").trim();
      const navegador = spawn(comandoDoNavegador(process.platform), [url], {
        env: io.env,
        detached: true,
        stdio: "ignore",
      });
      try {
        await once(navegador, "spawn");
      } catch (error_) {
        throw new ErroDeRegra(
          `a Fabriquinha não conseguiu abrir o navegador: ${mensagem(error_)}`,
          `abra ${url} no navegador`,
        );
      }
      navegador.unref();
      return { url };
    },
  },
];

/** O programa que abre uma URL no navegador padrão. */
export const comandoDoNavegador = (plataforma: NodeJS.Platform): string =>
  plataforma === "darwin" ? "open" : "xdg-open";

/** O que `uso`, `ajuda` e `argumentosDe` leem de um comando, do serviço, do agente ou da ferramenta externa. */
type Forma = Pick<ComandoDemanda, "palavras" | "argumentos" | "opcoesDeUso" | "opcoes">;

const uso = (c: Forma): string =>
  ["  fabriquinha", ...c.palavras, ...c.argumentos, ...(c.opcoesDeUso ? [c.opcoesDeUso] : [])].join(" ");

/**
 * A ajuda de quem chama: o agente vê só os comandos da execução da demanda; sem `FABRIQUINHA_EXECUCAO`, só o serviço e
 * a ferramenta externa. Com um grupo conhecido (`demanda`, `ticket`...), só ele.
 */
function ajuda(grupo: string | undefined, doAgente: boolean): string {
  const secoes: readonly (readonly [string, readonly Forma[]])[] = doAgente
    ? [
        [
          "Agente de uma execução da demanda (tickets e rodadas pelo endereço, como I-206.T3 e I-206.R2):",
          COMANDOS_DEMANDA,
        ],
      ]
    : [
        ["Serviço:", COMANDOS_DO_SERVICO],
        ["Ferramenta externa, demandas (sem FABRIQUINHA_EXECUCAO):", COMANDOS_DEMANDA_EXTERNA],
      ];
  const doGrupo = (cs: readonly Forma[]) => cs.filter((c) => c.palavras[0] === grupo);
  const conhecido = secoes.some(([, cs]) => doGrupo(cs).length > 0);
  return [
    "Uso:",
    ...secoes.flatMap(([titulo, cs]) => {
      const escolhidos = conhecido ? doGrupo(cs) : cs;
      return escolhidos.length > 0 ? ["", titulo, ...escolhidos.map(uso)] : [];
    }),
    "",
    "Com FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.",
    "IDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.",
    "",
  ].join("\n");
}

/** O comando do agente da demanda: o banco e o agente resolvidos de `execucao`; a execução que não existe é ErroDeEscopo. */
async function rodarDaDemanda(
  comando: ComandoDemanda,
  resto: readonly string[],
  io: Io,
  execucao: string,
): Promise<unknown> {
  const chamada = argumentosDe(comando, resto);
  return comBanco(io, (banco) =>
    comando.rodar({
      ...chamada,
      stdin: io.stdin,
      banco,
      agente: encontrado(
        resolverAgenteDemanda(banco, execucao),
        `a execução ${execucao} não existe`,
        "confira FABRIQUINHA_EXECUCAO",
      ),
    }),
  );
}

/** O comando da ferramenta externa: banco, ambiente e stdin do processo. */
async function rodarExterno(comando: ComandoExterno, resto: readonly string[], io: Io): Promise<unknown> {
  const chamada = argumentosDe(comando, resto);
  return comBanco(io, (banco) => comando.rodar({ ...chamada, banco, env: io.env, stdin: io.stdin }));
}

/** O comando de `args` na tabela de quem chama, rodado; nenhum outro é alcançável (uso inválido). */
function rodarComando(args: readonly string[], io: Io): Promise<unknown> {
  const achar = <T extends Forma>(tabela: readonly T[]) =>
    tabela.find((c) => c.palavras.every((p, i) => args[i] === p));
  const comandoDesconhecido = () =>
    new ErroDeUso(args.length === 0 ? "falta o comando" : `comando desconhecido: ${args.join(" ")}`);
  const execucao = io.env.FABRIQUINHA_EXECUCAO;
  if (execucao) {
    const doAgente = achar(COMANDOS_DEMANDA);
    if (!doAgente) throw comandoDesconhecido();
    return rodarDaDemanda(doAgente, args.slice(doAgente.palavras.length), io, execucao);
  }
  const externo = achar(COMANDOS_DEMANDA_EXTERNA);
  if (externo) return rodarExterno(externo, args.slice(externo.palavras.length), io);
  const doServico = achar(COMANDOS_DO_SERVICO);
  if (!doServico) throw comandoDesconhecido();
  argumentosDe(doServico, args.slice(doServico.palavras.length));
  return doServico.rodar(io);
}

/** Os argumentos de `comando` lidos com `parseArgs` estrito (F7 §3.3). */
function argumentosDe(comando: Forma, resto: readonly string[]): Pick<ChamadaDemanda, "pos" | "op"> {
  let lidos;
  try {
    lidos = parseArgs({ args: resto, options: comando.opcoes ?? {}, strict: true, allowPositionals: true });
  } catch (error_) {
    throw new ErroDeUso(mensagem(error_));
  }
  const { positionals: pos, values: op } = lidos;
  const faltando = comando.argumentos[pos.length];
  if (faltando !== undefined) throw new ErroDeUso(`falta ${faltando}`);
  if (pos.length > comando.argumentos.length) throw new ErroDeUso(`argumento a mais: ${String(pos.at(-1))}`);
  return { pos, op: op as ChamadaDemanda["op"] };
}

/** Uma linha só: o `ZodError` vem pelo `z.prettifyError`, com o caminho de cada campo (F3 §5). */
const umaLinha = (erro: unknown): string =>
  (erro instanceof ZodError ? z.prettifyError(erro) : mensagem(erro))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");

/** Roda `fabriquinha <args>` e devolve o código de saída: 0 sucesso, 1 erro, 2 uso inválido (F7 §3.3). */
export async function principal(args: readonly string[], io: Io): Promise<number> {
  const doAgente = Boolean(io.env.FABRIQUINHA_EXECUCAO);
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(ajuda(args[0], doAgente));
    return 0;
  }
  try {
    const resultado = await rodarComando(args, io);
    if (resultado !== undefined) io.stdout.write(`${JSON.stringify(resultado)}\n`);
    return 0;
  } catch (error_) {
    if (error_ instanceof ErroDeUso) {
      io.stderr.write(`${error_.message}\n\n${ajuda(args[0], doAgente)}`);
      return 2;
    }
    io.stderr.write(`${umaLinha(error_)}\n`);
    return 1;
  }
}
