// O fluxo do cadastro e da edição do projeto, entre Demandas e Sessões de IA: o projeto só é gravado depois de o harness
// do serviço conferir o modelo novo ou trocado de cada etapa (F4 §9).
import type { DatabaseSync } from "node:sqlite";
import { cadastrarProjetoDoFormulario, editarProjetoDoFormulario } from "../../modulos/projeto/aplicacao/cadastro.ts";
import type { Modelo } from "../../modulos/compartilhado/nucleo/primitivos.ts";
import { condutor } from "../../modulos/trabalho_agentico/aplicacao/trabalho/condutor.ts";

type FormularioDoProjeto = Parameters<typeof cadastrarProjetoDoFormulario>[1];

const conferirModeloNoHarness = (modelo: Modelo): Promise<void> => condutor.harness.conferirModelo(modelo);

export const cadastrarProjetoConferindoOModelo = (banco: DatabaseSync, formulario: FormularioDoProjeto) =>
  cadastrarProjetoDoFormulario(banco, formulario, conferirModeloNoHarness);

export const editarProjetoConferindoOModelo = (banco: DatabaseSync, formulario: FormularioDoProjeto) =>
  editarProjetoDoFormulario(banco, formulario, conferirModeloNoHarness);
