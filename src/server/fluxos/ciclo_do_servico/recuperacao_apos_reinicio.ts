// O fluxo da recuperação depois do reinício do serviço (MELHORIAS §5.3), entre todos os domínios, nesta ordem: o Ambiente
// confere as sandboxes com o docker (elimina as órfãs pelo rótulo e limpa as que o reinício deixou alocadas, matando o que
// rodava nelas); Sessões mata o grupo do harness de cada execução aberta pelo Ambiente gravado nela; e o Ciclo de Vida
// encerra essas execuções e falha como "serviço reiniciado" os tickets que ficaram sem processo (o ciclo seguinte do
// Despacho os retoma). A composição o chama na subida, antes de o web aceitar pedidos e de o agendador ligar.
import type { DatabaseSync } from "node:sqlite";
import type { ConjuntoDeAmbientes } from "../../../modulos/ambiente/publico.ts";
import { condutor, falharTicketEmExecucao, type RecuperacaoDaSubida } from "../../../modulos/ciclo_de_vida/publico.ts";

/**
 * O que a subida recupera além dos processos dos tickets: o motor falha o ticket que ficou sem processo.
 * @testes os testes e o e2e recuperam a subida como o serviço, sem subi-lo
 */
export const recuperacaoDaSubida: RecuperacaoDaSubida = { falharTicket: falharTicketEmExecucao };

/**
 * A recuperação da subida. O conjunto de sandboxes fora do ar não impede o serviço de subir: o erro vai a
 * `registrarErro`, e a conferência dele fica para a próxima subida. A falha ao recuperar os processos sobe a quem chama.
 */
export async function recuperarAposReinicio(
  banco: DatabaseSync,
  conjuntoDeSandboxes: ConjuntoDeAmbientes | undefined,
  registrarErro: (erro: unknown) => void,
): Promise<void> {
  await conjuntoDeSandboxes?.reconciliarNaSubida().catch(registrarErro);
  condutor.recuperarNaSubida(banco, recuperacaoDaSubida);
}
