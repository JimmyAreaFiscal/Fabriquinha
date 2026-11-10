// CLI `fabriquinha` (F7 §3): sem `FABRIQUINHA_EXECUCAO`, o serviço (`servidor`, `abrir`) e a ferramenta externa
// (`demanda ...`); com ela, só o agente da execução da demanda. Converte a entrada, chama o comando e traduz o resultado
// em uma linha de JSON e o erro em uma linha de texto. Nenhuma regra mora aqui; o que abre banco, serviço e navegador
// vem da composição pelos `DepsDoCli`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z, ZodError } from "zod";
import { ErroDeRegra, mensagem } from "../../nucleo/erros.ts";
import { COMANDOS_DEMANDA as LEITURAS_DEMANDA } from "./agente_demanda.ts";
import { type Comando, type DepsDoCli, type EntradaDoComando, ErroDeUso } from "./comando.ts";
import { COMANDOS_DEMANDA_EXTERNA } from "./demanda_externa.ts";
import { COMANDOS_EVIDENCIA_DEMANDA } from "./evidencia_agente_demanda.ts";

const COMANDOS_DO_AGENTE: readonly Comando[] = [...LEITURAS_DEMANDA, ...COMANDOS_EVIDENCIA_DEMANDA];

const COMANDOS_DO_SERVICO: readonly Comando[] = [
  {
    nome: "servidor",
    posicionais: [],
    argumentos: {},
    async executar(_, deps) {
      const servico = await deps.iniciarServico();
      // Os sinais passam a ser ouvidos antes da linha, que sai quando o serviço já atende: quem a lê pode mandar o
      // SIGTERM na hora, e sem ouvinte o sinal mataria o processo sem parar o serviço.
      const parou = deps.parada();
      deps.stdout.write(`${JSON.stringify({ porta: servico.porta })}\n`);
      await parou;
      await servico.parar();
      deps.sair?.();
    },
  },
  {
    nome: "abrir",
    posicionais: [],
    argumentos: {},
    async executar(_, deps) {
      const arquivo = join(deps.raiz, "web.url");
      if (!existsSync(arquivo)) {
        throw new ErroDeRegra(`o serviço não está rodando: falta ${arquivo}`, "suba-o com fabriquinha servidor");
      }
      const url = readFileSync(arquivo, "utf8").trim();
      try {
        await deps.abrirNoNavegador(url);
      } catch (error_) {
        throw new ErroDeRegra(
          `a Fabriquinha não conseguiu abrir o navegador: ${mensagem(error_)}`,
          `abra ${url} no navegador`,
        );
      }
      return { url };
    },
  },
];

const palavrasDe = (comando: Comando): readonly string[] => comando.nome.split(" ");

const uso = (c: Comando): string =>
  ["  fabriquinha", ...palavrasDe(c), ...c.posicionais, ...(c.opcoesDeUso ? [c.opcoesDeUso] : [])].join(" ");

/**
 * A ajuda de quem chama: o agente vê só os comandos da execução da demanda; sem `FABRIQUINHA_EXECUCAO`, só o serviço e
 * a ferramenta externa. Com um grupo conhecido (`demanda`, `ticket`...), só ele.
 */
function ajuda(grupo: string | undefined, doAgente: boolean): string {
  const secoes: readonly (readonly [string, readonly Comando[]])[] = doAgente
    ? [
        [
          "Agente de uma execução da demanda (tickets e rodadas pelo endereço, como I-206.T3 e I-206.R2):",
          COMANDOS_DO_AGENTE,
        ],
      ]
    : [
        ["Serviço:", COMANDOS_DO_SERVICO],
        ["Ferramenta externa, demandas (sem FABRIQUINHA_EXECUCAO):", COMANDOS_DEMANDA_EXTERNA],
      ];
  const doGrupo = (cs: readonly Comando[]) => cs.filter((c) => palavrasDe(c)[0] === grupo);
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

/** O comando de `args` na tabela de quem chama, rodado; nenhum outro é alcançável (uso inválido). */
function rodarComando(args: readonly string[], deps: DepsDoCli): Promise<unknown> {
  const achar = (tabela: readonly Comando[]) => tabela.find((c) => palavrasDe(c).every((p, i) => args[i] === p));
  const comando = deps.env.FABRIQUINHA_EXECUCAO
    ? achar(COMANDOS_DO_AGENTE)
    : (achar(COMANDOS_DEMANDA_EXTERNA) ?? achar(COMANDOS_DO_SERVICO));
  if (!comando) throw new ErroDeUso(args.length === 0 ? "falta o comando" : `comando desconhecido: ${args.join(" ")}`);
  return comando.executar(entradaDe(comando, args.slice(palavrasDe(comando).length)), deps);
}

/** Os argumentos de `comando` lidos com `parseArgs` estrito (F7 §3.3). */
function entradaDe(comando: Comando, resto: readonly string[]): EntradaDoComando {
  let lidos;
  try {
    lidos = parseArgs({ ...comando.argumentos, args: resto, strict: true, allowPositionals: true });
  } catch (error_) {
    throw new ErroDeUso(mensagem(error_));
  }
  const { positionals: posicionais, values: opcoes } = lidos;
  const faltando = comando.posicionais[posicionais.length];
  if (faltando !== undefined) throw new ErroDeUso(`falta ${faltando}`);
  if (posicionais.length > comando.posicionais.length) {
    throw new ErroDeUso(`argumento a mais: ${String(posicionais.at(-1))}`);
  }
  return { posicionais, opcoes };
}

/** Uma linha só: o `ZodError` vem pelo `z.prettifyError`, com o caminho de cada campo (F3 §5). */
const umaLinha = (erro: unknown): string =>
  (erro instanceof ZodError ? z.prettifyError(erro) : mensagem(erro))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");

/** Roda `fabriquinha <args>` e devolve o código de saída: 0 sucesso, 1 erro, 2 uso inválido (F7 §3.3). */
export async function principal(args: readonly string[], deps: DepsDoCli): Promise<number> {
  const doAgente = Boolean(deps.env.FABRIQUINHA_EXECUCAO);
  if (args.includes("--help") || args.includes("-h")) {
    deps.stdout.write(ajuda(args[0], doAgente));
    return 0;
  }
  try {
    const resultado = await rodarComando(args, deps);
    if (resultado !== undefined) deps.stdout.write(`${JSON.stringify(resultado)}\n`);
    return 0;
  } catch (error_) {
    if (error_ instanceof ErroDeUso) {
      deps.stderr.write(`${error_.message}\n\n${ajuda(args[0], doAgente)}`);
      return 2;
    }
    deps.stderr.write(`${umaLinha(error_)}\n`);
    return 1;
  }
}
