// Onde o agente de uma execução age (comparacao-sdlc-implementacao.md §6): da identidade do processo vêm o Ator, a sessão, o
// ticket composto e o projeto. Os casos de uso do agente conferem aqui que a execução segue aberta e que o endereço pedido
// é o do próprio ticket ou da própria demanda; ninguém além do próprio agente lê ou escreve.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/agregado_demanda.ts";
import type { Ator } from "../../nucleo/ator.ts";
import { formatarTicketRef } from "../../nucleo/demanda.ts";
import { encontrado, ErroDeEscopo, ErroDeRegra, existe } from "../../nucleo/erros.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import type { ProcessoDoTrabalho } from "../../nucleo/trabalho_agentico.ts";
import { carregarEscopoDoProcesso } from "../../armazenamento/demandas.ts";
import { exigirTrabalhoDoTicket } from "../trabalho_do_ticket.ts";

/** A identidade do processo que age: o `id` basta, e o `ProcessoDoTrabalho` inteiro também serve. */
export type ProcessoDoAgente = Pick<ProcessoDoTrabalho, "id">;

/** Onde um agente age: o Ator que ele é (`trabalho_id` é o id de `processo_do_trabalho`), a sessão e o ticket composto que ele roda. */
export interface EscopoDoAgente {
  readonly ator: Extract<Ator, { tipo: "agente" }>;
  readonly sessao: string;
  readonly demanda_id: string;
  readonly ticket_id: number;
  readonly projeto: string;
}

/** Lê o JSON de um valor de opção (um arquivo, ou o stdin com `-`); `opcao` é a opção que o erro cita. */
export type LeitorDeJson = (valor: string, opcao?: string) => Promise<unknown>;

/**
 * O escopo do agente de `execucao`, ou `undefined` se ela não está em `processo_do_trabalho`; terminada é ErroDeEscopo.
 * @testes o CLI do agente passa a usá-lo ao trocar os comandos; hoje só os casos de uso e o teste o chamam
 */
export function resolverEscopoDoAgente(banco: DatabaseSync, execucao: string): EscopoDoAgente | undefined {
  const linha = carregarEscopoDoProcesso(banco, execucao);
  if (!linha) return undefined;
  if (linha.fim !== null) {
    throw new ErroDeEscopo(`a execução ${execucao} já terminou`, "peça ao Auditor uma nova execução");
  }
  return {
    ator: { tipo: "agente", trabalho_id: execucao },
    sessao: linha.sessao,
    demanda_id: linha.demanda_id,
    ticket_id: linha.ticket_id,
    projeto: linha.projeto,
  };
}

/** O escopo do agente do `processo`, que existe e segue aberto. */
export function escopoDoProcessoAberto(banco: DatabaseSync, processo: ProcessoDoAgente): EscopoDoAgente {
  return existe(
    resolverEscopoDoAgente(banco, processo.id),
    `a execução ${processo.id} não existe`,
    "confira a execução",
  );
}

/** A reconferência que cada escrita faz dentro da transação: a execução segue aberta e é do ticket do agente. */
export function reconferirExecucao(banco: DatabaseSync, agente: EscopoDoAgente): void {
  escopoDoProcessoAberto(banco, { id: agente.ator.trabalho_id });
  exigirTrabalhoDoTicket(banco, agente.ator, agente);
}

export const enderecoDoTicketDoAgente = (agente: EscopoDoAgente): string => formatarTicketRef(agente);

/** O ticket de `texto`, que só pode ser o do agente; `T-3` e outras formas erram mostrando o endereço certo. */
export function exigirTicketProprio(agente: EscopoDoAgente, texto: string, paraAgir = false): void {
  const proprio = enderecoDoTicketDoAgente(agente);
  const forma = `use o endereço do seu ticket, ${proprio}`;
  let endereco;
  try {
    endereco = Endereco.ler(texto);
  } catch {
    throw new ErroDeRegra(`${texto} não é um endereço de ticket`, forma);
  }
  if (endereco.ticket_id === undefined) throw new ErroDeRegra(`${texto} não é um ticket`, forma);
  if (endereco.toString() !== proprio) {
    throw paraAgir
      ? new ErroDeEscopo("o agente só age no próprio ticket", `aja em ${proprio}`)
      : new ErroDeEscopo("o agente só lê o próprio ticket", `leia ${proprio}`);
  }
}

export function exigirDemandaPropria(agente: EscopoDoAgente, texto: string): void {
  if (texto !== agente.demanda_id) {
    throw new ErroDeEscopo(
      "o agente só lê a própria demanda",
      `leia ${agente.demanda_id}, a do seu ticket ${enderecoDoTicketDoAgente(agente)}`,
    );
  }
}

/** O ticket `ticket_id` do agregado; o que não existe é ErroDeInexistente com o endereço público dele. */
export function exigirTicket(agregado: AgregadoDemanda, ticket_id: number): TicketDemanda {
  return encontrado(
    agregado.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${formatarTicketRef({ demanda_id: agregado.demanda.id, ticket_id })} não existe`,
    "confira a execução",
  );
}
