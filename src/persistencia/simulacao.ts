// Usuários Simulados e os seus anexos (F8 §2): o cadastro por projeto. O conteúdo do anexo fica em arquivos/ pelo SHA-256.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { encontrado, ErroDeInexistente, ErroDeRegra, existe } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { NomeDoAnexo, NovaTarefa, NovoUsuarioSimulado } from "../dominio/simulacao.ts";
import { guardarBytes } from "./arquivos.ts";
import { escrever } from "./banco.ts";
import { projeto } from "./projetos.ts";

export interface Anexo {
  nome: string;
  sha256: string;
  bytes: number;
}

export interface UsuarioSimulado {
  id: Id;
  projeto: string;
  nome: string;
  descricao: string;
  anexos: Anexo[];
}

export interface Tarefa {
  id: Id;
  projeto: string;
  texto: string;
  n: number;
  criadaEm: string;
  /** Os Usuários Simulados alocados, em ordem de criação. */
  usuarios: { id: Id; nome: string }[];
  /** Ainda não há como executar: o ticket seguinte da I-10 preenche. */
  execucoes: never[];
}

const doProjeto = (banco: DatabaseSync, nome: string): void => {
  encontrado(projeto(banco, nome), `o projeto ${nome} não existe`, "confira o nome do projeto");
};

const doUsuario = (banco: DatabaseSync, id: Id): void => {
  encontrado(
    banco.prepare("SELECT id FROM usuario_simulado WHERE id = ?").get(id),
    `o Usuário Simulado ${String(id)} não existe`,
    "confira o usuário na Configuração do projeto",
  );
};

/** Cria um Usuário Simulado do projeto; o nome não se repete dentro dele. */
export function criarUsuarioSimulado(banco: DatabaseSync, nomeDoProjeto: string, entrada: unknown): UsuarioSimulado {
  const { nome, descricao } = NovoUsuarioSimulado.parse(entrada);
  const id = escrever(banco, () => {
    doProjeto(banco, nomeDoProjeto);
    const { changes, lastInsertRowid } = banco
      .prepare(
        "INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES (?, ?, ?) ON CONFLICT (projeto, nome) DO NOTHING",
      )
      .run(nomeDoProjeto, nome, descricao);
    if (changes === 0) {
      throw new ErroDeRegra(
        `já existe o Usuário Simulado ${nome} no projeto ${nomeDoProjeto}`,
        "escolha outro nome para o novo usuário",
      );
    }
    return Number(lastInsertRowid);
  });
  return { id, projeto: nomeDoProjeto, nome, descricao, anexos: [] };
}

/** Os Usuários Simulados do projeto, na ordem em que foram criados, cada um com os anexos em ordem de nome. */
export function usuariosSimulados(banco: DatabaseSync, nomeDoProjeto: string): UsuarioSimulado[] {
  doProjeto(banco, nomeDoProjeto);
  const anexos = banco
    .prepare(
      `SELECT a.usuario, a.nome, a.sha256, a.bytes FROM usuario_simulado_anexo a
       JOIN usuario_simulado u ON u.id = a.usuario WHERE u.projeto = ? ORDER BY a.nome`,
    )
    .all(nomeDoProjeto) as unknown as (Anexo & { usuario: Id })[];
  return (
    banco
      .prepare("SELECT id, projeto, nome, descricao FROM usuario_simulado WHERE projeto = ? ORDER BY id")
      .all(nomeDoProjeto) as unknown as Omit<UsuarioSimulado, "anexos">[]
  ).map((u) => ({
    ...u,
    anexos: anexos.filter((a) => a.usuario === u.id).map(({ nome, sha256, bytes }) => ({ nome, sha256, bytes })),
  }));
}

