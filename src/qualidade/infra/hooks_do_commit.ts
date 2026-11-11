// Os hooks do repositório rodam dentro do `git commit`; esta Verificação traz o erro que o commit lança para o
// resultado de três classes. Não gera Evidência.
import { ErroDeReprovacao, ErroExterno } from "../../compartilhado/nucleo/erros.ts";
import { type FalhaDaTentativa, resultadoDoErro } from "../../sdlc/nucleo/tentativa.ts";
import type { ResultadoDaVerificacao } from "../nucleo/verificacao.ts";
import { type ContextoDaVerificacao, Verificacao } from "./verificacao.ts";

export class HooksDoCommit extends Verificacao {
  readonly tipo = "hooks_do_commit";
  readonly #fazerCommit: (contexto: ContextoDaVerificacao) => Promise<unknown>;

  constructor(fazerCommit: (contexto: ContextoDaVerificacao) => Promise<unknown>) {
    super();
    this.#fazerCommit = fazerCommit;
  }

  /** Só o erro de reprovação ou externo do commit vira resultado; qualquer outro propaga. */
  async executar(contexto: ContextoDaVerificacao): Promise<ResultadoDaVerificacao> {
    try {
      await this.#fazerCommit(contexto);
      return { tipo: "passou" };
    } catch (erro) {
      if (!(erro instanceof ErroDeReprovacao || erro instanceof ErroExterno)) throw erro;
      const resultado = resultadoDoErro(erro);
      // O erro externo sempre vira falha de infraestrutura em `resultadoDoErro`.
      return resultado.tipo === "reprovacao"
        ? { ...resultado, log: "" }
        : (resultado as Extract<FalhaDaTentativa, { tipo: "falha_infraestrutura" }>);
    }
  }
}
