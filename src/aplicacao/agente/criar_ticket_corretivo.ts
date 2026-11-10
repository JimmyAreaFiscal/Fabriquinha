import type { DatabaseSync } from "node:sqlite";
import { formatarRodadaRef, formatarTicketRef } from "../../nucleo/demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../nucleo/erros.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { type Relogio, relogioDoSistema } from "../../nucleo/relogio.ts";
import { registrarCorrecoesSessao } from "../../nucleo/transicoes_rodada.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { escopoDoProcessoAberto, exigirTicket, type ProcessoDoAgente, reconferirExecucao } from "./escopo.ts";

/**
 * Registra um ticket corretivo na rodada do agente, `rodada` como o `I-<n>.R<m>` dela, e devolve os tickets que nasceram.
 * A descrição repete o título: o agente só dá o título; o Auditor detalha no web.
 */
export function criarTicketCorretivo(
  banco: DatabaseSync,
  processo: ProcessoDoAgente,
  pedido: { readonly rodada: string; readonly titulo: string | undefined },
  relogio: Relogio = relogioDoSistema,
) {
  const agente = escopoDoProcessoAberto(banco, processo);
  const { demanda_id } = agente;
  const { rodada: texto, titulo } = pedido;
  const ticketDoAgente = exigirTicket(carregarDemanda(banco, demanda_id), agente.ticket_id);
  const forma = `use a rodada do seu ticket, ${formatarRodadaRef({ demanda_id, rodada_id: Number(ticketDoAgente.rodada_id) })}`;
  let endereco;
  try {
    endereco = Endereco.ler(texto);
  } catch {
    throw new ErroDeRegra(`${texto} não é um endereço de rodada`, forma);
  }
  if (endereco.rodada_id === undefined) throw new ErroDeRegra(`${texto} não é uma rodada`, forma);
  if (endereco.demanda_id !== demanda_id) throw new ErroDeEscopo(`${texto} é de outra demanda`, forma);
  if (titulo === undefined) throw new ErroDeRegra("falta o título do ticket corretivo", "passe --titulo <texto>");
  const { rodada_id } = endereco;
  const ticketsAntes = new Set(carregarDemanda(banco, demanda_id).tickets.map((t) => t.ticket_id));
  const depois = comDemanda(banco, demanda_id, (agregado) => {
    reconferirExecucao(banco, agente);
    return registrarCorrecoesSessao(
      agregado,
      {
        demanda_id,
        rodada_id,
        ticket_id: agente.ticket_id,
        correcoes: [{ demanda_id, rodada_id, ticket_id: 1, titulo, descricao: titulo }],
      },
      agente.ator,
      { agora: relogio.agora() },
    );
  });
  const novos = depois.tickets.filter((t) => !ticketsAntes.has(t.ticket_id));
  return { rodada: texto, tickets: novos.map((t) => formatarTicketRef(t)) };
}
