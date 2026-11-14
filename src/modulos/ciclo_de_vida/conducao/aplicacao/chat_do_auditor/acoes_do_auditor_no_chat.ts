// O que o Auditor faz na sessão de um ticket pelo chat, além de mandar mensagem (mensagem_do_auditor.ts): responder o
// diálogo aberto pelo agente e abortar a execução em andamento.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { montarSessoesDeAgente, type RespostaAoDialogo } from "../../../../sessoes/publico.ts";
import { interromperExecucaoDemanda } from "../execucao/execucao_demanda.ts";
import { carregarSessaoDoTicket, execucaoDaSessao } from "./sessao_do_ticket.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";

/** O ticket da sessão `id`, ou `undefined` se o id não é de uma sessão. */
export function ticketDaSessao(banco: DatabaseSync, id: string): { demanda_id: string; ticket_id: number } | undefined {
  const [resumo] = montarSessoesDeAgente({ banco }).listar({ sessoes: [id] });
  return resumo && { demanda_id: resumo.demanda_id, ticket_id: resumo.ticket_id };
}

/** Responde o diálogo `dialogo` do agente; `false` se o id não é de uma sessão da demanda. */
export function responderDialogoDemanda(
  banco: DatabaseSync,
  id: string,
  dialogo: string,
  resposta: RespostaAoDialogo,
): boolean {
  const ref = ticketDaSessao(banco, id);
  if (!ref) return false;
  montarSessoesDeAgente({ banco }).responder(
    execucaoDaSessao(carregarSessaoDoTicket(banco, ref, id)).id,
    dialogo,
    resposta,
  );
  return true;
}

/** Aborta a execução em andamento (pi vivo: `abort`; aberta sem pi: interrupção); `false` se o id não é da demanda. */
export function abortarDemanda(modulos: Pick<ModulosDoCiclo, "banco" | "ambientes" | "sessoes">, id: string): boolean {
  const { banco, sessoes } = modulos;
  const ref = ticketDaSessao(banco, id);
  if (!ref) return false;
  const ultima = execucaoDaSessao(carregarSessaoDoTicket(banco, ref, id));
  if (sessoes.listar({ sessoes: [id] })[0]?.situacao) sessoes.abortar(ultima.id);
  else if (ultima.fim == null) interromperExecucaoDemanda(modulos, ref);
  else throw new ErroDeRegra("não há execução para abortar", "a sessão não está rodando");
  return true;
}
