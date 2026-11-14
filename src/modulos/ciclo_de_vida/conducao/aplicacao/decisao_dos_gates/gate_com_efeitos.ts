// A decisão de um Gate com os efeitos fora do agregado (comparacao-sdlc-implementacao.md §§3, 4 e 6): a regra é a do
// `gate.ts` da Etapa dona dele; aqui ficam a forma comum e os efeitos que não são de Etapa nenhuma (conferir as evidências
// da revisão). O Gate da demanda, que cancela em cascata, é decidido pelo fluxo do servidor, junto dos pedidos. Os efeitos de cada Etapa (integrar o PR, falar com o pi) ficam na pasta dela, e
// `etapas/gates.ts` junta um Gate por nome.
import { type AgregadoDemanda, decidirGateNaDemanda, type Gate } from "../../../processo/publico.ts";
import type { Ator, Endereco } from "../../../etapas/publico.ts";
import type { Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { conferirAprovacao } from "./revisao_pendencias.ts";
import { exigirTrabalhoDoTicket } from "../politica_dos_agentes/trabalho_do_ticket.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";

/** A demanda decidida; `canceladas` fica vazia (só o gate da demanda cancela, D08) e `sessao` é a de ajustes do PR reprovado. */
export interface ResultadoDoGate {
  demanda: AgregadoDemanda;
  canceladas: string[];
  sessao?: string;
}

/** Um Gate do SDLC: a regra (agregado → agregado) e a decisão com os efeitos fora do agregado. */
export interface GateComEfeitos {
  readonly regra: Gate;
  decidir(
    modulos: ModulosDoCiclo,
    endereco: Endereco,
    entrada: unknown,
    ator: Ator,
    relogio: Relogio,
  ): ResultadoDoGate | Promise<ResultadoDoGate>;
}

/** A aprovação só passa com as evidências em ordem; a recusa desfaz tudo. O agente só decide o gate do próprio ticket. */
export const gateDeRevisao = (regra: Gate): GateComEfeitos => ({
  regra,
  decidir({ banco }, endereco, entrada, ator, relogio) {
    const { resultado } = regra.validarEntrada(entrada, ator);
    const demanda = decidirGateNaDemanda(banco, regra, endereco, entrada, ator, relogio, {
      antes: (_ag, ticket) => {
        exigirTrabalhoDoTicket(banco, ator, ticket);
      },
      depois: (ag, ticket) => {
        if (resultado === "aprovado") conferirAprovacao(ag, ticket.ticket_id);
      },
    });
    return { demanda, canceladas: [] };
  },
});
