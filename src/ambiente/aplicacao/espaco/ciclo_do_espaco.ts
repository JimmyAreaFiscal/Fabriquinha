// O ciclo do Espaço de Trabalho (CONCEITOS.md §7): criar, atualizar com a base, integrar e limpar num lugar só. Compõe as
// operações git e de hospedagem de infra/repositorio, que não têm regra de SDLC.
import { ErroDeRegra, existe, mensagem } from "../../../compartilhado/nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDaDemanda } from "../../nucleo/espaco_de_trabalho.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import type { Ambiente } from "../../infra/ambiente.ts";
import type { ConjuntoDeAmbientes } from "../conjunto_de_ambientes/conjunto.ts";
import { conjuntoDoServico } from "./ambiente_do_servico.ts";
import { limparDemanda, pendenciasDoEspaco } from "../../infra/worktree/limpeza_demanda.ts";
import { integrarPR } from "../../infra/repositorio/pr.ts";
import {
  garantirWorktreeDemandaDizendoSeBuscouBase,
  garantirWorktreeRodada,
  atualizarWorktreeRodada,
  type ResultadoAtualizacao,
} from "../../infra/worktree/worktree-demanda.ts";
import { exigirGit, exigirGitNoAmbiente, naFilaDoProjeto } from "../../infra/worktree/worktree.ts";
import { anotar } from "../../../compartilhado/infra/registro.ts";

type ProjetoDoCiclo = Pick<
  Projeto,
  "nome" | "raiz_git" | "branch_base" | "verificacoes" | "hospedagem" | "imagem_do_ambiente"
>;

/** Onde o ciclo grava: a raiz da Fabriquinha (worktrees e fila git) e o log da operação. */
interface RegistroDoCiclo {
  raiz: string;
  log: string;
}

abstract class CicloDoEspaco {
  protected readonly espaco: EspacoDeTrabalho;
  protected readonly projeto: ProjetoDoCiclo;
  protected readonly registro: RegistroDoCiclo;
  /** Onde roda tudo o que é do Espaço; quem trabalha nele (commit, verificações, pi) usa este. Depois de alocar, é o container. */
  ambiente: Ambiente;
  /** O conjunto de containers; `undefined` com o Ambiente no host local, que nunca chama o docker. */
  readonly #conjunto: ConjuntoDeAmbientes | undefined;

  constructor(
    espaco: EspacoDeTrabalho,
    projeto: ProjetoDoCiclo,
    registro: RegistroDoCiclo,
    ambiente: Ambiente,
    conjunto: ConjuntoDeAmbientes | undefined = conjuntoDoServico(),
  ) {
    this.espaco = espaco;
    this.projeto = projeto;
    this.registro = registro;
    this.ambiente = ambiente;
    this.#conjunto = conjunto;
  }

  /** Dá ao Espaço o container do Projeto e passa a rodar nele; sem conjunto ou sem imagem do Ambiente, o Espaço fica no host local. */
  protected async alocarContainerSeHouver(): Promise<void> {
    if (this.#conjunto && this.projeto.imagem_do_ambiente !== undefined) {
      const container = await this.#conjunto.alocar(this.espaco, this.projeto);
      container.levarEnvDoProjeto(this.projeto.raiz_git);
      this.ambiente = container;
    }
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
    anotar(this.registro.log, `varrerCommitsHumanos falhou: ${mensagem(erro)}`);
  };

  /**
   * Remove a worktree e as branches que a Fabriquinha criou para o Espaço; o que falhar volta em `pendentes`. Dada a
   * lista de uma passada anterior (`pendentes`), repete só ela: a posse some junto com a branch local, e uma remota que
   * falhou só é reconhecida pela lista.
   */
  async limpar(pendentes?: readonly string[]): Promise<{ removidos: string[]; pendentes: string[] }> {
    const resultado = await limparDemanda(
      this.ambiente,
      this.registro.raiz,
      this.projeto,
      pendentes ?? (await pendenciasDoEspaco(this.ambiente, this.projeto, this.espaco)),
    );
    // O container só volta ao conjunto quando o Espaço acabou de verdade; com pendência, a repetição do limpar o libera.
    if (resultado.pendentes.length === 0) await this.#conjunto?.liberar(this.espaco);
    return resultado;
  }
}

/** PR na branch da Demanda, integrado pela Fabriquinha. @testes o teste a instancia direto; a produção a cria por `cicloDoEspaco` */
export class CicloDoEspacoDaRodada extends CicloDoEspaco {
  get #rodada() {
    const { demanda_id, rodada_id } = this.espaco.dono;
    return { demanda_id, rodada_id: existe(rodada_id, "o Espaço não é de uma rodada", "use o Espaço da rodada") };
  }

  async criar() {
    await this.alocarContainerSeHouver();
    const pasta = await garantirWorktreeRodada(
      this.ambiente,
      this.registro.raiz,
      this.projeto,
      this.#rodada,
      this.registro.log,
    );
    return { pasta, buscouBase: false };
  }

  async atualizarComBase(): Promise<ResultadoAtualizacao> {
    return atualizarWorktreeRodada(this.ambiente, this.registro.raiz, this.projeto, this.#rodada, this.registro.log);
  }

  /** Integra o PR na hospedagem e avança a ref local da Demanda: o merge da hospedagem é o único commit novo dela. */
  async integrar(): Promise<void> {
    const { demanda_id } = this.espaco.dono;
    const pr = existe(this.espaco.pr, `o Espaço ${this.espaco.branch} não tem PR publicado`, "publique o PR da rodada");
    const { raiz } = this.registro;
    await integrarPR(this.projeto, String(pr.numero));
    const { pasta: demanda, branch } = espacoDaDemanda(this.projeto, demanda_id, raiz);
    await naFilaDoProjeto(raiz, this.projeto.nome, async () => {
      // No clone, e não na worktree: o container controla o `.git` da worktree, e o fetch roda com as credenciais do core.
      await exigirGit(this.projeto.raiz_git, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
      await exigirGitNoAmbiente(this.ambiente, demanda, "merge", "--ff-only", `refs/remotes/origin/${branch}`);
    });
  }
}

/** PR final, integrado pelo humano na plataforma: a Fabriquinha só cria e limpa. @testes o teste a instancia direto; a produção a cria por `cicloDoEspaco` */
export class CicloDoEspacoDaDemanda extends CicloDoEspaco {
  async criar() {
    await this.alocarContainerSeHouver();
    const { caminho, buscouBase } = await garantirWorktreeDemandaDizendoSeBuscouBase(
      this.ambiente,
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
  ambiente: Ambiente,
): CicloDoEspaco {
  return espaco.dono.rodada_id === undefined
    ? new CicloDoEspacoDaDemanda(espaco, projeto, registro, ambiente)
    : new CicloDoEspacoDaRodada(espaco, projeto, registro, ambiente);
}
