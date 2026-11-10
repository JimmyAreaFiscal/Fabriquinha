// O contrato de um comando do CLI e o apoio que os comandos dividem: ler o JSON de uma opção, o schema JSON de um tipo
// de evidência e o ticket do agregado. O comando só traduz os argumentos; a regra é da aplicação.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import type { ParseArgsConfig } from "node:util";
import { z } from "zod";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import { formatarTicketRef } from "../../nucleo/demanda.ts";
import { encontrado, ErroDeRegra, mensagem } from "../../nucleo/erros.ts";
import { schemaDoTipo, type TipoEvidencia } from "../../nucleo/evidencia.ts";

/** Os argumentos de um comando já lidos por `parseArgs`: as posições e as opções. @testes a troca dos comandos o usa; hoje só o teste o monta */
export interface EntradaDoComando {
  readonly posicionais: readonly string[];
  readonly opcoes: Readonly<Record<string, string | string[] | undefined>>;
}

/** O que o processo entrega a um comando: o banco aberto pela composição, o ambiente e o stdin. @testes a troca dos comandos o usa; hoje só o teste o monta */
export interface DepsDoCli {
  readonly banco: DatabaseSync;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
}

/** @testes a troca dos comandos pelas listas de `Comando` o usa; hoje só o teste o monta */
export interface Comando {
  readonly nome: string;
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

/** O ticket `ticket_id` do agregado; o que não existe é ErroDeInexistente com o endereço público dele. */
export function exigirTicket(agregado: AgregadoDemanda, ticket_id: number): TicketDemanda {
  return encontrado(
    agregado.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${formatarTicketRef({ demanda_id: agregado.demanda.id, ticket_id })} não existe`,
    "confira a execução",
  );
}
