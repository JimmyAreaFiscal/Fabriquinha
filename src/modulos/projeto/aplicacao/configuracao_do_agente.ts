// A configuração do serviço (o agendador, o intervalo, o timeout e a ociosidade) não é do Projeto: a tabela
// `configuracao` é do Despacho do Ciclo de Vida (ticket 16), que leva este caso de uso; o resto deste arquivo mudou para
// src/modulos/demandas/projetos/ no ticket 18.
import type { DatabaseSync } from "node:sqlite";
import { Configuracao, salvarConfiguracao } from "../../compartilhado/armazenamento/servico.ts";

/** Valida a `entrada` e grava a configuração do serviço inteira. */
export const validarESalvarConfiguracao = (banco: DatabaseSync, entrada: unknown): Configuracao =>
  salvarConfiguracao(banco, Configuracao.parse(entrada));
