// Gravação da configuração SDLC do projeto (comparacao-sdlc §7.1); a leitura é de `projetos.ts`. Convive com ele, que
// segue dono do formato legado; aqui só se tocam as colunas comuns e as tabelas novas. Sem coluna de posição: a ordem vem das chaves.
import { isAbsolute } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { ConfiguracaoEtapaProjeto, Projeto } from "../nucleo/configuracao_projeto.ts";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { escrever } from "./banco.ts";
import { colunasDaConfiguracaoAgente } from "./configuracao_agente.ts";
import { configuracaoProjeto, projetoExistente } from "./projetos.ts";

// A leitura é de `projetos.ts`; as telas da Configuração ainda importam daqui (fronteiras.test.ts).
export { configuracaoProjeto, etapasDoProjeto } from "./projetos.ts";

type Linha = Record<string, unknown>;

/** Insere cada item de `itens` na `tabela`, com as colunas de `colunas` (nomes iguais às chaves do item). */
function inserir(banco: DatabaseSync, tabela: string, nome: string, colunas: string[], itens: Linha[]): void {
  const insert = banco.prepare(
    `INSERT INTO ${tabela} (projeto, ${colunas.join(", ")}) VALUES (${["?", ...colunas.map(() => "?")].join(", ")})`,
  );
  for (const item of itens) insert.run(nome, ...colunas.map((c) => (item[c] ?? null) as SQLInputValue));
}

/**
 * Valida e substitui a configuração do projeto existente numa transação só; devolve a forma canônica relida antes do
 * COMMIT. Qualquer falha reverte escalares e listas. As etapas e a preparação ficam como estão: quem as edita é o
 * cadastro do projeto na Configuração (`substituirEtapasDoProjeto` e `substituirPreparacaoDoProjeto`), e as de `entrada`
 * são ignoradas.
 */
export function gravarConfiguracaoProjeto(banco: DatabaseSync, entrada: unknown): Projeto {
  const p = Projeto.parse(entrada);
  // `projeto.raiz_git` é compartilhada com o formato legado, que exige caminho absoluto: recusar antes de gravar.
  if (!isAbsolute(p.raiz_git))
    throw new ErroDeRegra(`raiz_git ${p.raiz_git} não é absoluta`, "informe um caminho absoluto");
  return escrever(banco, () => {
    projetoExistente(banco, p.nome, "cadastre o projeto antes");
    banco
      .prepare("UPDATE projeto SET raiz_git = ?, branch_base = ?, hospedagem = ?, chave_sonarqube = ? WHERE nome = ?")
      .run(p.raiz_git, p.branch_base, p.hospedagem, p.chave_sonarqube, p.nome);
    for (const t of ["glob_e2e", "configuracao_e2e", "linguagem_projeto", "fitness_function_projeto"])
      banco.prepare(`DELETE FROM ${t} WHERE projeto = ?`).run(p.nome);
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
    return Projeto.parse(configuracaoProjeto(banco, p.nome)); // revalida a releitura; nunca é `undefined` aqui (há ao menos uma linguagem)
  });
}

/** Valida e substitui só as etapas do projeto, numa transação; o resto da configuração SDLC fica como está. */
export function substituirEtapasDoProjeto(banco: DatabaseSync, nome: string, etapas: unknown): void {
  const validas = z.array(ConfiguracaoEtapaProjeto).parse(etapas);
  escrever(banco, () => {
    banco.prepare("DELETE FROM configuracao_etapa_projeto WHERE projeto = ?").run(nome);
    const linhas = validas.map(({ etapa, configuracao_agente }) => ({
      etapa,
      ...colunasDaConfiguracaoAgente(configuracao_agente),
    }));
    inserir(banco, "configuracao_etapa_projeto", nome, ["etapa", "modelo_provedor", "modelo_nome", "effort"], linhas);
  });
}

/** Substitui só a preparação do projeto, numa transação, com a ordem 1..n dos `comandos`. */
export function substituirPreparacaoDoProjeto(banco: DatabaseSync, nome: string, comandos: string[]): void {
  escrever(banco, () => {
    banco.prepare("DELETE FROM comando_preparacao_projeto WHERE projeto = ?").run(nome);
    const comandosNumerados = comandos.map((comando, indice) => ({ ordem: indice + 1, comando }));
    inserir(banco, "comando_preparacao_projeto", nome, ["ordem", "comando"], comandosNumerados);
  });
}
