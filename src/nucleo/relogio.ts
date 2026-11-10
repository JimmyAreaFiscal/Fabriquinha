// O relógio do serviço: a única leitura da hora do código vem de `relogioDoSistema`, injetado pela composição; os
// testes usam `relogioFixo`. Aqui também ficam as contas de calendário que precisam de `Date`.
import type { Instante } from "./primitivos.ts";

export interface Relogio {
  agora(): Instante;
}

export const relogioDoSistema: Relogio = { agora: () => new Date().toISOString() };

/** @testes o relógio de produção é o do sistema; os testes fixam o instante */
export const relogioFixo = (instante: Instante): Relogio => ({ agora: () => instante });

/** O instante UTC da meia-noite do dia 1 do mês `mes` (1 a 12; fora disso, vira o ano) do `ano`, no fuso do serviço. */
export const inicioDoMes = (ano: number, mes: number): Instante => new Date(ano, mes - 1, 1).toISOString();

/** O `instante` recuado em `ms` milissegundos. */
export const instanteAntes = (instante: Instante, ms: number): Instante =>
  new Date(Date.parse(instante) - ms).toISOString();

/** O `instante` adiantado em `ms` milissegundos. */
export const instanteDepois = (instante: Instante, ms: number): Instante =>
  new Date(Date.parse(instante) + ms).toISOString();

/** A `data` (ISO ou qualquer texto que o `Date` entenda) como Instante. */
export const comoInstante = (data: string): Instante => new Date(data).toISOString();
