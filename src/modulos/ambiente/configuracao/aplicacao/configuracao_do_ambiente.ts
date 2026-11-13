// A Configuração do Ambiente na aplicação: validada antes de gravar.
import type { DatabaseSync } from "node:sqlite";
import { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";
import { salvarConfiguracaoDoAmbiente } from "../armazenamento/configuracao_do_ambiente.ts";

/** Valida a `entrada` e grava a configuração do Ambiente inteira; campo ausente volta ao padrão. */
export function validarESalvarConfiguracaoDoAmbiente(banco: DatabaseSync, entrada: unknown): ConfiguracaoDoAmbiente {
  return salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse(entrada));
}
