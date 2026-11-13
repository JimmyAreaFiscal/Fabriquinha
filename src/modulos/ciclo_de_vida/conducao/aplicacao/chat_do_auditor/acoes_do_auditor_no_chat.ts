// O que o Auditor faz na sessão de um ticket pelo chat, além de mandar mensagem (mensagem_do_auditor.ts): responder o
// diálogo aberto pelo agente e abortar a execução em andamento.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { contextoDaSessao, montarSessoesDeAgente, type RespostaAoDialogo } from "../../../../sessoes/publico.ts";
import { interromperExecucaoDemanda } from "../execucao/execucao_demanda.ts";
import { carregarSessaoDoTicket, execucaoDaSessao } from "./sessao_do_ticket.ts";

/** Responde o diálogo `dialogo` do agente; `false` se o id não é de uma sessão da demanda. */
export function responderDialogoDemanda(
  banco: DatabaseSync,
  id: string,
  dialogo: string,
  resposta: RespostaAoDialogo,
): boolean {
  const ref = contextoDaSessao(banco, id);
  if (!ref) return false;
  montarSessoesDeAgente({ banco }).responder(
    execucaoDaSessao(carregarSessaoDoTicket(banco, ref, id)).id,
    dialogo,
    resposta,
  );
  return true;
}

/** Aborta a execução em andamento (pi vivo: `abort`; aberta sem pi: interrupção); `false` se o id não é da demanda. */
export function abortarDemanda(banco: DatabaseSync, id: string): boolean {
  const ref = contextoDaSessao(banco, id);
  if (!ref) return false;
  const ultima = execucaoDaSessao(carregarSessaoDoTicket(banco, ref, id));
  const sessoes = montarSessoesDeAgente({ banco });
  if (sessoes.listar({ sessoes: [id] })[0]?.situacao) sessoes.abortar(ultima.id);
  else if (ultima.fim == null) interromperExecucaoDemanda(banco, ref);
  else throw new ErroDeRegra("não há execução para abortar", "a sessão não está rodando");
  return true;
}
