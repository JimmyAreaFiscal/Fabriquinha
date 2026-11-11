// O contrato de um comando do CLI e o apoio que os comandos dividem: ler o JSON de uma opção e o schema JSON de um tipo
// de evidência. O comando só traduz os argumentos; a regra é da aplicação.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import type { ParseArgsConfig } from "node:util";
import { z } from "zod";
import { ErroDeRegra, mensagem } from "../../compartilhado/nucleo/erros.ts";
import { schemaDoTipo } from "../../sdlc/nucleo/evidencias/evidencia.ts";
import { type TipoEvidencia } from "../../etapas/definicao/tipos_declaraveis.ts";
import type { Relogio } from "../../compartilhado/nucleo/relogio.ts";

/** Comando ou opção desconhecida, argumento faltando ou malformado: código 2 e a ajuda do grupo (F7 §3.3). */
export class ErroDeUso extends Error {}

/** Os argumentos de um comando já lidos por `parseArgs`: as posições e as opções. */
export interface EntradaDoComando {
  readonly posicionais: readonly string[];
  readonly opcoes: Readonly<Record<string, string | string[] | undefined>>;
}

/** O serviço que o `servidor` sobe: a porta em que atende e como pará-lo. */
interface ServicoEmExecucao {
  readonly porta: number;
  parar(): Promise<void>;
}

/** O que o processo entrega a um comando: o ambiente, os fluxos e o que só a composição sabe abrir (banco, serviço, navegador). */
export interface DepsDoCli {
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: { write(texto: string): unknown };
  readonly stderr: { write(texto: string): unknown };
  /** A raiz da Fabriquinha (`$FABRIQUINHA_ROOT` ou a padrão). */
  readonly raiz: string;
  /** A hora dos comandos que gravam. */
  readonly relogio: Relogio;
  /** O banco da raiz para um comando, desligado no fim. */
  comBanco<T>(usar: (banco: DatabaseSync) => T | Promise<T>): Promise<T>;
  iniciarServico(): Promise<ServicoEmExecucao>;
  abrirNoNavegador(url: string): Promise<void>;
  /** Resolve quando o `servidor` deve parar (SIGINT ou SIGTERM). */
  parada(): Promise<unknown>;
  /** Encerra o processo depois da parada do `servidor`: o que sobrar vivo (timers, filhos) não o segura. */
  sair?(): void;
}

/**
 * Um comando do CLI: `nome` são as palavras que o chamam (`demanda ver`), `posicionais` os nomes dos argumentos de posição
 * (para o "falta" e o uso), `opcoesDeUso` o trecho de opções do uso e `argumentos` o que o `parseArgs` lê.
 */
export interface Comando {
  readonly nome: string;
  readonly posicionais: readonly string[];
  readonly opcoesDeUso?: string;
  readonly argumentos: ParseArgsConfig;
  executar(entrada: EntradaDoComando, deps: DepsDoCli): Promise<unknown>;
}

/**
 * O JSON de um arquivo, ou do stdin com `-`. Com `opcao`, `valor` é o próprio JSON da opção (ou `-`) e o erro cita a opção.
 */
export async function lerJsonDoArquivo(valor: string, stdin: NodeJS.ReadableStream, opcao?: string): Promise<unknown> {
  try {
    if (valor === "-") return JSON.parse(await text(stdin));
    return JSON.parse(opcao === undefined ? readFileSync(valor, "utf8") : valor);
  } catch (error_) {
    throw opcao === undefined
      ? new ErroDeRegra(`${valor} não é um JSON válido: ${mensagem(error_)}`, "corrija o arquivo de dados")
      : new ErroDeRegra(`${opcao} não é um JSON válido: ${mensagem(error_)}`, `passe ${opcao} <json|->`);
  }
}

/** O schema JSON dos dados que o tipo de evidência aceita, como o `evidencia schema` o mostra, e a regra dos arquivos. */
export function schemaJsonDoTipo(tipo: TipoEvidencia) {
  const { dados, arquivos } = schemaDoTipo(tipo);
  return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
}
