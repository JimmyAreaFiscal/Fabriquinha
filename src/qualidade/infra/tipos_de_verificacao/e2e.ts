// O E2E de uma linguagem do projeto: build e execução, na pasta dela. Só o `codigo_falha` reprova; outra saída é infraestrutura.
import { join } from "node:path";
import type { Projeto } from "../../../ambiente/nucleo/projeto.ts";
import {
  aprovacao,
  classificarComando,
  type ComandoRodar,
  type ComandosRodados,
  comAmbienteSemCredenciais,
  type ContextoDaVerificacao,
  linhaDoComando,
  type RegistroDaVerificacao,
  VerificacaoComRegistro,
} from "../verificacao.ts";

type ConfiguracaoE2E = Projeto["verificacoes"]["e2e"][number];

export class VerificacaoE2E extends VerificacaoComRegistro {
  readonly tipo = "e2e";
  readonly #configuracao: ConfiguracaoE2E;

  constructor(configuracao: ConfiguracaoE2E) {
    super();
    this.#configuracao = configuracao;
  }

  /** O build reprovado ou quebrado não deixa a execução rodar. */
  async rodarComandos(rodar: ComandoRodar, worktree: string): Promise<ComandosRodados> {
    const { caminho_linguagem: caminho, comando_build, comando_execucao, codigo_falha } = this.#configuracao;
    const cwd = join(worktree, caminho);
    const nome = `e2e-${caminho}`;
    const comandos = [];
    const logs = [];
    const build = await rodar(comando_build, cwd);
    const logDoBuild = `${nome}-build.log`;
    comandos.push({ ...linhaDoComando(comando_build, build, logDoBuild), caminho });
    logs.push({ nome: logDoBuild, texto: build.log });
    const falhaDoBuild = classificarComando(comando_build, build);
    if (falhaDoBuild) return { comandos, logs, falhas: [falhaDoBuild] };
    const execucao = await rodar(comando_execucao, cwd);
    const logDaExecucao = `${nome}.log`;
    comandos.push({ ...linhaDoComando(comando_execucao, execucao, logDaExecucao), caminho });
    logs.push({ nome: logDaExecucao, texto: execucao.log });
    const falhaDaExecucao = classificarComando(comando_execucao, execucao, codigo_falha);
    return { comandos, logs, falhas: falhaDaExecucao ? [falhaDaExecucao] : [] };
  }

  coletar({ ambiente, worktree, limiteMs }: ContextoDaVerificacao): Promise<RegistroDaVerificacao> {
    return comAmbienteSemCredenciais(ambiente, limiteMs, async (rodar) => {
      const { comandos, logs, falhas } = await this.rodarComandos(rodar, worktree);
      return { tipo: "execucao_testes", passou: aprovacao(falhas), falhas, dados: { comandos }, logs };
    });
  }
}
