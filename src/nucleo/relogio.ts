// O relógio do serviço: a única leitura da hora do código vem de `relogioDoSistema`, injetado pela composição; os
// testes usam `relogioFixo`. Aqui também ficam as contas de calendário que precisam de `Date`.
import type { Instante } from "./primitivos.ts";

/** @testes ainda sem consumidor de produção; a composição e as bordas passam a injetá-lo nos próximos tickets */
export interface Relogio {
  agora(): Instante;
}

/** @testes ainda sem consumidor de produção; a composição e as bordas passam a injetá-lo nos próximos tickets */
export const relogioDoSistema: Relogio = { agora: () => new Date().toISOString() };

/** @testes ainda sem consumidor de produção; a composição e as bordas passam a injetá-lo nos próximos tickets */
export const relogioFixo = (instante: Instante): Relogio => ({ agora: () => instante });

/** O instante UTC da meia-noite do dia 1 do mês `mes` (1 a 12; fora disso, vira o ano) do `ano`, no fuso do serviço. */
export const inicioDoMes = (ano: number, mes: number): Instante => new Date(ano, mes - 1, 1).toISOString();
