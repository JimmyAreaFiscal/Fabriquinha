// Gravação e leitura de projetos (C19: registrar e editar; F2 §4 e §6).
// As conferências externas (F5 §2, F4 §9) rodam antes, fora daqui.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { Projeto } from "../dominio/projeto.ts";
import { escrever } from "./banco.ts";

interface Linha {
  nome: string;
  repo: string;
  branch_base: string;
  hospedagem: string;
  preparacao: string;
  testes: string;
  sonar_project_key: string;
  fitness: string;
  modelos: string;
}

const json = (texto: string): unknown => JSON.parse(texto);

const deLinha = (l: Linha): Projeto =>
  Projeto.parse({
    nome: l.nome,
    repo: l.repo,
    branchBase: l.branch_base,
    hospedagem: l.hospedagem,
    preparacao: json(l.preparacao),
    testes: json(l.testes),
    sonar: { projectKey: l.sonar_project_key },
    fitness: json(l.fitness),
    modelos: json(l.modelos),
  });

/**
 * Valida o schema do F1 (§3.3) e grava numa transação. O repositório só pode ser de um projeto; `sql` usa os
 * parâmetros nomeados das colunas e devolve quantas linhas mudou.
 */
function gravar(banco: DatabaseSync, entrada: unknown, sql: string, conferir: (p: Projeto, mudou: boolean) => void) {
  const p = Projeto.parse(entrada);
  escrever(banco, () => {
    const dono = banco.prepare("SELECT nome FROM projeto WHERE repo = ? AND nome <> ?").get(p.repo, p.nome);
    if (dono) {
      throw new ErroDeRegra(
        `o repositório ${p.repo} já é do projeto ${String(dono.nome)}`,
        `edite o projeto ${String(dono.nome)} em vez de cadastrar outro para o mesmo repositório`,
      );
    }
    const { changes } = banco.prepare(sql).run({
      nome: p.nome,
      repo: p.repo,
      branch_base: p.branchBase,
      hospedagem: p.hospedagem,
      preparacao: JSON.stringify(p.preparacao),
      testes: JSON.stringify(p.testes),
      sonar_project_key: p.sonar.projectKey,
      fitness: JSON.stringify(p.fitness),
      modelos: JSON.stringify(p.modelos),
    });
    conferir(p, changes > 0);
  });
  return p;
}

/** C19: cadastra um projeto novo. */
export const registrarProjeto = (banco: DatabaseSync, entrada: unknown): Projeto =>
  gravar(
    banco,
    entrada,
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, preparacao, testes, sonar_project_key, fitness, modelos)
     VALUES ($nome, $repo, $branch_base, $hospedagem, $preparacao, $testes, $sonar_project_key, $fitness, $modelos)
     ON CONFLICT (nome) DO NOTHING`,
    (p, mudou) => {
      if (!mudou) throw new ErroDeRegra(`já existe o projeto ${p.nome}`, "edite-o na Configuração");
    },
  );

/** C19: substitui a configuração de um projeto que já existe; o nome é a chave e não muda. */
export const editarProjeto = (banco: DatabaseSync, entrada: unknown): Projeto =>
  gravar(
    banco,
    entrada,
    `UPDATE projeto SET repo = $repo, branch_base = $branch_base, hospedagem = $hospedagem, preparacao = $preparacao,
       testes = $testes, sonar_project_key = $sonar_project_key, fitness = $fitness, modelos = $modelos
     WHERE nome = $nome`,
    (p, mudou) => {
      if (!mudou) throw new ErroDeInexistente(`o projeto ${p.nome} não existe`, "cadastre-o na Configuração");
    },
  );

export function projeto(banco: DatabaseSync, nome: string): Projeto | undefined {
  const linha = banco.prepare("SELECT * FROM projeto WHERE nome = ?").get(nome) as Linha | undefined;
  return linha && deLinha(linha);
}

/** Todos os projetos, em ordem de nome. */
export function projetos(banco: DatabaseSync): Projeto[] {
  return (banco.prepare("SELECT * FROM projeto ORDER BY nome").all() as unknown as Linha[]).map(deLinha);
}

/** Quantas issues o projeto tem, inclusive concluídas e arquivadas: o número ao lado do nome na Configuração. */
export const issuesDoProjeto = (banco: DatabaseSync, nome: string): number =>
  Number(banco.prepare("SELECT count(*) AS n FROM issue WHERE projeto = ?").get(nome)?.n);
