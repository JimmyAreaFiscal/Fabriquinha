// A configuração do serviço (o agendador, o intervalo, o timeout e a ociosidade), que a tela de Configuração grava.
import type { DatabaseSync } from "node:sqlite";
import { Configuracao, salvarConfiguracao } from "../armazenamento/configuracao_do_servico.ts";

/** Valida a `entrada` e grava a configuração do serviço inteira. */
export const validarESalvarConfiguracao = (banco: DatabaseSync, entrada: unknown): Configuracao =>
  salvarConfiguracao(banco, Configuracao.parse(entrada));
