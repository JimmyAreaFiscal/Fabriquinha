// Erros e orientação ao operador (F1 §7). A mensagem é uma frase com o que faltou e, entre parênteses, como resolver,
// para quem pediu corrigir sem adivinhar. Ex.: "o arquivo X não existe (confira o caminho)".
const frase = (problema: string, solucao: string): string => `${problema} (${solucao})`;

/** Pré-condição, schema ou invariante violada. Sem `solucao`, a mensagem é só o `problema` (um texto que a tela mostra como está). */
export class ErroDeRegra extends Error {
  override name = "ErroDeRegra";
  constructor(problema: string, solucao?: string) {
    super(solucao === undefined ? problema : frase(problema, solucao));
  }
}

/** O registro do ID pedido não existe: um ErroDeRegra que o web responde com 404. */
export class ErroDeInexistente extends ErroDeRegra {
  override name = "ErroDeInexistente";
}

/**
 * Uma verificação automática (testes, fitness, SonarQube, hooks do commit) reprovou o código: quem o escreveu recebe
 * a reprovação para corrigir, em vez de a operação falhar.
 */
export class ErroDeReprovacao extends ErroDeRegra {
  override name = "ErroDeReprovacao";
}

/** Um comando de fora (`gh`, `az`) falhou ou respondeu o que não se esperava: um ErroDeRegra que o web responde com 502. */
export class ErroExterno extends ErroDeRegra {
  override name = "ErroExterno";
}

/** Quem pede não tem permissão para o comando. */
export class ErroDeEscopo extends Error {
  override name = "ErroDeEscopo";
  constructor(problema: string, solucao: string) {
    super(frase(problema, solucao));
  }
}

/** `valor`, ou ErroDeRegra se ele não existe. */
export function existe<T>(valor: T | undefined, problema: string, solucao: string): T {
  if (valor === undefined) throw new ErroDeRegra(problema, solucao);
  return valor;
}

/** `valor`, ou ErroDeInexistente se o ID pedido não existe. */
export function encontrado<T>(valor: T | undefined, problema: string, solucao: string): T {
  if (valor === undefined) throw new ErroDeInexistente(problema, solucao);
  return valor;
}

/** O texto de qualquer coisa lançada: um `throw` que não é `Error` também vira falha, nunca sucesso. */
export const mensagem = (erro: unknown): string => (erro instanceof Error ? erro.message : String(erro));
