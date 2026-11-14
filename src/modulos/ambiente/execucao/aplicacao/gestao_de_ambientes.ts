// A gestão dos Ambientes (CONCEITOS.md §7), a única entrada do domínio: quem monta entrega a Configuração do Ambiente, o
// banco do inventário e o que o serviço sabe de si; a montagem confere o conjunto com o docker na subida e liga a
// eliminação dos ociosos, que `parar` desliga. Quem pede um Ambiente recebe o do host local ou o container alocado do
// conjunto, que executa, lança e sinaliza nele. Ambiente não conhece demandas, tickets nem etapas: o ocupante é opaco.
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import {
  type AmbienteGravado,
  ConjuntoDeSandboxes,
  GeradorDeAmbientes,
  type OcupanteDoAmbiente,
  type ProjetoDoAmbiente,
  type ServicoDoConjunto,
  type SituacaoDoAmbiente,
} from "../../sandboxes/publico.ts";
import type { Ambiente } from "../infra/ambiente.ts";
import { AmbienteContainer } from "../infra/container/ambiente_container.ts";
import { AmbienteHostLocal } from "../infra/host_local/ambiente_host_local.ts";

/** De quanto em quanto tempo a gestão procura os containers ociosos para eliminar. */
const INTERVALO_DA_ELIMINACAO_DE_OCIOSOS_MS = 60_000;

/** O que quem monta a gestão entrega a ela. */
export interface MontagemDaGestaoDeAmbientes {
  /** O banco do inventário dos containers (tabela `ambiente`). */
  banco: DatabaseSync;
  /**
   * A Configuração do Ambiente de quem monta, perguntada a cada uso: a mudança pela tela vale na pergunta seguinte, sem
   * remontar (remontar conferiria o conjunto de novo e limparia os containers em uso).
   */
  configuracao: () => ConfiguracaoDoAmbiente;
  servico: ServicoDoConjunto;
  relogio?: Relogio;
  /** Para onde vão as falhas do trabalho de fundo (a conferência da subida e a eliminação dos ociosos). */
  registrarErro: (erro: unknown) => void;
}

/** Os Ambientes onde o trabalho roda: o host local do serviço ou os containers do conjunto. */
export interface GestaoDeAmbientes {
  /**
   * O conjunto de containers da Fabriquinha, do mais antigo ao mais novo, com o uso medido de cada um numa chamada só ao
   * docker; o medido fica de fora no `host_local`, que nunca chama o docker, e quando o docker não responde.
   */
  listar(): Promise<SituacaoDoAmbiente[]>;
  /**
   * O Ambiente em que o ocupante passa a rodar. No `container`, o do conjunto: o que ele já tem, um livre da imagem do
   * projeto ou um novo; na capacidade e sem parado que ceda a vaga, lança `ErroExterno`. No `host_local`, ou para o
   * projeto sem imagem do Ambiente, o do serviço.
   */
  alocar(ocupante: OcupanteDoAmbiente, projeto: ProjetoDoAmbiente): Promise<Ambiente>;
  /** O Ambiente já alocado ao `ocupante`; sem alocação, sem ocupante ou no `host_local`, o do serviço. */
  ambienteDo(ocupante?: string): Ambiente;
  /** Limpa o container `id` alocado e o devolve ao conjunto (`sujo`, se a limpeza falha); o do serviço e o não alocado ficam como estão. */
  limpar(id: string): Promise<void>;
  /** Elimina o container `id` livre ou sujo; o alocado e o desconhecido são recusados com `ErroDeRegra`. */
  deletar(id: string): Promise<void>;
  /** Desliga a eliminação dos ociosos e espera a que está em andamento. */
  parar(): Promise<void>;
}

/**
 * Monta a gestão. No `container`, antes de devolvê-la, confere o conjunto com o docker (elimina os órfãos e limpa os que o
 * reinício deixou alocados); a falha vai a `registrarErro` e fica para a próxima subida. Daí em diante, de minuto em
 * minuto, o conjunto variável elimina os ociosos enquanto o tipo for `container`.
 */
