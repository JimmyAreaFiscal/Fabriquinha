// Um comando por fitness function do projeto, com cwd na worktree.
import type { Projeto } from "../../nucleo/projeto.ts";
import {
  aprovacao,
  classificarComando,
  comAmbienteSemCredenciais,
  type ContextoDaVerificacao,
  type Falha,
  linhaDoComando,
  type RegistroDaVerificacao,
  VerificacaoComRegistro,
} from "./verificacao.ts";

export class VerificacaoDeFitness extends VerificacaoComRegistro {
  readonly tipo = "fitness";
  readonly #projeto: Projeto;

  constructor(projeto: Projeto) {
    super();
    this.#projeto = projeto;
  }

  coletar({ worktree, limiteMs }: ContextoDaVerificacao): Promise<RegistroDaVerificacao> {
    return comAmbienteSemCredenciais(limiteMs, async (rodar) => {
      const linhas = [];
      const logs = [];
      const falhas: Falha[] = [];
      for (const f of this.#projeto.verificacoes.fitness) {
        const r = await rodar(f.comando, worktree);
        const nomeDoLog = `${f.nome}.log`;
        linhas.push({ ...f, ...linhaDoComando(f.comando, r, nomeDoLog) });
        logs.push({ nome: nomeDoLog, texto: r.log });
        const falha = classificarComando(f.comando, r);
        if (falha) falhas.push(falha);
      }
      return { tipo: "matriz_fitness", passou: aprovacao(falhas), falhas, dados: { linhas }, logs };
    });
  }
}
