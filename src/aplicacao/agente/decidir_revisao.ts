import type { DatabaseSync } from "node:sqlite";
import { formatarRodadaRef } from "../../nucleo/demanda.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { carregarDemanda } from "../../armazenamento/demandas.ts";
import { decidirGate } from "../gates/decidir_gate.ts";
import {
  enderecoDoTicketDoAgente,
  escopoDoProcessoAberto,
  exigirTicket,
  exigirTicketProprio,
  type LeitorDeJson,
  type ProcessoDoAgente,
  reconferirExecucao,
} from "./escopo.ts";

/** O veredito do agente sobre o próprio ticket de revisão; `correcoes` e `plano` são o valor da opção, que `lerJson` lê. */
interface PedidoDeRevisao {
  readonly ticket: string;
  readonly veredito: string;
  readonly motivo?: string | undefined;
  readonly correcoes?: string | undefined;
  readonly plano?: string | undefined;
}

/** A lista {titulo, descricao} do agente, completada com a demanda, a rodada e o ticket local (1, 2, ...). */
const completarCorrecoes = (lista: unknown, demanda_id: string, rodada_id: number | undefined): unknown =>
  Array.isArray(lista) ? lista.map((c: object, i) => ({ ...c, demanda_id, rodada_id, ticket_id: i + 1 })) : lista;

const exigirOpcao = (valor: string | undefined, opcao: string, veredito: string): string => {
  if (valor === undefined) throw new ErroDeRegra(`${veredito} exige ${opcao}`, `passe ${opcao}`);
  return valor;
};

/**
 * Aprova ou reprova o gate de revisão do próprio ticket do agente (sobre `decidirGate`): a revisão de rodada reprova com
 * `correcoes`, a da demanda com `plano`. Recusa o que não é veredito, ticket de revisão nem a opção certa antes de ler o JSON.
 * @testes o CLI do agente passa a usá-lo ao trocar os comandos; hoje só o teste o chama
 */
export async function decidirRevisao(
  banco: DatabaseSync,
  processo: ProcessoDoAgente,
  pedido: PedidoDeRevisao,
  lerJson: LeitorDeJson,
) {
  const agente = escopoDoProcessoAberto(banco, processo);
  const { veredito, motivo, correcoes, plano } = pedido;
  if (veredito !== "aprovar" && veredito !== "reprovar") {
    throw new ErroDeRegra(`veredito ${JSON.stringify(veredito)} inválido`, "use aprovar ou reprovar");
  }
  exigirTicketProprio(agente, pedido.ticket, true);
  const resultado = veredito === "aprovar" ? "aprovado" : "reprovado";
  const { demanda_id, ticket_id } = agente;
  const ticket = exigirTicket(carregarDemanda(banco, demanda_id), ticket_id);
  const rodada = ticket.rodada_id;
  if (ticket.etapa !== "revisar_rodada" && ticket.etapa !== "revisar_demanda") {
    throw new ErroDeRegra(
      `o ticket ${enderecoDoTicketDoAgente(agente)} é de ${ticket.etapa}, não de revisão`,
      "só ticket de revisão decide",
    );
  }
  const campo = ticket.etapa === "revisar_rodada" ? "correcoes" : "plano";
  let extra: object = {};
  if (resultado === "aprovado") {
    if ([motivo, correcoes, plano].some((v) => v !== undefined)) {
      throw new ErroDeRegra("aprovar não leva --motivo, --correcoes nem --plano", "omita as opções");
    }
  } else {
    const motivoDaReprovacao = exigirOpcao(motivo, "--motivo", "reprovar");
    const jsonDoCampo = exigirOpcao(campo === "correcoes" ? correcoes : plano, `--${campo}`, "reprovar");
    const valor = await lerJson(jsonDoCampo, `--${campo}`);
    extra = {
      motivo: motivoDaReprovacao,
      correcoes: campo === "correcoes" ? completarCorrecoes(valor, demanda_id, rodada) : valor,
    };
  }
  reconferirExecucao(banco, agente); // a execução ainda está aberta? A leitura do JSON pode ter esperado o stdin.
  await (rodada === undefined
    ? decidirGate(banco, "gate_revisao_demanda", Endereco.daDemanda(demanda_id), { resultado, ...extra }, agente.ator)
    : decidirGate(
        banco,
        "gate_revisao_rodada",
        Endereco.daRodada(demanda_id, rodada),
        { resultado, ...extra },
        agente.ator,
      ));
  return {
    ticket: enderecoDoTicketDoAgente(agente),
    ...(rodada !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id: rodada }) }),
    resultado,
  };
}
