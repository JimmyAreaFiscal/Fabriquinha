// Ações do Auditor sobre as demandas (comparacao-sdlc §9.1): os gates (demanda, planejamento, PR da rodada) e a sessão
// de ajustes. Cada rota valida o corpo, chama o serviço da aplicação como AUDITOR e devolve o erro dele como está.
import { z } from "zod";
import { AUDITOR } from "../../../nucleo/ator.ts";
import { reabrirTicket } from "../../../nucleo/transicoes_demanda.ts";
import { ErroDeRegra, existe } from "../../../nucleo/erros.ts";
import { Endereco } from "../../../nucleo/item_de_trabalho.ts";
import type { RefRodada } from "../../../aplicacao/encerramento_rodada.ts";
import { decidirGate } from "../../../aplicacao/gates/decidir_gate.ts";
import { arquivar, cancelar } from "../../../aplicacao/gestao_demandas.ts";
import { concluirSessaoAjustes } from "../../../aplicacao/sessao_ajustes.ts";
import { comDemanda } from "../../../armazenamento/demandas.ts";
import type { Pedido, Rota } from "../rotas.ts";

const Motivo = (de: string) =>
  z
    .string({ error: `informe o motivo ${de}` })
    .trim()
    .min(1, `informe o motivo ${de}`);

const agora = () => ({ agora: new Date().toISOString() });

/** O `:ref` do caminho como rodada (`I-206.R2`). */
function refDaRodada({ params }: Pedido): RefRodada {
  const { demanda_id, rodada_id } = Endereco.ler(String(params.ref));
  if (rodada_id === undefined)
    throw new ErroDeRegra(`${String(params.ref)} não é uma rodada`, "use o endereço da rodada, como I-206.R2");
  return { demanda_id, rodada_id };
}

/** O corpo é a entrada do gate (`resultado`, `nota` e `motivo`): quem valida é o gate. */
async function decisaoDaDemanda({ banco, params, corpo }: Pedido) {
  const { demanda, canceladas } = await decidirGate(
    banco,
    "gate_demanda",
    Endereco.daDemanda(String(params.id)),
    corpo,
    AUDITOR,
  );
  return { demanda, canceladas };
}

async function decisaoDoPlanejamento({ banco, params, corpo }: Pedido) {
  const { demanda } = await decidirGate(
    banco,
    "gate_planejamento",
    Endereco.daDemanda(String(params.id)),
    corpo,
    AUDITOR,
  );
  return demanda;
}

async function decisaoDoPR(pedido: Pedido) {
  const { demanda_id, rodada_id } = refDaRodada(pedido);
  const { demanda, sessao } = await decidirGate(
    pedido.banco,
    "gate_pr",
    Endereco.daRodada(demanda_id, rodada_id),
    pedido.corpo,
    AUDITOR,
  );
  return sessao === undefined ? demanda : { sessao };
}

const concluir = (pedido: Pedido) => concluirSessaoAjustes(pedido.banco, refDaRodada(pedido), AUDITOR);

/** O `:ref` do caminho como ticket (`I-206.T3`). */
function refDoTicket({ params }: Pedido) {
  const { demanda_id, ticket_id } = Endereco.ler(String(params.ref));
  if (ticket_id === undefined)
    throw new ErroDeRegra(`${String(params.ref)} não é um ticket`, "use o endereço do ticket, como I-206.T3");
  return { demanda_id, ticket_id };
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
