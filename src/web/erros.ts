// Tradução de erros para HTTP (F7 §4.2). O corpo de erro é `{ "erro": "<mensagem>" }`, e o cliente a mostra como está.
import { z } from "zod";
import { ErroDeEscopo, ErroDeInexistente, ErroDeRegra, mensagem } from "../dominio/erros.ts";

/**
 * Erro com o status já decidido por quem o lança: a guarda (401, 403), a rota inexistente (404), o corpo inválido
 * (422) e a falha externa (502), que a rota lança com a saída do F5, do `gh` ou do `az`.
 */
export class ErroHttp extends Error {
  override name = "ErroHttp";
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

/** O status e a mensagem de qualquer erro; o que não é do F1 nem do web é falha do serviço (500). */
export function traduzir(erro: unknown): [status: number, mensagem: string] {
  if (erro instanceof ErroHttp) return [erro.status, erro.message];
  if (erro instanceof ErroDeEscopo) return [403, erro.message];
  if (erro instanceof ErroDeInexistente) return [404, erro.message];
  if (erro instanceof ErroDeRegra) return [409, erro.message];
  if (erro instanceof z.ZodError) return [422, z.prettifyError(erro)];
  return [500, mensagem(erro)];
}
