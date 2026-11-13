// O ciclo do Espaço de Trabalho (CONCEITOS.md §7): criar, atualizar com a base, integrar e limpar num lugar só. Combina o
// Git, o Espaço de Trabalho e a Hospedagem, que não têm regra de SDLC, com o Ambiente onde o Espaço roda. Integrar o PR
// da rodada é operação daqui; o PR final, só o humano integra.
import { ErroDeRegra, existe, mensagem } from "../../../../shared/nucleo/erros.ts";
import type { Ambiente, GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import {
  atualizarWorktreeRodada,
  espacoDaDemanda,
  type EspacoDeTrabalho,
  garantirWorktreeDemandaDizendoSeBuscouBase,
  garantirWorktreeRodada,
  gestaoDeAmbientes,
  limparDemanda,
  ocupanteDoAmbiente,
  ocupanteDoDono,
  pendenciasDoEspaco,
  type ResultadoAtualizacao,
} from "../../espaco_de_trabalho/publico.ts";
import { exigirGit, exigirGitNoAmbiente, naFilaDoProjeto, type ProjetoDoRepositorio } from "../../git/publico.ts";
import { integrarPR } from "../../hospedagem/publico.ts";
import { anotar } from "../../../../shared/infra/registro.ts";

/** O Projeto como o ciclo o lê: o repositório e, se houver, a imagem do Ambiente que o conjunto aloca ao Espaço. */
type ProjetoDoCiclo = ProjetoDoRepositorio & { imagem_do_ambiente?: string };

/** Onde o ciclo grava: a raiz da Fabriquinha (worktrees e fila git) e o log da operação. */
interface RegistroDoCiclo {
  raiz: string;
  log: string;
}

abstract class CicloDoEspaco {
  protected readonly espaco: EspacoDeTrabalho;
  protected readonly projeto: ProjetoDoCiclo;
  protected readonly registro: RegistroDoCiclo;
  /** Onde roda tudo o que é do Espaço; quem trabalha nele (commit, verificações, pi) usa este. Depois de alocar, é o alocado. */
  ambiente: Ambiente;
  readonly #ambientes: GestaoDeAmbientes;

  constructor(
    espaco: EspacoDeTrabalho,
    projeto: ProjetoDoCiclo,
    registro: RegistroDoCiclo,
    ambiente: Ambiente,
    ambientes: GestaoDeAmbientes = gestaoDeAmbientes(),
  ) {
    this.espaco = espaco;
    this.projeto = projeto;
    this.registro = registro;
    this.ambiente = ambiente;
    this.#ambientes = ambientes;
  }

  /** Aloca ao Espaço o Ambiente em que ele roda: o container do conjunto ou, no host local ou sem imagem do Ambiente, o do serviço. */
  protected async alocarAmbiente(): Promise<void> {
    this.ambiente = await this.#ambientes.alocar(
      ocupanteDoAmbiente(this.espaco, this.registro.raiz, this.projeto.nome),
      this.projeto,
    );
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
    // O Ambiente só volta ao conjunto quando o Espaço acabou de verdade; com pendência, a repetição do limpar o libera.
    if (resultado.pendentes.length === 0)
      await this.#ambientes.limpar(this.#ambientes.ambienteDo(ocupanteDoDono(this.espaco.dono)).id);
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
    await this.alocarAmbiente();
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
      // No clone, e não na worktree: o Ambiente do Espaço controla o `.git` da worktree, e o fetch roda com as credenciais do core.
      await exigirGit(this.projeto.raiz_git, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
      await exigirGitNoAmbiente(this.ambiente, demanda, "merge", "--ff-only", `refs/remotes/origin/${branch}`);
    });
  }
}

/** PR final, integrado pelo humano na plataforma: a Fabriquinha só cria e limpa. @testes o teste a instancia direto; a produção a cria por `cicloDoEspaco` */
export class CicloDoEspacoDaDemanda extends CicloDoEspaco {
  async criar() {
    await this.alocarAmbiente();
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
