// Casos de uso do cadastro da Simulação: validam a entrada e só então gravam; o armazenamento recebe o tipo validado.
import type { DatabaseSync } from "node:sqlite";
import { NovaTarefa, NovoUsuarioSimulado } from "../../nucleo/simulacao.ts";
import type { Id } from "../../../compartilhado/nucleo/primitivos.ts";
import type { Relogio } from "../../../compartilhado/nucleo/relogio.ts";
import {
  type Anexo,
  anexar,
  criarTarefa,
  criarUsuarioSimulado,
  removerAnexo,
  tarefas,
  type Tarefa,
  type UsuarioSimulado,
  usuariosSimulados,
} from "../../armazenamento/simulacao.ts";

/** Os Usuários Simulados do projeto, na ordem de criação, com os anexos. */
export const listarUsuariosSimulados = (banco: DatabaseSync, nomeDoProjeto: string): UsuarioSimulado[] =>
  usuariosSimulados(banco, nomeDoProjeto);

/** Valida a `entrada` e cria o Usuário Simulado do projeto. */
export const validarECriarUsuarioSimulado = (
  banco: DatabaseSync,
  nomeDoProjeto: string,
  entrada: unknown,
): UsuarioSimulado => criarUsuarioSimulado(banco, nomeDoProjeto, NovoUsuarioSimulado.parse(entrada));

/** Anexa o arquivo ao Usuário Simulado; um anexo com o mesmo nome é trocado. */
export const anexarArquivoAoUsuarioSimulado = (
  banco: DatabaseSync,
  usuario: Id,
  nomeDoAnexo: string,
  conteudo: Buffer,
): Anexo => anexar(banco, usuario, nomeDoAnexo, conteudo);

/** Tira o anexo do Usuário Simulado. */
export const removerAnexoDoUsuarioSimulado = (banco: DatabaseSync, usuario: Id, nomeDoAnexo: string): void => {
  removerAnexo(banco, usuario, nomeDoAnexo);
};

/** As Tarefas do projeto, com os Usuários Simulados alocados e as execuções. */
export const listarTarefas = (banco: DatabaseSync, nomeDoProjeto: string): Tarefa[] => tarefas(banco, nomeDoProjeto);

/** Valida a `entrada` e cria a Tarefa do projeto, criada no instante do `relogio`. */
export const validarECriarTarefa = (
  banco: DatabaseSync,
  nomeDoProjeto: string,
  entrada: unknown,
  relogio: Relogio,
): Tarefa => criarTarefa(banco, nomeDoProjeto, NovaTarefa.parse(entrada), relogio.agora());
