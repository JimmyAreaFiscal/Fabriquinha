# Regras de boas práticas de codificação para o projeto

1. Os nomes das funções e das variáveis deve ser intuitivo, informando para que servem no próprio nome. Nomes genéricos e/ou predicados são um péssimo comportamento e não devem ser utilizados.

Código ruim: 
```
// Falhas de disco também precisam orientar o operador, sem mascarar erros de regra/Git.
async function comOrientacao<T>(trabalho: () => Promise<T>): Promise<T> {
  try {
    return await trabalho();
  } catch (erro) {
    if (erro instanceof ErroDeRegra) throw erro;
    throw new ErroDeRegra(String(erro), "verifique permissões e metadados da worktree antes de tentar novamente");
  }
}
```
Good Code:
``` 
// Cria-se uma função para que falhas de disco também orientem o operador, sem mascarar erros de regra/Git.
async function throwErroComOrientacao<T>(funcaoComcomandoGit: () => Promise<T>): Promise<T> {
  try {
    return await funcaoComcomandoGit();
  } catch (erro) {
    if (erro instanceof ErroDeRegra) throw erro;
    throw new ErroDeRegra(String(erro), "verifique permissões e metadados da worktree antes de tentar novamente");
  }
}