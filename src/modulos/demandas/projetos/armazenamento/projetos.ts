// Leitura e gravação do projeto (F2 §4 e §6): a única que toca as linhas de `projeto` e das tabelas da sua configuração.
// As recusas de negócio e o disco são do cadastro (aplicacao/cadastro.ts); as conferências externas (F5 §2,
// F4 §9) rodam antes.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
// O mapeador das colunas da configuração do agente é do Ciclo de Vida, dono da Configuração do Agente.
import {
  colunasDaConfiguracaoAgente,
  linhaComConfiguracaoAgente,
} from "../../../../shared/armazenamento/linhas/colunas_da_configuracao_agente.ts";
import { Projeto } from "../nucleo/projeto.ts";

type Linha = Record<string, unknown>;

const listar = (banco: DatabaseSync, sql: string, nome: string): Linha[] => banco.prepare(sql).all(nome);

/** Remove os `null` das linhas: opcional ausente no schema é chave ausente, não `null`. */
const semNulos = (l: Linha): Linha => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null));

const COLUNAS_DO_PROJETO = "nome, raiz_git, branch_base, hospedagem, chave_sonarqube, imagem_do_ambiente";

/** Monta o projeto da `linha` com as tabelas da sua configuração; quem chama garante o snapshot. */
function montarProjeto(banco: DatabaseSync, linha: Linha): Projeto {
  const nome = String(linha.nome);
  return Projeto.parse({
    ...semNulos(linha),
    etapas: listar(
      banco,
      "SELECT etapa, modelo_provedor, modelo_nome, effort FROM configuracao_etapa_projeto WHERE projeto = ? ORDER BY etapa",
      nome,
    ).map(linhaComConfiguracaoAgente),
    verificacoes: {
      preparacao: listar(
        banco,
        "SELECT comando FROM comando_preparacao_projeto WHERE projeto = ? ORDER BY ordem",
        nome,
      ).map((l) => l.comando),
      fitness: listar(
        banco,
        "SELECT nome, comando, descricao FROM fitness_function_projeto WHERE projeto = ? ORDER BY nome",
        nome,
      ),
      linguagens: listar(
        banco,
        "SELECT caminho, linguagem, comando_teste FROM linguagem_projeto WHERE projeto = ? ORDER BY caminho",
        nome,
      ),
      e2e: listar(
        banco,
        "SELECT caminho_linguagem, comando_build, comando_execucao, codigo_falha FROM configuracao_e2e WHERE projeto = ? ORDER BY caminho_linguagem",
        nome,
      ),
      globs: listar(
        banco,
        "SELECT caminho_linguagem, glob FROM glob_e2e WHERE projeto = ? ORDER BY caminho_linguagem, glob",
        nome,
      ),
    },
  });
}

/** O projeto, ou `undefined` se não existe; lido num snapshot só. */
export function buscarProjeto(banco: DatabaseSync, nome: string): Projeto | undefined {
  return lerEmSnapshot(banco, () => {
    const linha = banco.prepare(`SELECT ${COLUNAS_DO_PROJETO} FROM projeto WHERE nome = ?`).get(nome);
    return linha && montarProjeto(banco, linha);
  });
}

/** O projeto, ou ErroDeInexistente com a `orientacao`: a única checagem de "o projeto existe". */
export const projetoExistente = (
  banco: DatabaseSync,
  nome: string,
  orientacao = "confira o nome do projeto",
): Projeto => encontrado(buscarProjeto(banco, nome), `o projeto ${nome} não existe`, orientacao);

/** Todos os projetos, em ordem de nome. */
export function listarProjetos(banco: DatabaseSync): Projeto[] {
  return lerEmSnapshot(banco, () =>
    banco
      .prepare(`SELECT ${COLUNAS_DO_PROJETO} FROM projeto ORDER BY nome`)
      .all()
      .map((linha) => montarProjeto(banco, linha)),
  );
}

/** O nome do outro projeto que já usa a `raiz_git`, se houver. */
export function donoDoRepositorio(banco: DatabaseSync, raiz_git: string, nomeDoProjeto: string): string | undefined {
  const dono = banco.prepare("SELECT nome FROM projeto WHERE raiz_git = ? AND nome <> ?").get(raiz_git, nomeDoProjeto);
  return dono && String(dono.nome);
}

