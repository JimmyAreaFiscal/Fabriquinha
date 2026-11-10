// Cliente fino do agente (`fabriquinha` empacotado em pacote-pi/bin): converte os argumentos, manda o pedido à API e
// traduz a resposta em uma linha de JSON e o erro em uma linha de texto. Depende só do contrato e do `fetch`; sem banco,
// sem o fonte do core.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { criarApiDoAgente } from "./cliente.ts";
import {
  type Comando,
  type DepsDoCliente,
  type EntradaDoComando,
  ErroDeUso,
  ErroDoComando,
  mensagem,
} from "./comando.ts";
import { COMANDOS_DO_AGENTE } from "./comandos.ts";

const palavrasDe = (comando: Comando): readonly string[] => comando.nome.split(" ");

const uso = (c: Comando): string =>
  ["  fabriquinha", ...palavrasDe(c), ...c.posicionais, ...(c.opcoesDeUso ? [c.opcoesDeUso] : [])].join(" ");

/** A ajuda: todos os comandos do agente, ou só os do grupo (`ticket`, `evidencia`...) quando ele é conhecido. */
function ajuda(grupo: string | undefined): string {
  const doGrupo = COMANDOS_DO_AGENTE.filter((c) => palavrasDe(c)[0] === grupo);
  return [
    "Uso:",
    "",
    "Agente de uma execução da demanda (tickets e rodadas pelo endereço, como I-206.T3 e I-206.R2):",
    ...(doGrupo.length > 0 ? doGrupo : COMANDOS_DO_AGENTE).map(uso),
    "",
    "Com FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.",
    "IDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.",
    "",
  ].join("\n");
}

/** Os argumentos de `comando` lidos com `parseArgs` estrito. */
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

/** Roda `fabriquinha <args>` e devolve o código de saída: 0 sucesso, 1 erro, 2 uso inválido. */
/** @testes o ponto de entrada empacotado a chama; o teste passa o processo dele */
export async function principal(args: readonly string[], deps: DepsDoCliente): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    deps.stdout.write(ajuda(args[0]));
    return 0;
  }
  try {
    const comando = COMANDOS_DO_AGENTE.find((c) => palavrasDe(c).every((p, i) => args[i] === p));
    if (!comando)
      throw new ErroDeUso(args.length === 0 ? "falta o comando" : `comando desconhecido: ${args.join(" ")}`);
    const entrada = entradaDe(comando, args.slice(palavrasDe(comando).length));
    const resultado = await comando.executar(entrada, criarApiDoAgente(deps.env, deps.fetch), deps.stdin);
    deps.stdout.write(`${JSON.stringify(resultado)}\n`);
    return 0;
  } catch (error_) {
    if (error_ instanceof ErroDeUso) {
      deps.stderr.write(`${error_.message}\n\n${ajuda(args[0])}`);
      return 2;
    }
    deps.stderr.write(`${mensagem(error_)}\n`);
    return error_ instanceof ErroDoComando ? error_.codigo : 1;
  }
}

// O arquivo empacotado roda `principal` ao ser executado; importado por um teste, não faz nada.
/* node:coverage ignore next 9 */
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await principal(process.argv.slice(2), {
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch,
  });
}