/** Anexa o arquivo ao Usuário Simulado; um anexo com o mesmo nome é trocado. */
export function anexar(banco: DatabaseSync, usuario: Id, nome: string, conteudo: Buffer): Anexo {
  // Dentro de um objeto, para o erro levar o caminho `nome`, como o de um campo do formulário.
  const { nome: nomeValido } = z.object({ nome: NomeDoAnexo }).parse({ nome });
  doUsuario(banco, usuario);
  const guardado = guardarBytes(banco, conteudo);
  banco
    .prepare(
      `INSERT INTO usuario_simulado_anexo (usuario, nome, sha256, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT (usuario, nome) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes`,
    )
    .run(usuario, nomeValido, guardado.sha256, guardado.bytes);
  return { nome: nomeValido, ...guardado };
}

/** Tira o anexo do Usuário Simulado. O arquivo em arquivos/ fica: outro anexo pode usar o mesmo conteúdo. */
export function removerAnexo(banco: DatabaseSync, usuario: Id, nome: string): void {
  doUsuario(banco, usuario);
  const { changes } = banco
    .prepare("DELETE FROM usuario_simulado_anexo WHERE usuario = ? AND nome = ?")
    .run(usuario, nome);
  if (changes === 0) {
    throw new ErroDeInexistente(
      `o Usuário Simulado ${String(usuario)} não tem o anexo ${nome}`,
      "confira o nome do anexo",
    );
  }
}

/** Cria a Tarefa do projeto e a aloca aos Usuários Simulados dele; usuário de outro projeto é recusado. */
export function criarTarefa(banco: DatabaseSync, nomeDoProjeto: string, entrada: unknown): Tarefa {
  const { texto, n, usuarios } = NovaTarefa.parse(entrada);
  const criadaEm = new Date().toISOString();
  const id = escrever(banco, () => {
    doProjeto(banco, nomeDoProjeto);
    const alocar = [...new Set(usuarios)];
    const dele = banco.prepare("SELECT id FROM usuario_simulado WHERE id = ? AND projeto = ?");
    const alheio = alocar.find((u) => !dele.get(u, nomeDoProjeto));
    if (alheio !== undefined) {
      throw new ErroDeRegra(
        `o Usuário Simulado ${String(alheio)} não é do projeto ${nomeDoProjeto}`,
        "aloque só usuários simulados do projeto",
      );
    }
    const { lastInsertRowid } = banco
      .prepare("INSERT INTO tarefa (projeto, texto, n, criada_em) VALUES (?, ?, ?, ?)")
      .run(nomeDoProjeto, texto, n, criadaEm);
    for (const u of alocar) {
      banco.prepare("INSERT INTO tarefa_usuario (tarefa, usuario) VALUES (?, ?)").run(lastInsertRowid, u);
    }
    return Number(lastInsertRowid);
  });
  return existe(
    tarefas(banco, nomeDoProjeto).find((t) => t.id === id),
    `a Tarefa ${String(id)} sumiu`,
    "tente criar de novo",
  );
}

/** As Tarefas do projeto na ordem em que foram criadas, cada uma com os Usuários Simulados alocados. */
export function tarefas(banco: DatabaseSync, nomeDoProjeto: string): Tarefa[] {
  doProjeto(banco, nomeDoProjeto);
  const alocados = banco
    .prepare(
      `SELECT tu.tarefa, u.id, u.nome FROM tarefa_usuario tu
       JOIN tarefa t ON t.id = tu.tarefa JOIN usuario_simulado u ON u.id = tu.usuario
       WHERE t.projeto = ? ORDER BY u.id`,
    )
    .all(nomeDoProjeto) as unknown as { tarefa: Id; id: Id; nome: string }[];
  return (
    banco
      .prepare("SELECT id, projeto, texto, n, criada_em AS criadaEm FROM tarefa WHERE projeto = ? ORDER BY id")
      .all(nomeDoProjeto) as unknown as Omit<Tarefa, "usuarios" | "execucoes">[]
  ).map((t) => ({
    ...t,
    usuarios: alocados.filter((a) => a.tarefa === t.id).map(({ id, nome }) => ({ id, nome })),
    execucoes: [],
  }));
}