/** Insere cada item de `itens` na `tabela`, com as colunas de `colunas` (nomes iguais às chaves do item). */
function inserir(banco: DatabaseSync, tabela: string, nome: string, colunas: string[], itens: Linha[]): void {
  const insert = banco.prepare(
    `INSERT INTO ${tabela} (projeto, ${colunas.join(", ")}) VALUES (${["?", ...colunas.map(() => "?")].join(", ")})`,
  );
  for (const item of itens) insert.run(nome, ...colunas.map((c) => (item[c] ?? null) as SQLInputValue));
}

/**
 * Grava o projeto inteiro numa transação só: a linha e, no lugar das que havia, cada lista da configuração. Qualquer
 * falha reverte tudo. Sem coluna de posição: a ordem das listas vem das chaves (e a da preparação, do índice).
 */
export function gravarProjeto(banco: DatabaseSync, projeto: Projeto): void {
  const { nome, verificacoes } = projeto;
  escrever(banco, () => {
    banco
      .prepare(
        `INSERT INTO projeto (${COLUNAS_DO_PROJETO}) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (nome) DO UPDATE SET raiz_git = excluded.raiz_git, branch_base = excluded.branch_base,
           hospedagem = excluded.hospedagem, chave_sonarqube = excluded.chave_sonarqube,
           imagem_do_ambiente = excluded.imagem_do_ambiente`,
      )
      .run(
        nome,
        projeto.raiz_git,
        projeto.branch_base,
        projeto.hospedagem,
        projeto.chave_sonarqube,
        projeto.imagem_do_ambiente ?? null,
      );
    for (const tabela of [
      "glob_e2e",
      "configuracao_e2e",
      "linguagem_projeto",
      "fitness_function_projeto",
      "comando_preparacao_projeto",
      "configuracao_etapa_projeto",
    ])
      banco.prepare(`DELETE FROM ${tabela} WHERE projeto = ?`).run(nome);
    inserir(
      banco,
      "configuracao_etapa_projeto",
      nome,
      ["etapa", "modelo_provedor", "modelo_nome", "effort"],
      projeto.etapas.map(({ etapa, configuracao_agente }) => ({
        etapa,
        ...colunasDaConfiguracaoAgente(configuracao_agente),
      })),
    );
    inserir(
      banco,
      "comando_preparacao_projeto",
      nome,
      ["ordem", "comando"],
      verificacoes.preparacao.map((comando, indice) => ({ ordem: indice + 1, comando })),
    );
    inserir(banco, "fitness_function_projeto", nome, ["nome", "comando", "descricao"], verificacoes.fitness);
    inserir(banco, "linguagem_projeto", nome, ["caminho", "linguagem", "comando_teste"], verificacoes.linguagens);
    inserir(
      banco,
      "configuracao_e2e",
      nome,
      ["caminho_linguagem", "comando_build", "comando_execucao", "codigo_falha"],
      verificacoes.e2e,
    );
    inserir(banco, "glob_e2e", nome, ["caminho_linguagem", "glob"], verificacoes.globs);
  });
}

/**
 * Na remoção do projeto: as linhas do cadastro dele e as históricas da Simulação, na ordem das chaves estrangeiras; os
 * pedidos e o que depende deles já saíram. Devolve as execuções simuladas, para o cadastro apagar as pastas delas.
 */
export function apagarCadastroDoProjeto(banco: DatabaseSync, nome: string): { simuladas: number[] } {
  const p = { p: nome };
  const dasTarefas = "SELECT id FROM tarefa WHERE projeto = $p";
  const simuladas = (
    banco.prepare(`SELECT id FROM execucao_simulada WHERE tarefa IN (${dasTarefas})`).all(p) as { id: number }[]
  ).map((e) => e.id);
  const apagar = (tabela: string, onde: string) => banco.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run(p);
  apagar("execucao_simulada", `tarefa IN (${dasTarefas})`);
  apagar("tarefa_usuario", `tarefa IN (${dasTarefas})`);
  apagar("tarefa", "projeto = $p");
  apagar("usuario_simulado_anexo", "usuario IN (SELECT id FROM usuario_simulado WHERE projeto = $p)");
  apagar("usuario_simulado", "projeto = $p");
  apagar("projeto", "nome = $p");
  return { simuladas };
}

/** Dos anexos `sha256s`, os que um usuário simulado de outro projeto ainda cita. */
export const anexosDeUsuariosSimulados = (banco: DatabaseSync, sha256s: readonly string[]): Set<string> =>
  new Set(
    banco
      .prepare("SELECT sha256 FROM usuario_simulado_anexo WHERE sha256 IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(sha256s))
      .map((linha) => String(linha.sha256)),
  );
