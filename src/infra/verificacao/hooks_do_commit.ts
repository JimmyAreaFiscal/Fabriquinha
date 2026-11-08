// Os hooks do repositório rodam dentro do `git commit`; esta Verificação traz o erro que o commit lança para o
// resultado de três classes. Não gera Evidência: o registro de `coletar` não existe para ela.
import { ErroDeReprovacao, ErroExterno } from "../../nucleo/erros.ts";
import { type FalhaDaTentativa, resultadoDoErro } from "../../nucleo/tentativa.ts";
import type { ResultadoDaVerificacao } from "../../nucleo/verificacao.ts";
import { type ContextoDaVerificacao, type RegistroDaVerificacao, Verificacao } from "./verificacao.ts";

export class HooksDoCommit extends Verificacao {
  readonly tipo = "hooks_do_commit";
  readonly #fazerCommit: (contexto: ContextoDaVerificacao) => Promise<unknown>;

  constructor(fazerCommit: (contexto: ContextoDaVerificacao) => Promise<unknown>) {
    super();
    this.#fazerCommit = fazerCommit;
  }

  coletar(): Promise<RegistroDaVerificacao> {
    return Promise.reject(new Error("os hooks do commit não geram Evidência: use executar"));
  }

  /** Só o erro de reprovação ou externo do commit vira resultado; qualquer outro propaga. */
  override async executar(contexto: ContextoDaVerificacao): Promise<ResultadoDaVerificacao> {
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
