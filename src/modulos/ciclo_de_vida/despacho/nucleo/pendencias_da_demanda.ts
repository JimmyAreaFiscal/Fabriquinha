// As Pendências da demanda (CONCEITOS.md §11) com o despacho parado: a única regra que decide o que aguarda o Auditor. O
// que o estado do desenvolvimento segura vem do Processo; o ticket aberto e elegível com o agendador desligado é a regra
// do Despacho, que o seleciona como o agendador o selecionaria.
import { Endereco } from "../../etapas/publico.ts";
import {
  type ResumoDaDemanda,
  type Pendencia,
  pendenciasDoProcesso,
  type PullRequestDoEspaco,
  type TrabalhoVivo,
} from "../../processo/publico.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { Despacho, prontosParaExecutarAgora, situacaoDeUmaDemanda } from "./despacho.ts";

/**
 * Tudo o que a demanda tem parado esperando o Auditor: as Pendências do Processo e, por último, os despachos parados.
 * Quem junta as demandas ordena por `desde`. `predecessorasSatisfeitas` falso é Dependência: o ticket não é elegível e
 * nada é Pendência.
 */
export function pendenciasDaDemanda(
  ag: ResumoDaDemanda,
  vivos: readonly TrabalhoVivo[],
  prs: readonly PullRequestDoEspaco[],
  agendadorLigado: boolean,
  {
    agora = relogioDoSistema.agora(),
    predecessorasSatisfeitas = true,
  }: { agora?: Instante; predecessorasSatisfeitas?: boolean } = {},
): Pendencia[] {
  const pendencias = pendenciasDoProcesso(ag, vivos, prs, agora);
  if (agendadorLigado) return pendencias;
  const selecao = new Despacho().selecionar(situacaoDeUmaDemanda(ag, predecessorasSatisfeitas));
  return [
    ...pendencias,
    ...prontosParaExecutarAgora(selecao).map((t): Pendencia => ({
      tipo: "despacho_parado",
      item: Endereco.doTicket(ag.demanda.id, t.ticket_id),
      motivo: "Ticket aberto e elegível, com o agendador desligado",
      acao_esperada: "executar",
      desde: t.estado_alterado_em,
    })),
  ];
}
