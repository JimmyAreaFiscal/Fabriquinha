// O fluxo da recuperação depois do reinício do serviço (MELHORIAS §5.3), entre os domínios, depois de a montagem da gestão
// de Ambientes conferir as sandboxes com o docker (elimina as órfãs pelo rótulo e limpa as que o reinício deixou alocadas,
// matando o que rodava nelas): a montagem de Sessões mata o grupo do harness de cada execução aberta no Ambiente do
// serviço e encerra essas execuções; e o Ciclo de Vida falha como "serviço reiniciado" os tickets que ficaram sem processo
// (o ciclo seguinte do Despacho os retoma). A composição o chama na subida, antes de o web aceitar pedidos e de o agendador ligar.
import type { DatabaseSync } from "node:sqlite";
import {
  falharTicketEmExecucao,
  type RecuperacaoDaSubida,
  recuperacaoDosTicketsNaSubida,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import {
  type MontagemDasSessoesDeAgente,
  montarSessoesDeAgente,
  type SessoesDeAgente,
} from "../../../modulos/sessoes/publico.ts";

/** O que a subida recupera além dos processos dos tickets: o motor falha o ticket que ficou sem processo. */
const recuperacaoDaSubida: RecuperacaoDaSubida = { falharTicket: falharTicketEmExecucao };

/** A recuperação da subida, com as Sessões montadas pela `montagem`. A falha ao recuperar os processos sobe a quem chama. */
export async function recuperarAposReinicio(
  banco: DatabaseSync,
  montagem: Omit<MontagemDasSessoesDeAgente, "banco"> = {},
): Promise<SessoesDeAgente> {
  const tickets = recuperacaoDosTicketsNaSubida(banco, recuperacaoDaSubida);
  const sessoes = await montarSessoesDeAgente({ ...montagem, banco, subida: tickets });
  tickets.falharTicketsPresos();
  return sessoes;
}
