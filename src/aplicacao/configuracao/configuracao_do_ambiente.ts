// Caso de uso da configuração do Ambiente: valida a entrada e só então grava; o armazenamento recebe o tipo validado.
import type { DatabaseSync } from "node:sqlite";
import { ConfiguracaoDoAmbiente } from "../../nucleo/projeto.ts";
import { salvarConfiguracaoDoAmbiente } from "../../armazenamento/servico.ts";

/** Valida a `entrada` e grava a configuração do Ambiente inteira; campo ausente volta ao padrão. */
export function validarESalvarConfiguracaoDoAmbiente(banco: DatabaseSync, entrada: unknown): ConfiguracaoDoAmbiente {
  return salvarConfiguracaoDoAmbiente(banco, ConfiguracaoDoAmbiente.parse(entrada));
}
