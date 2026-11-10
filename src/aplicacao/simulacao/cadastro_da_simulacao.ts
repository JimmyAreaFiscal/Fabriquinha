// Casos de uso do cadastro da Simulação: validam a entrada e só então gravam; o armazenamento recebe o tipo validado.
import type { DatabaseSync } from "node:sqlite";
import { NovaTarefa, NovoUsuarioSimulado } from "../../nucleo/simulacao.ts";
import { criarTarefa, criarUsuarioSimulado, type Tarefa, type UsuarioSimulado } from "../../armazenamento/simulacao.ts";

/** Valida a `entrada` e cria o Usuário Simulado do projeto. */
export const validarECriarUsuarioSimulado = (
  banco: DatabaseSync,
  nomeDoProjeto: string,
  entrada: unknown,
): UsuarioSimulado => criarUsuarioSimulado(banco, nomeDoProjeto, NovoUsuarioSimulado.parse(entrada));

/** Valida a `entrada` e cria a Tarefa do projeto. */
export const validarECriarTarefa = (banco: DatabaseSync, nomeDoProjeto: string, entrada: unknown): Tarefa =>
  criarTarefa(banco, nomeDoProjeto, NovaTarefa.parse(entrada));
