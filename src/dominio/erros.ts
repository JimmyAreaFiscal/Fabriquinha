// Erros do domínio (F1 §7). A mensagem é uma frase com o que faltou e, entre parênteses, como resolver,
// para o agente corrigir sem adivinhar. Ex.: "T-34 não pode concluir: falta a evidência X (submeta com …)".
const frase = (problema: string, solucao: string): string => `${problema} (${solucao})`;

/** Pré-condição, schema ou invariante violada. */
export class ErroDeRegra extends Error {
  override name = "ErroDeRegra";
  constructor(problema: string, solucao: string) {
    super(frase(problema, solucao));
  }
}

/** O ator não pode pedir o comando. */
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

/** O texto de qualquer coisa lançada: um `throw` que não é `Error` também vira falha, nunca sucesso. */
export const mensagem = (erro: unknown): string => (erro instanceof Error ? erro.message : String(erro));
