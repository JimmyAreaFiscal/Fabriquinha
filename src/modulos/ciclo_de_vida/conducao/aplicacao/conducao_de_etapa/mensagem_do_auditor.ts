// A mensagem do Auditor à sessão de um ticket, pelo chat (comparacao-sdlc-implementacao.md §9.1): a sessão rodando a
// recebe redirecionada ou enfileirada, a parada em conversa a recebe como prompt e volta a rodar. A sessão de ajustes do
// PR reprovado volta pelo caminho dela, que restaura as branches no fim; as outras, pela execução da demanda.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { type Relogio, relogioDoSistema } from "../../../../../shared/nucleo/relogio.ts";
import { formatarTicketRef, etapaDoPapel } from "../../../etapas/publico.ts";
import { configuracao } from "../../../../compartilhado/armazenamento/servico.ts";
import { contextoDaSessao } from "../../../../sessoes/publico.ts";
import { condutor } from "../politica_dos_agentes/condutor.ts";
import { iniciarExecucaoDemanda } from "../execucao/execucao_demanda.ts";
import {
  carregarSessaoDoTicket,
  estadoEDesdeDaSessao,
  execucaoDaSessao,
  pendenciaDaSessao,
} from "../chat_do_auditor/sessao_do_ticket.ts";
import { retomarSessaoAjustes } from "../ajustar_resultado/sessao_ajustes.ts";

/** Como a mensagem do Auditor chega ao pi: nova, redirecionando ou enfileirada. */
type ModoEnvio = "prompt" | "steer" | "follow_up";

/** Envia a mensagem do Auditor; `false` se o id não é de uma sessão da demanda. */
export function enviarDemanda(
  banco: DatabaseSync,
  id: string,
  texto: string,
  modo: ModoEnvio,
  limiteMin = configuracao(banco).ociosidadeMin,
  relogio: Relogio = relogioDoSistema,
): boolean {
  const ref = contextoDaSessao(banco, id);
  if (!ref) return false;
  const c = carregarSessaoDoTicket(banco, ref, id);
  const viva = condutor.situacao(id);
  const estadoEDesde = estadoEDesdeDaSessao(c, viva);
  const [estado] = estadoEDesde;
  const tipoDaPendencia = pendenciaDaSessao(c, viva, estadoEDesde, relogio)?.tipo;
  const rotulo = tipoDaPendencia ? `${estado}: ${tipoDaPendencia}` : estado;
  // Diálogo aberto só se responde; sem ele, a Pendência do ticket é a conversa.
  const emConversa = tipoDaPendencia === "dialogo_do_agente" && !viva?.dialogos.length;
  const aceitos: ModoEnvio[] = estado === "rodando" ? ["steer", "follow_up"] : emConversa ? ["prompt"] : [];
  if (!aceitos.includes(modo)) {
    throw new ErroDeRegra(
      `a sessão de ${formatarTicketRef(c.ticket)} está ${rotulo} e não recebe ${modo}`,
      aceitos.length > 0 ? `envie com ${aceitos.join(" ou ")}` : SEM_MENSAGEM[tipoDaPendencia ?? estado],
    );
  }
  // Em conversa, o pi vivo está ocioso. A sessão de ajustes retoma pelo caminho dela, que restaura as branches no fim.
  if (estado === "rodando" || viva) condutor.mandar(execucaoDaSessao(c).id, { type: modo, message: texto });
  else if (c.ticket.etapa === etapaDoPapel("ajusta_o_pr_reprovado"))
    retomarSessaoAjustes(banco, c.ticket, texto, { limiteMin });
  else iniciarExecucaoDemanda(banco, ref, { limiteMin, modo: "interativo", mensagem: texto }, relogio);
  return true;
}

const SEM_MENSAGEM: Record<string, string> = {
  dialogo_do_agente: "responda o diálogo aberto pelo agente",
  item_bloqueado: "reabra o ticket na página da demanda",
  gate_humano: "decida o gate na página da demanda",
  terminada: "a sessão é só leitura",
};
