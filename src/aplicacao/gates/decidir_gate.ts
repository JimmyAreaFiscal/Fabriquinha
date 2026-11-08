// O único ponto de entrada que decide um gate (comparacao-sdlc-implementacao.md §§3, 4 e 6): a regra é de `GATES`, no
// núcleo; aqui ficam os efeitos fora do agregado (integrar o PR, cancelar em cascata, falar com o pi) de cada gate.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda, NomeGate } from "../../nucleo/agregado_demanda.ts";
import type { Ator } from "../../nucleo/ator.ts";
import { GATES } from "../../nucleo/gate.ts";
import type { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { comDemanda } from "../../armazenamento/demandas.ts";
import { conferirAprovacao } from "../revisao_pendencias.ts";
import { exigirTrabalhoDoTicket } from "../trabalho_do_ticket.ts";
import { cancelandoEmCascata } from "./cancelamento_em_cascata.ts";
import { aprovarGateDoPlanejamento, reprovarGateDoPlanejamento } from "./planejamento.ts";
import { aprovarPR, reprovarPR } from "./pr.ts";

/** A demanda decidida; `canceladas` são as que o gate da demanda levou junto (D08) e `sessao`, a de ajustes do PR reprovado. */
interface ResultadoDoGate {
  demanda: AgregadoDemanda;
  canceladas: string[];
  sessao?: string;
}

const contexto = () => ({ agora: new Date().toISOString() });

/** CA-16 a CA-20: aprovar não cascateia, reprovar cancela a demanda e as dependentes. */
function decidirGateDaDemanda(banco: DatabaseSync, endereco: Endereco, entrada: unknown, ator: Ator): ResultadoDoGate {
  const ctx = contexto();
  return cancelandoEmCascata(banco, endereco.demanda_id, ator, ctx, (ag) =>
    GATES.gate_demanda.decidir(ag, endereco, entrada, ator, ctx),
  );
}

async function decidirGateDoPlanejamento(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
): Promise<ResultadoDoGate> {
  const e = GATES.gate_planejamento.validarEntrada(entrada, ator);
  const demanda =
    e.resultado === "aprovado"
      ? await aprovarGateDoPlanejamento(banco, endereco, e, ator)
      : reprovarGateDoPlanejamento(banco, endereco, e, ator, e.motivo);
  return { demanda, canceladas: [] };
}

async function decidirGateDoPR(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
): Promise<ResultadoDoGate> {
  const e = GATES.gate_pr.validarEntrada(entrada, ator);
  if (e.resultado === "aprovado") return { demanda: await aprovarPR(banco, endereco, e, ator), canceladas: [] };
  return { ...(await reprovarPR(banco, endereco, e, ator, e.motivo)), canceladas: [] };
}

/** A aprovação só passa com as evidências em ordem; a recusa desfaz tudo. O agente só decide o gate do próprio ticket. */
function decidirGateDeRevisao(
  nome: "gate_revisao_rodada" | "gate_revisao_demanda",
): (banco: DatabaseSync, endereco: Endereco, entrada: unknown, ator: Ator) => ResultadoDoGate {
  return (banco, endereco, entrada, ator) => {
    const gate = GATES[nome];
    const { resultado } = gate.validarEntrada(entrada, ator);
    const demanda = comDemanda(banco, endereco.demanda_id, (ag) => {
      const ticket = gate.ancora(ag, endereco);
      exigirTrabalhoDoTicket(banco, ator, ticket);
      const decidida = gate.decidir(ag, endereco, entrada, ator, contexto());
      if (resultado === "aprovado") conferirAprovacao(ag, ticket.ticket_id);
      return decidida;
    });
    return { demanda, canceladas: [] };
  };
}

const EFEITOS_DO_GATE: Record<
  NomeGate,
  (banco: DatabaseSync, endereco: Endereco, entrada: unknown, ator: Ator) => ResultadoDoGate | Promise<ResultadoDoGate>
> = {
  gate_demanda: decidirGateDaDemanda,
  gate_planejamento: decidirGateDoPlanejamento,
  gate_pr: decidirGateDoPR,
  gate_revisao_rodada: decidirGateDeRevisao("gate_revisao_rodada"),
  gate_revisao_demanda: decidirGateDeRevisao("gate_revisao_demanda"),
};

/**
 * Decide o gate `nome` no `endereco` da demanda (gates da demanda) ou da rodada (gates da rodada): a regra do núcleo e
 * os efeitos fora do agregado, por um caminho só. A recusa não grava nada; o gate segue aberto para nova tentativa.
 */
export async function decidirGate(
  banco: DatabaseSync,
  nome: NomeGate,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
): Promise<ResultadoDoGate> {
  return await EFEITOS_DO_GATE[nome](banco, endereco, entrada, ator);
}
