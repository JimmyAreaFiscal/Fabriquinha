// Usuários Simulados e os seus anexos (F8 §2): o cadastro por projeto. O conteúdo do anexo fica em arquivos/ pelo SHA-256.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { encontrado, ErroDeInexistente, ErroDeRegra, existe } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import {
  NomeDoAnexo,
  NovaTarefa,
  NovoUsuarioSimulado,
  type RelatorioSimulacao,
  SEM_LINK,
  type StatusExecucaoSimulada,
} from "../dominio/simulacao.ts";
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

/** Uma vez que um Usuário Simulado fez a Tarefa (F8 §4): o `relatorio` só vem na concluída e o `erro`, na que falhou. */
export interface ExecucaoSimulada {
  id: Id;
  usuario: Id;
  usuarioNome: string;
  status: StatusExecucaoSimulada;
  relatorio?: RelatorioSimulacao;
  erro?: string;
}

export interface Tarefa {
  id: Id;
  projeto: string;
  texto: string;
  n: number;
  criadaEm: string;
  /** Os Usuários Simulados alocados, em ordem de criação. */
  usuarios: { id: Id; nome: string }[];
  /** As execuções na ordem em que foram enfileiradas: N por usuário alocado, de todas as vezes que o Executar rodou. */
  execucoes: ExecucaoSimulada[];
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

/** As Tarefas do projeto na ordem em que foram criadas, cada uma com os Usuários Simulados alocados e as execuções. */
export function tarefas(banco: DatabaseSync, nomeDoProjeto: string): Tarefa[] {
  doProjeto(banco, nomeDoProjeto);
  const alocados = banco
    .prepare(
      `SELECT tu.tarefa, u.id, u.nome FROM tarefa_usuario tu
       JOIN tarefa t ON t.id = tu.tarefa JOIN usuario_simulado u ON u.id = tu.usuario
       WHERE t.projeto = ? ORDER BY u.id`,
    )
    .all(nomeDoProjeto) as unknown as { tarefa: Id; id: Id; nome: string }[];
  // ponytail: o relatório de todas as execuções vai em cada leitura (a tela relê a cada 3 s com pendentes); se pesar,
  // a lista leva só o status e o relatório sai numa rota própria.
  const execucoes = (
    banco
      .prepare(
        `SELECT e.id, e.tarefa, e.usuario, u.nome AS usuarioNome, e.status, e.relatorio, e.erro
         FROM execucao_simulada e JOIN tarefa t ON t.id = e.tarefa JOIN usuario_simulado u ON u.id = e.usuario
         WHERE t.projeto = ? ORDER BY e.id`,
      )
      .all(nomeDoProjeto) as unknown as (Omit<ExecucaoSimulada, "relatorio" | "erro"> & {
      tarefa: Id;
      relatorio: string | null;
      erro: string | null;
    })[]
  ).map(({ relatorio, erro, ...e }) => ({
    ...e,
    ...(relatorio !== null && { relatorio: JSON.parse(relatorio) as RelatorioSimulacao }),
    ...(erro !== null && { erro }),
  }));
  return (
    banco
      .prepare("SELECT id, projeto, texto, n, criada_em AS criadaEm FROM tarefa WHERE projeto = ? ORDER BY id")
      .all(nomeDoProjeto) as unknown as Omit<Tarefa, "usuarios" | "execucoes">[]
  ).map((t) => ({
    ...t,
    usuarios: alocados.filter((a) => a.tarefa === t.id).map(({ id, nome }) => ({ id, nome })),
    execucoes: execucoes.filter((e) => e.tarefa === t.id).map(({ tarefa: _, ...e }) => e),
  }));
}

const PENDENTES = "status IN ('na_fila', 'em_andamento')";

/**
 * Enfileira as execuções da Tarefa: N para cada usuário alocado, todas `na_fila`, numa transação. Sem link do produto
 * ou com execução pendente da Tarefa, recusa sem gravar nada. Devolve os IDs, na ordem de execução, e o link, que vale
 * para todas.
 */
export function enfileirar(banco: DatabaseSync, tarefa: Id): { execucoes: Id[]; link: string } {
  return escrever(banco, () => {
    const t = encontrado(
      banco
        .prepare("SELECT t.n, p.link_produto AS link FROM tarefa t JOIN projeto p ON p.nome = t.projeto WHERE t.id = ?")
        .get(tarefa) as { n: number; link: string | null } | undefined,
      `a Tarefa ${String(tarefa)} não existe`,
      "confira a Tarefa na página Simulação",
    );
    if (!t.link) throw new ErroDeRegra(SEM_LINK);
    if (banco.prepare(`SELECT 1 FROM execucao_simulada WHERE tarefa = ? AND ${PENDENTES}`).get(tarefa)) {
      throw new ErroDeRegra("a Tarefa já está em execução", "espere ela terminar para executar de novo");
    }
    const usuarios = banco.prepare("SELECT usuario FROM tarefa_usuario WHERE tarefa = ? ORDER BY usuario").all(tarefa);
    const inserir = banco.prepare("INSERT INTO execucao_simulada (tarefa, usuario, status) VALUES (?, ?, 'na_fila')");
    const execucoes = usuarios.flatMap(({ usuario }) =>
      Array.from({ length: t.n }, () => Number(inserir.run(tarefa, Number(usuario)).lastInsertRowid)),
    );
    return { execucoes, link: t.link };
  });
}

export type Marca =
  | { status: "em_andamento" }
  | { status: "concluida"; relatorio: RelatorioSimulacao }
  | { status: "falhou"; erro: string };

/** Leva a execução ao novo status; ao terminar (concluída ou falhou), grava o fim e solta o `pgid`. */
export function marcar(banco: DatabaseSync, id: Id, marca: Marca): void {
  const agora = new Date().toISOString();
  const terminou = marca.status !== "em_andamento";
  banco
    .prepare(
      `UPDATE execucao_simulada SET status = $status, relatorio = $relatorio, erro = $erro,
         iniciada_em = COALESCE($inicio, iniciada_em), terminada_em = $fim,
         pgid = CASE WHEN $fim IS NULL THEN pgid END
       WHERE id = $id`,
    )
    .run({
      id,
      status: marca.status,
      relatorio: marca.status === "concluida" ? JSON.stringify(marca.relatorio) : null,
      erro: marca.status === "falhou" ? marca.erro : null,
      inicio: terminou ? null : agora,
      fim: terminou ? agora : null,
    });
}

/** O grupo de processos do pi da execução, para o reinício do serviço matá-lo. */
export function gravarPgid(banco: DatabaseSync, id: Id, pgid: number): void {
  banco.prepare("UPDATE execucao_simulada SET pgid = ? WHERE id = ?").run(pgid, id);
}

/**
 * Reinício do serviço (F4 §7): toda execução simulada pendente é de uma instância anterior. Marca-as `falhou` com o
 * `erro` e devolve os `pgid` dos pi que ficaram rodando, para quem chama matar.
 */
export function falharPendentes(banco: DatabaseSync, erro: string): number[] {
  return escrever(banco, () => {
    const pgids = banco
      .prepare(`SELECT pgid FROM execucao_simulada WHERE ${PENDENTES} AND pgid IS NOT NULL`)
      .all()
      .map(({ pgid }) => Number(pgid));
    banco
      .prepare(
        `UPDATE execucao_simulada SET status = 'falhou', erro = ?, relatorio = NULL, pgid = NULL, terminada_em = ?
         WHERE ${PENDENTES}`,
      )
      .run(erro, new Date().toISOString());
    return pgids;
  });
}

/** O que o executor precisa de uma execução: o texto da Tarefa e o Usuário Simulado com os anexos. */
export function paraRodar(banco: DatabaseSync, id: Id): { texto: string; usuario: UsuarioSimulado } {
  const l = encontrado(
    banco
      .prepare(
        "SELECT t.texto, t.projeto, e.usuario FROM execucao_simulada e JOIN tarefa t ON t.id = e.tarefa WHERE e.id = ?",
      )
      .get(id) as { texto: string; projeto: string; usuario: Id } | undefined,
    `a execução simulada ${String(id)} não existe`,
    "confira a Tarefa na página Simulação",
  );
  const usuario = existe(
    usuariosSimulados(banco, l.projeto).find((u) => u.id === l.usuario),
    `o Usuário Simulado ${String(l.usuario)} sumiu`,
    "tente executar de novo",
  );
  return { texto: l.texto, usuario };
}
