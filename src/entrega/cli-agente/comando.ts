// O contrato de um comando do cliente do agente e o apoio que os comandos dividem: o erro de uso, o erro do comando e a
// leitura do JSON de uma opção. O cliente só fala com a API; a regra é do serviço, que o comando só chama.
import { readFileSync } from "node:fs";
import { text } from "node:stream/consumers";
import type { ParseArgsConfig } from "node:util";

/** Comando ou opção desconhecida, argumento faltando ou malformado: código 2 e a ajuda do grupo. */
export class ErroDeUso extends Error {}

/** A falha do comando (recusa da API, Fabriquinha fora, arquivo ilegível): uma linha no stderr e o código de saída. */
export class ErroDoComando extends Error {
  readonly codigo: 1 | 2;
  constructor(mensagem: string, codigo: 1 | 2 = 1) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** O texto de qualquer coisa lançada: um `throw` que não é `Error` também vira falha, nunca sucesso. */
export const mensagem = (erro: unknown): string => (erro instanceof Error ? erro.message : String(erro));

/** O problema e, entre parênteses, como resolver, no formato das mensagens da Fabriquinha. */
export const frase = (problema: string, solucao: string): string => `${problema} (${solucao})`;

/** Os argumentos de um comando já lidos por `parseArgs`: as posições e as opções. */
export interface EntradaDoComando {
  readonly posicionais: readonly string[];
  readonly opcoes: Readonly<Record<string, string | string[] | undefined>>;
}

/** Os dois verbos da API do agente: devolvem o JSON da resposta 200 ou lançam `ErroDoComando`. */
export interface ApiDoAgente {
  get(caminho: string): Promise<unknown>;
  post(caminho: string, corpo: unknown): Promise<unknown>;
}

/** O que o processo entrega ao cliente: o ambiente, os fluxos e o `fetch`. */
export interface DepsDoCliente {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(texto: string): unknown };
  readonly stderr: { write(texto: string): unknown };
  readonly fetch: typeof fetch;
}

/**
 * Um comando do agente: `nome` são as palavras que o chamam (`demanda ver`), `posicionais` os nomes dos argumentos de
 * posição (para o "falta" e o uso), `opcoesDeUso` o trecho de opções do uso e `argumentos` o que o `parseArgs` lê.
 */
export interface Comando {
  readonly nome: string;
  readonly posicionais: readonly string[];
  readonly opcoesDeUso?: string;
  readonly argumentos: ParseArgsConfig;
  executar(entrada: EntradaDoComando, api: ApiDoAgente, stdin: NodeJS.ReadableStream): Promise<unknown>;
}

/**
 * O JSON de um arquivo, ou do stdin com `-`. Com `opcao`, `valor` é o próprio JSON da opção (ou `-`) e o erro cita a opção.
 */
export async function lerJsonDoArquivo(valor: string, stdin: NodeJS.ReadableStream, opcao?: string): Promise<unknown> {
  try {
    if (valor === "-") return JSON.parse(await text(stdin));
    return JSON.parse(opcao === undefined ? readFileSync(valor, "utf8") : valor);
  } catch (error_) {
    throw new ErroDoComando(
      opcao === undefined
        ? frase(`${valor} não é um JSON válido: ${mensagem(error_)}`, "corrija o arquivo de dados")
        : frase(`${opcao} não é um JSON válido: ${mensagem(error_)}`, `passe ${opcao} <json|->`),
    );
  }
}
