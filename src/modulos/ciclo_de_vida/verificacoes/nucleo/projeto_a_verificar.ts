// O que as Verificações leem da configuração do projeto, que chega como dado (MELHORIAS §11, regra 2): o Ciclo de Vida
// não importa o cadastro do projeto, e o Projeto cadastrado já tem esta forma.

/** O E2E de uma linguagem: build e execução na pasta dela; só `codigo_falha` reprova. */
export interface ConfiguracaoE2E {
  caminho_linguagem: string;
  comando_build: string;
  comando_execucao: string;
  codigo_falha: number;
}

export interface ProjetoAVerificar {
  chave_sonarqube: string;
  verificacoes: {
    fitness: readonly { nome: string; comando: string; descricao: string }[];
    linguagens: readonly { caminho: string; linguagem: string; comando_teste: string }[];
    e2e: readonly ConfiguracaoE2E[];
    /** Os arquivos que, alterados, fazem rodar o E2E da linguagem. */
    globs: readonly { caminho_linguagem: string; glob: string }[];
  };
}
