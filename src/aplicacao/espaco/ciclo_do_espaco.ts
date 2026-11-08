// O ciclo do Espaço de Trabalho (CONCEITOS.md §7): criar, atualizar com a base, integrar e limpar num lugar só. Compõe as
// operações git e de hospedagem de infra/repositorio, que não têm regra de SDLC.
import { ErroDeRegra, existe, mensagem } from "../../nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDaDemanda } from "../../nucleo/espaco_de_trabalho.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import { limparDemanda, pendenciasDoEspaco } from "../../infra/repositorio/limpeza_demanda.ts";
import { integrarPR } from "../../infra/repositorio/pr.ts";
import {
  garantirWorktreeDemandaDizendoSeBuscouBase,
  garantirWorktreeRodada,
  atualizarWorktreeRodada,
  type ResultadoAtualizacao,
} from "../../infra/repositorio/worktree-demanda.ts";
import { exigirGit, naFilaDoProjeto } from "../../infra/repositorio/worktree.ts";
import { anotar } from "../../infra/registro.ts";

type ProjetoDoCiclo = Pick<Projeto, "nome" | "raiz_git" | "branch_base" | "verificacoes" | "hospedagem">;

/** Onde o ciclo grava: a raiz da Fabriquinha (worktrees e fila git) e o log da operação. */
interface RegistroDoCiclo {
  raiz: string;
  log: string;
}

abstract class CicloDoEspaco {
  protected readonly espaco: EspacoDeTrabalho;
  protected readonly projeto: ProjetoDoCiclo;
  protected readonly registro: RegistroDoCiclo;

  constructor(espaco: EspacoDeTrabalho, projeto: ProjetoDoCiclo, registro: RegistroDoCiclo) {
    this.espaco = espaco;
    this.projeto = projeto;
    this.registro = registro;
  }

  /**
   * Garante a worktree do Espaço e a Preparação (só na primeira vez ou depois de merge que avança a HEAD). Devolve a
   * pasta e se buscou a base: quem chama varre os commits humanos depois, fora da fila git do projeto.
   */
  abstract criar(): Promise<{ pasta: string; buscouBase: boolean }>;

  abstract atualizarComBase(): Promise<ResultadoAtualizacao>;

  abstract integrar(): Promise<void>;

  /** A falha da varredura nunca falha a operação: só vai para o log. */
  readonly anotarFalhaDaVarredura = (erro: unknown): void => {
    anotar(this.registro.log, `varrerBase falhou: ${mensagem(erro)}`);
  };

  /** Remove a worktree e as branches que a Fabriquinha criou para o Espaço; o que falhar volta em `pendentes`. */
  async limpar(): Promise<{ removidos: string[]; pendentes: string[] }> {
    return limparDemanda(this.registro.raiz, this.projeto, await pendenciasDoEspaco(this.projeto, this.espaco));
  }
}

/** PR na branch da Demanda, integrado pela Fabriquinha. @testes o teste a instancia direto; a produção a cria por `cicloDoEspaco` */
export class CicloDoEspacoDaRodada extends CicloDoEspaco {
  get #rodada() {
    const { demanda_id, rodada_id } = this.espaco.dono;
    return { demanda_id, rodada_id: existe(rodada_id, "o Espaço não é de uma rodada", "use o Espaço da rodada") };
  }

  async criar() {
    const pasta = await garantirWorktreeRodada(this.registro.raiz, this.projeto, this.#rodada, this.registro.log);
    return { pasta, buscouBase: false };
  }

  async atualizarComBase(): Promise<ResultadoAtualizacao> {
    return atualizarWorktreeRodada(this.registro.raiz, this.projeto, this.#rodada, this.registro.log);
  }

  /** Integra o PR na hospedagem e avança a ref local da Demanda: o merge da hospedagem é o único commit novo dela. */
  async integrar(): Promise<void> {
    const { demanda_id } = this.espaco.dono;
    const pr = existe(this.espaco.pr, `o Espaço ${this.espaco.branch} não tem PR publicado`, "publique o PR da rodada");
    const { raiz } = this.registro;
    await integrarPR(this.projeto, String(pr.numero));
    const { pasta: demanda, branch } = espacoDaDemanda(this.projeto, demanda_id, raiz);
    await naFilaDoProjeto(raiz, this.projeto.nome, async () => {
      await exigirGit(demanda, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
      await exigirGit(demanda, "merge", "--ff-only", `refs/remotes/origin/${branch}`);
    });
  }
}

/** PR final, integrado pelo humano na plataforma: a Fabriquinha só cria e limpa. @testes o teste a instancia direto; a produção a cria por `cicloDoEspaco` */
export class CicloDoEspacoDaDemanda extends CicloDoEspaco {
  async criar() {
    const { caminho, buscouBase } = await garantirWorktreeDemandaDizendoSeBuscouBase(
      this.registro.raiz,
      this.projeto,
      this.espaco.dono.demanda_id,
      this.registro.log,
    );
    return { pasta: caminho, buscouBase };
  }

  atualizarComBase(): Promise<ResultadoAtualizacao> {
    return Promise.reject(
      new ErroDeRegra(
        `a Fabriquinha não atualiza o Espaço ${this.espaco.branch} com a base`,
        "a demanda parte da base ao ser criada; o que muda depois é decisão do humano",
      ),
    );
  }

  integrar(): Promise<void> {
    return Promise.reject(
      new ErroDeRegra(
        `a Fabriquinha não integra o PR final do Espaço ${this.espaco.branch}`,
        "o humano integra o PR final na plataforma",
      ),
    );
  }
}

/** O ciclo que cabe ao dono do Espaço: com rodada, o da rodada; sem ela, o da demanda. */
export function cicloDoEspaco(
  espaco: EspacoDeTrabalho,
  projeto: ProjetoDoCiclo,
  registro: RegistroDoCiclo,
): CicloDoEspaco {
  return espaco.dono.rodada_id === undefined
    ? new CicloDoEspacoDaDemanda(espaco, projeto, registro)
    : new CicloDoEspacoDaRodada(espaco, projeto, registro);
}
