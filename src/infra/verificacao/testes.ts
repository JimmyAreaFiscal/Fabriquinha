// Os testes de cada linguagem do projeto em `join(worktree, caminho)` e, se a rodada pede e algum arquivo casa, o E2E dela:
// um só registro `execucao_testes`.
import { join, matchesGlob } from "node:path";
import type { Projeto } from "../../nucleo/projeto.ts";
import { VerificacaoE2E } from "./e2e.ts";
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

/** @testes tipo que o teste usa para montar a entrada */
export interface EntradaDeTestes {
  projeto: Projeto;
  /** A rodada está marcada com e2e. */
  e2e: boolean;
  /** Arquivos alterados da worktree, relativos à raiz; decidem se o E2E roda. */
  arquivos: readonly string[];
  /** Chamada depois dos testes das linguagens e antes do E2E: o lcov que o Sonar já lê está gravado. */
  aoTerminarAsLinguagens?: () => void;
}

export class VerificacaoDeTestes extends VerificacaoComRegistro {
  readonly tipo = "testes";
  readonly #entrada: EntradaDeTestes;

  constructor(entrada: EntradaDeTestes) {
    super();
    this.#entrada = entrada;
  }

  coletar({ ambiente, worktree, limiteMs }: ContextoDaVerificacao): Promise<RegistroDaVerificacao> {
    const { projeto, e2e, arquivos, aoTerminarAsLinguagens } = this.#entrada;
    return comAmbienteSemCredenciais(ambiente, limiteMs, async (rodar) => {
      const comandos: Record<string, unknown>[] = [];
      const logs = [];
      const falhas: Falha[] = [];
      for (const { caminho, comando_teste: comando } of projeto.verificacoes.linguagens) {
        const r = await rodar(comando, join(worktree, caminho));
        const nomeDoLog = `teste-${caminho}.log`;
        comandos.push({ ...linhaDoComando(comando, r, nomeDoLog), caminho });
        logs.push({ nome: nomeDoLog, texto: r.log });
        const falha = classificarComando(comando, r);
        if (falha) falhas.push(falha);
      }
      aoTerminarAsLinguagens?.();
      for (const config of e2e ? projeto.verificacoes.e2e : []) {
        const globs = projeto.verificacoes.globs.filter((g) => g.caminho_linguagem === config.caminho_linguagem);
        if (!arquivos.some((a) => globs.some((g) => matchesGlob(a, g.glob)))) continue;
        const doE2E = await new VerificacaoE2E(config).rodarComandos(rodar, worktree);
        comandos.push(...doE2E.comandos);
        logs.push(...doE2E.logs);
        falhas.push(...doE2E.falhas);
      }
      return { tipo: "execucao_testes", passou: aprovacao(falhas), falhas, dados: { comandos }, logs };
    });
  }
}
