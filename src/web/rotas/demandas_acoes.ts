// Ações do Auditor sobre as demandas (comparacao-sdlc §9.1): os gates (demanda, planejamento, PR da rodada) e a sessão
// de ajustes. Cada rota valida o corpo, chama o serviço da aplicação como AUDITOR e devolve o erro dele como está.
import { z } from "zod";
import { AUDITOR } from "../../dominio/agregado.ts";
import { interpretarRef } from "../../dominio/demanda.ts";
import { reabrirTicket } from "../../dominio/transicoes_demanda.ts";
import { ErroDeRegra, existe } from "../../dominio/erros.ts";
import { aprovarPRRodada } from "../../execucao/aprovacao_pr_rodada.ts";
import type { RefRodada } from "../../execucao/encerramento_rodada.ts";
import { arquivar, cancelar, decidir } from "../../execucao/gestao_demandas.ts";
import { aprovarPlanejamentoDemanda, reprovarPlanejamentoDemanda } from "../../execucao/planejamento.ts";
import { concluirSessaoAjustes, reprovarPRRodada } from "../../execucao/sessao_ajustes.ts";
import { comDemanda } from "../../persistencia/demandas.ts";
import { configuracao } from "../../persistencia/servico.ts";
import type { Pedido, Rota } from "../rotas.ts";

const NOTA = "a nota vai de 1 a 5";
const Nota = z.number({ error: NOTA }).int(NOTA).min(1, NOTA).max(5, NOTA);
const Motivo = (de: string) =>
  z
    .string({ error: `informe o motivo ${de}` })
    .trim()
    .min(1, `informe o motivo ${de}`);

/** Aprovar (com nota, quando o gate a aceita) ou reprovar (com motivo e, no PR, sem nota). */
const Decisao = z.object({ aprovado: z.boolean(), nota: Nota.optional(), motivo: z.string().optional() });
const DecisaoDoPlanejamento = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), nota: Nota.optional() }),
  z.object({ aprovado: z.literal(false), motivo: Motivo("da reprovação do planejamento") }),
]);
const DecisaoDoPR = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), nota: Nota }),
  z.object({
    aprovado: z.literal(false),
    motivo: Motivo("da reprovação do PR"),
    nota: z.never({ error: "a reprovação não leva nota" }).optional(),
  }),
]);

const agora = () => ({ agora: new Date().toISOString() });

/** O `:ref` do caminho como rodada (`I-206.R2`). */
function refDaRodada({ params }: Pedido): RefRodada {
  const ref = interpretarRef(String(params.ref));
  if (!("rodada_id" in ref))
    throw new ErroDeRegra(`${String(params.ref)} não é uma rodada`, "use o endereço da rodada, como I-206.R2");
  return ref;
}

const limite = (pedido: Pedido) => ({ limiteMin: configuracao(pedido.banco).timeoutMin });

function decisaoDaDemanda({ banco, params, corpo }: Pedido) {
  return decidir(banco, String(params.id), Decisao.parse(corpo), AUDITOR, agora());
}

async function decisaoDoPlanejamento({ banco, params, corpo }: Pedido) {
  const id = String(params.id);
  const decisao = DecisaoDoPlanejamento.parse(corpo);
  return decisao.aprovado
    ? aprovarPlanejamentoDemanda(banco, id, { nota: decisao.nota })
    : reprovarPlanejamentoDemanda(banco, id, decisao.motivo);
}

async function decisaoDoPR(pedido: Pedido) {
  const ref = refDaRodada(pedido);
  const decisao = DecisaoDoPR.parse(pedido.corpo);
  if (decisao.aprovado) return aprovarPRRodada(pedido.banco, ref, decisao.nota, AUDITOR);
  const { id } = await reprovarPRRodada(pedido.banco, ref, decisao.motivo, AUDITOR, limite(pedido));
  return { sessao: id };
}

const concluir = (pedido: Pedido) => concluirSessaoAjustes(pedido.banco, refDaRodada(pedido), AUDITOR);

/** O `:ref` do caminho como ticket (`I-206.T3`). */
function refDoTicket({ params }: Pedido) {
  const ref = interpretarRef(String(params.ref));
  if (!("ticket_id" in ref))
    throw new ErroDeRegra(`${String(params.ref)} não é um ticket`, "use o endereço do ticket, como I-206.T3");
  return ref;
}

const Reabertura = z.object({ instrucao: Motivo("da reabertura, como instrução para o ticket") });

function reabrir(pedido: Pedido) {
  const { demanda_id, ticket_id } = refDoTicket(pedido);
  const { instrucao } = Reabertura.parse(pedido.corpo);
  const ag = comDemanda(pedido.banco, demanda_id, (d) => reabrirTicket(d, { ticket_id, instrucao }, AUDITOR, agora()));
  return {
    ticket: existe(
      ag.tickets.find((t) => t.ticket_id === ticket_id),
      "ticket não encontrado",
      "confira o endereço",
    ),
  };
}

async function executar(pedido: Pedido): Promise<void> {
  const { agendador } = pedido;
  if (!agendador.executarAgoraDemanda)
    throw new ErroDeRegra(
      "o agendador não executa tickets de demanda",
      "suba a Fabriquinha com o serviço (fabriquinha servir)",
    );
  await agendador.executarAgoraDemanda(refDoTicket(pedido));
}

const cancelamento = ({ banco, params }: Pedido) => cancelar(banco, String(params.id), AUDITOR, agora());
const arquivamento = ({ banco, params }: Pedido) => ({
  demanda: arquivar(banco, String(params.id), AUDITOR, agora()),
});

export const ROTAS_DAS_ACOES_DE_DEMANDA: Rota[] = [
  { metodo: "POST", caminho: "/api/demandas/:id/decisao", tratar: decisaoDaDemanda },
  { metodo: "POST", caminho: "/api/demandas/:id/planejamento/decisao", tratar: decisaoDoPlanejamento },
  { metodo: "POST", caminho: "/api/demandas/rodadas/:ref/pr", tratar: decisaoDoPR },
  { metodo: "POST", caminho: "/api/demandas/rodadas/:ref/ajustes/concluir", tratar: concluir },
  { metodo: "POST", caminho: "/api/demandas/tickets/:ref/reabrir", tratar: reabrir },
  { metodo: "POST", caminho: "/api/demandas/tickets/:ref/executar", tratar: executar },
  { metodo: "POST", caminho: "/api/demandas/:id/cancelar", tratar: cancelamento },
  { metodo: "POST", caminho: "/api/demandas/:id/arquivar", tratar: arquivamento },
];
