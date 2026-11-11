// A decisão de um Gate com os efeitos fora do agregado (comparacao-sdlc-implementacao.md §§3, 4 e 6): a regra é a do
// `gate.ts` da Etapa dona dele; aqui ficam a forma comum e os efeitos que não são de Etapa nenhuma (cancelar em cascata,
// conferir as evidências da revisão). Os efeitos de cada Etapa (integrar o PR, falar com o pi) ficam na pasta dela, e
// `etapas/gates.ts` junta um Gate por nome.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../nucleo/demanda/agregado_demanda.ts";
import type { Gate } from "../../nucleo/gate.ts";
import type { Ator } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import type { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import type { Relogio } from "../../../compartilhado/nucleo/relogio.ts";
import { comDemanda } from "../../armazenamento/demandas.ts";
import { conferirAprovacao } from "./revisao_pendencias.ts";
import { exigirTrabalhoDoTicket } from "../../../trabalho_agentico/aplicacao/trabalho/trabalho_do_ticket.ts";
import { cancelandoEmCascata } from "./cancelamento_em_cascata.ts";

/** A demanda decidida; `canceladas` são as que o gate da demanda levou junto (D08) e `sessao`, a de ajustes do PR reprovado. */
export interface ResultadoDoGate {
  demanda: AgregadoDemanda;
  canceladas: string[];
  sessao?: string;
}

/** Um Gate do SDLC: a regra (agregado → agregado) e a decisão com os efeitos fora do agregado. */
export interface GateComEfeitos {
  readonly regra: Gate;
  decidir(
    banco: DatabaseSync,
    endereco: Endereco,
    entrada: unknown,
    ator: Ator,
    relogio: Relogio,
  ): ResultadoDoGate | Promise<ResultadoDoGate>;
}

/** CA-16 a CA-20: aprovar não cascateia, reprovar cancela a demanda e as dependentes. */
export const gateQueCancelaEmCascata = (regra: Gate): GateComEfeitos => ({
  regra,
  decidir(banco, endereco, entrada, ator, relogio) {
    const ctx = { agora: relogio.agora() };
    return cancelandoEmCascata(banco, endereco.demanda_id, ator, ctx, (ag) =>
      regra.decidir(ag, endereco, entrada, ator, ctx),
    );
  },
});

/** A aprovação só passa com as evidências em ordem; a recusa desfaz tudo. O agente só decide o gate do próprio ticket. */
export const gateDeRevisao = (regra: Gate): GateComEfeitos => ({
  regra,
  decidir(banco, endereco, entrada, ator, relogio) {
    const { resultado } = regra.validarEntrada(entrada, ator);
    const demanda = comDemanda(banco, endereco.demanda_id, (ag) => {
      const ticket = regra.ancora(ag, endereco);
      exigirTrabalhoDoTicket(banco, ator, ticket);
      const decidida = regra.decidir(ag, endereco, entrada, ator, { agora: relogio.agora() });
      if (resultado === "aprovado") conferirAprovacao(ag, ticket.ticket_id);
      return decidida;
    });
    return { demanda, canceladas: [] };
  },
});