export async function montarGestaoDeAmbientes(montagem: MontagemDaGestaoDeAmbientes): Promise<GestaoDeAmbientes> {
  const gestao = new GestaoDoConjunto(montagem);
  if (montagem.configuracao().tipo === "container") await gestao.reconciliarNaSubida();
  gestao.ligarEliminacaoDeOciosos();
  return gestao;
}

class GestaoDoConjunto implements GestaoDeAmbientes {
  readonly #sandboxes: ConjuntoDeSandboxes;
  readonly #configuracao: () => ConfiguracaoDoAmbiente;
  readonly #relogio: Relogio;
  readonly #registrarErro: (erro: unknown) => void;
  readonly #doServico = new AmbienteHostLocal();
  #relogioDaEliminacao: NodeJS.Timeout | undefined;
  /** A eliminação dos ociosos em andamento: no máximo uma, e o `parar` a espera. */
  #eliminacaoEmAndamento: Promise<void> | undefined;

  constructor({
    banco,
    configuracao,
    servico,
    relogio = relogioDoSistema,
    registrarErro,
  }: MontagemDaGestaoDeAmbientes) {
    this.#sandboxes = new ConjuntoDeSandboxes(banco, new GeradorDeAmbientes(), configuracao, servico, relogio);
    this.#configuracao = configuracao;
    this.#relogio = relogio;
    this.#registrarErro = registrarErro;
  }

  get #ehContainer(): boolean {
    return this.#configuracao().tipo === "container";
  }

  listar(): Promise<SituacaoDoAmbiente[]> {
    return this.#sandboxes.listar();
  }

  async alocar(ocupante: OcupanteDoAmbiente, projeto: ProjetoDoAmbiente): Promise<Ambiente> {
    const { imagem_do_ambiente } = projeto;
    if (!this.#ehContainer || imagem_do_ambiente === undefined) return this.#doServico;
    const container = this.#comoAmbienteContainer(
      await this.#sandboxes.alocar(ocupante, { ...projeto, imagem_do_ambiente }),
    );
    container.levarEnvDoProjeto(projeto.raiz_git);
    return container;
  }

  ambienteDo(ocupante?: string): Ambiente {
    const alocado = ocupante !== undefined && this.#ehContainer ? this.#sandboxes.alocacaoDe(ocupante) : undefined;
    return alocado ? this.#comoAmbienteContainer(alocado) : this.#doServico;
  }

  async limpar(id: string): Promise<void> {
    if (id !== this.#doServico.id) await this.#sandboxes.limpar(id);
  }

  deletar(id: string): Promise<void> {
    return this.#sandboxes.eliminar(id);
  }

  async parar(): Promise<void> {
    clearInterval(this.#relogioDaEliminacao);
    await this.#eliminacaoEmAndamento;
  }

  reconciliarNaSubida(): Promise<void> {
    return this.#sandboxes.reconciliarNaSubida().catch(this.#registrarErro);
  }

  ligarEliminacaoDeOciosos(): void {
    // A batida nunca lança: a falha (até a de ler a Configuração) vai a `registrarErro`, e a batida seguinte roda.
    this.#relogioDaEliminacao = setInterval(() => {
      try {
        if (!this.#ehContainer || this.#eliminacaoEmAndamento) return;
        this.#eliminacaoEmAndamento = this.#sandboxes
          .eliminarOciosos(this.#relogio.agora())
          .catch(this.#registrarErro)
          .finally(() => {
            this.#eliminacaoEmAndamento = undefined;
          });
      } catch (erro) {
        this.#registrarErro(erro);
      }
    }, INTERVALO_DA_ELIMINACAO_DE_OCIOSOS_MS);
    // O relógio não segura o processo: quem o mantém vivo é o servidor; os testes que não param a gestão terminam.
    this.#relogioDaEliminacao.unref();
  }

  #comoAmbienteContainer({ id, container_id }: Pick<AmbienteGravado, "id" | "container_id">): AmbienteContainer {
    const { raiz, porta_da_api, pacote_do_harness } = this.#sandboxes.servico;
    return new AmbienteContainer({
      id,
      container_id,
      bin_do_pacote: join(pacote_do_harness, "bin"),
      raiz,
      url_da_api: `http://host.docker.internal:${String(porta_da_api)}`,
    });
  }
}
