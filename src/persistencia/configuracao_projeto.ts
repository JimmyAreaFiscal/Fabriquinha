// Repositório da configuração SDLC do projeto (comparacao-sdlc §7.1). Convive com `projetos.ts`, que segue dono do
// formato legado; aqui só se tocam as colunas comuns e as tabelas novas. Sem coluna de posição: a ordem vem das chaves.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Projeto } from "../dominio/configuracao_projeto.ts";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { escrever } from "./banco.ts";

type Linha = Record<string, unknown>;

const listar = (banco: DatabaseSync, sql: string, nome: string): Linha[] => banco.prepare(sql).all(nome);

/** Remove os `null` das linhas: opcional ausente no schema é chave ausente, não `null`. */
const semNulos = (l: Linha): Linha => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null));

/** Lê o projeto sem abrir transação; quem chama garante o snapshot. Sem linguagens, não há configuração nova. */
function ler(banco: DatabaseSync, nome: string): Projeto | undefined {
  const base = banco
    .prepare(
      `SELECT nome, branch_base, sonar_project_key AS chave_sonarqube, repo AS raiz_git, hospedagem, cursor_commit_humano
       FROM projeto WHERE nome = ?`,
    )
    .get(nome);
  const linguagens = listar(
    banco,
    "SELECT caminho, linguagem, comando_teste FROM linguagem_projeto WHERE projeto = ? ORDER BY caminho",
    nome,
  );
  if (!base || linguagens.length === 0) return undefined;
  return Projeto.parse({
    ...semNulos(base),
    etapas: listar(
      banco,
      "SELECT etapa, modelo_provedor, modelo_nome, effort FROM configuracao_etapa_projeto WHERE projeto = ? ORDER BY etapa",
      nome,
    ).map(semNulos),
    preparacao: listar(
      banco,
      "SELECT ordem, comando FROM comando_preparacao_projeto WHERE projeto = ? ORDER BY ordem ASC",
      nome,
    ),
    fitness: listar(
      banco,
      "SELECT nome, comando, descricao FROM fitness_function_projeto WHERE projeto = ? ORDER BY nome",
      nome,
    ),
    linguagens,
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
  });
}

/** Configuração SDLC do projeto, lida num snapshot só; `undefined` se o projeto não existe ou não tem configuração nova. */
export function configuracaoProjeto(banco: DatabaseSync, nome: string): Projeto | undefined {
  banco.exec("BEGIN");
  try {
    return ler(banco, nome);
  } finally {
    banco.exec("COMMIT");
  }
}

/** Insere cada item de `itens` na `tabela`, com as colunas de `colunas` (nomes iguais às chaves do item). */
function inserir(banco: DatabaseSync, tabela: string, nome: string, colunas: string[], itens: Linha[]): void {
  const insert = banco.prepare(
    `INSERT INTO ${tabela} (projeto, ${colunas.join(", ")}) VALUES (${["?", ...colunas.map(() => "?")].join(", ")})`,
  );
  for (const item of itens) insert.run(nome, ...colunas.map((c) => (item[c] ?? null) as SQLInputValue));
}

/**
 * Valida e substitui a configuração inteira do projeto existente numa transação só; devolve a forma canônica relida
 * antes do COMMIT. Qualquer falha reverte escalares e listas.
 */
export function gravarConfiguracaoProjeto(banco: DatabaseSync, entrada: unknown): Projeto {
  const p = Projeto.parse(entrada);
  return escrever(banco, () => {
    const { changes } = banco
      .prepare(
        `UPDATE projeto SET repo = ?, branch_base = ?, hospedagem = ?, sonar_project_key = ?, cursor_commit_humano = ?
         WHERE nome = ?`,
      )
      .run(p.raiz_git, p.branch_base, p.hospedagem, p.chave_sonarqube, p.cursor_commit_humano ?? null, p.nome);
    if (changes === 0) throw new ErroDeInexistente(`o projeto ${p.nome} não existe`, "cadastre o projeto antes");
    for (const t of [
      "glob_e2e",
      "configuracao_e2e",
      "linguagem_projeto",
      "fitness_function_projeto",
      "comando_preparacao_projeto",
      "configuracao_etapa_projeto",
    ])
      banco.prepare(`DELETE FROM ${t} WHERE projeto = ?`).run(p.nome);
    inserir(
      banco,
      "configuracao_etapa_projeto",
      p.nome,
      ["etapa", "modelo_provedor", "modelo_nome", "effort"],
      p.etapas,
    );
    inserir(banco, "comando_preparacao_projeto", p.nome, ["ordem", "comando"], p.preparacao);
    inserir(banco, "fitness_function_projeto", p.nome, ["nome", "comando", "descricao"], p.fitness);
    inserir(banco, "linguagem_projeto", p.nome, ["caminho", "linguagem", "comando_teste"], p.linguagens);
    inserir(
      banco,
      "configuracao_e2e",
      p.nome,
      ["caminho_linguagem", "comando_build", "comando_execucao", "codigo_falha"],
      p.e2e,
    );
    inserir(banco, "glob_e2e", p.nome, ["caminho_linguagem", "glob"], p.globs);
    return Projeto.parse(ler(banco, p.nome)); // revalida a releitura; nunca é `undefined` aqui (há ao menos uma linguagem)
  });
}
