// O conjunto compartilhado de Ambientes em container (CONCEITOS.md §7 e §13): aloca um container a cada Espaço de
// Trabalho (exclusivo enquanto roda), limpa e devolve ao conjunto quando o Espaço acaba e elimina os que ficam ociosos.
// O banco diz quem é de quem; o `GeradorDeAmbientes` é o único que mexe nos containers.
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { ErroDeRegra, existe } from "../../nucleo/erros.ts";
import type { EspacoDeTrabalho } from "../../nucleo/espaco_de_trabalho.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import type { Instante } from "../../nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../nucleo/relogio.ts";
import {
  type AmbienteGravado,
  alocarAmbienteLivreDaImagem,
  buscarAmbienteAlocadoPara,
  eliminarAmbiente,
  inserirAmbienteAlocado,
  liberarAmbiente,
  listarAmbientes,
  reservarAmbienteParaEliminar,
} from "../../armazenamento/ambientes.ts";
import { configuracaoDoAmbiente } from "../../armazenamento/servico.ts";
import { PACOTE } from "../../infra/agente/pi.ts";
import { AmbienteContainer, dirDoPiDoAmbiente } from "../../infra/ambiente/container/ambiente_container.ts";
import type { GeradorDeAmbientes } from "../../infra/ambiente/container/gerador_de_ambientes.ts";

const MS_POR_MINUTO = 60_000;

/** O que o conjunto precisa saber do serviço para montar o `AmbienteContainer`: a raiz da Fabriquinha e a porta da API do agente. */
interface ServicoDoConjunto {
  raiz: string;
  porta_da_api: number;
}

function comoAmbienteContainer(
  { id, container_id }: Pick<AmbienteGravado, "id" | "container_id">,
  { raiz, porta_da_api }: ServicoDoConjunto,
): AmbienteContainer {
  return new AmbienteContainer({
    id,
    container_id,
    bin_do_pacote: join(PACOTE, "bin"),
    dir_do_pi: dirDoPiDoAmbiente(raiz, id),
    url_da_api: `http://host.docker.internal:${String(porta_da_api)}`,
  });
}

export class ConjuntoDeAmbientes {
  readonly #banco: DatabaseSync;
  readonly #gerador: GeradorDeAmbientes;
  readonly #relogio: Relogio;
  /** Sem ele o conjunto só elimina containers (a tela de Configuração com `host_local`); `alocar` exige. */
  readonly #servico: ServicoDoConjunto | undefined;

  constructor(
    banco: DatabaseSync,
    gerador: GeradorDeAmbientes,
    relogio: Relogio = relogioDoSistema,
    servico?: ServicoDoConjunto,
  ) {
    this.#banco = banco;
    this.#gerador = gerador;
    this.#relogio = relogio;
    this.#servico = servico;
  }

  /** O Ambiente do container que o Espaço já tem alocado, ou `undefined`. */
  ambienteAlocadoPara(espaco: EspacoDeTrabalho): AmbienteContainer | undefined {
    const alocado = buscarAmbienteAlocadoPara(this.#banco, espaco.dono.toString());
    return alocado && comoAmbienteContainer(alocado, this.#servicoObrigatorio());
  }

  /** Dá ao Espaço um livre da mesma imagem ou, sem nenhum, um container novo; o Espaço que já tem um recebe o mesmo. */
  async alocar(
    espaco: EspacoDeTrabalho,
    projeto: Pick<Projeto, "nome" | "raiz_git" | "imagem_do_ambiente">,
  ): Promise<AmbienteContainer> {
    const servico = this.#servicoObrigatorio(); // antes de criar qualquer container
    const alocadoPara = espaco.dono.toString();
    const imagemDoProjeto = projeto.imagem_do_ambiente;
    if (imagemDoProjeto === undefined)
      throw new ErroDeRegra(
        `o projeto ${projeto.nome} não tem imagem do Ambiente`,
        "informe a imagem do Ambiente na Configuração do projeto",
      );
    const imagem = await this.#gerador.garantirImagem({
      nome: projeto.nome,
      raiz_git: projeto.raiz_git,
      imagem_do_ambiente: imagemDoProjeto,
    });
    // Tudo daqui até o retorno é síncrono, então dois alocar ao mesmo tempo nunca pegam o mesmo livre.
    const jaAlocado = buscarAmbienteAlocadoPara(this.#banco, alocadoPara);
    if (jaAlocado) return comoAmbienteContainer(jaAlocado, servico);
    const livreReaproveitado = alocarAmbienteLivreDaImagem(this.#banco, imagem, alocadoPara);
    if (livreReaproveitado) return comoAmbienteContainer(livreReaproveitado, servico);
    return comoAmbienteContainer(await this.#criarAlocado(imagem, alocadoPara), servico);
  }

  /** Limpa o container do Espaço e o devolve ao conjunto: `livre` se a limpeza deu certo, `sujo` se não. */
  async liberar(espaco: EspacoDeTrabalho): Promise<void> {
    const ambiente = buscarAmbienteAlocadoPara(this.#banco, espaco.dono.toString());
    if (!ambiente) return;
    let estadoDepoisDaLiberacao: "livre" | "sujo" = "livre";
    try {
      await this.#gerador.limpar(ambiente);
    } catch {
      estadoDepoisDaLiberacao = "sujo";
    }
    liberarAmbiente(this.#banco, ambiente.id, estadoDepoisDaLiberacao, this.#relogio.agora());
  }

  /** Elimina um container do conjunto; só vale para o `livre` ou `sujo`, nunca para o que um Espaço está usando. */
  async eliminar(id: string): Promise<void> {
    const reservado = reservarAmbienteParaEliminar(this.#banco, id);
    if (reservado) return this.#eliminarContainerReservado(reservado);
    const ambiente = listarAmbientes(this.#banco).find((candidato) => candidato.id === id);
    if (!ambiente) throw new ErroDeRegra(`o ambiente ${id} não existe`, "confira o id do ambiente");
    throw new ErroDeRegra(`o ambiente ${id} está alocado a ${String(ambiente.alocado_para)}`, "espere o Espaço acabar");
  }

  /** Elimina os `livre` e `sujo` parados há mais de `ociosidade_para_eliminar_min`. */
  async eliminarOciosos(agora: Instante): Promise<void> {
    const limiteMs = configuracaoDoAmbiente(this.#banco).ociosidade_para_eliminar_min * MS_POR_MINUTO;
    // Reserva todos de uma vez, sem esperar o docker, para um `alocar` não pegar um ocioso no meio do caminho.
    const reservados = listarAmbientes(this.#banco)
      .filter(
        ({ estado, liberado_em }) =>
          estado !== "alocado" && liberado_em !== null && Date.parse(agora) - Date.parse(liberado_em) >= limiteMs,
      )
      .map(({ id }) => reservarAmbienteParaEliminar(this.#banco, id))
      .filter((reservado) => reservado !== undefined);
    for (const reservado of reservados) await this.#eliminarContainerReservado(reservado);
  }

  /**
   * Confere o banco com o docker na subida: container com o rótulo que o banco não conhece é órfão e é eliminado; linha
   * do banco cujo container sumiu vira `eliminado`. O que não tem o rótulo nem aparece, porque a listagem só traz os da
   * Fabriquinha.
   */
  async reconciliarNaSubida(): Promise<void> {
    const noDocker = await this.#gerador.listarDaFabriquinha();
    const noBanco = listarAmbientes(this.#banco);
    const containersDoBanco = new Set(noBanco.map(({ container_id }) => container_id));
    const containersDoDocker = new Set(noDocker.map(({ container_id }) => container_id));
    for (const orfao of noDocker.filter(({ container_id }) => !containersDoBanco.has(container_id)))
      await this.#gerador.eliminar(orfao);
    for (const sumido of noBanco.filter(({ container_id }) => !containersDoDocker.has(container_id)))
      eliminarAmbiente(this.#banco, sumido.id);
  }

  #servicoObrigatorio(): ServicoDoConjunto {
    return existe(
      this.#servico,
      "o conjunto de Ambientes não conhece a raiz da Fabriquinha",
      "monte o conjunto pela composição do serviço",
    );
  }

  async #criarAlocado(imagem: string, alocadoPara: string): Promise<AmbienteGravado> {
    const criado = await this.#gerador.criar(imagem, configuracaoDoAmbiente(this.#banco));
    const alocado: AmbienteGravado = {
      ...criado,
      imagem,
      estado: "alocado",
      alocado_para: alocadoPara,
      criado_em: this.#relogio.agora(),
      liberado_em: null,
    };
    try {
      inserirAmbienteAlocado(this.#banco, { ...alocado, alocado_para: alocadoPara });
    } catch (erro) {
      await this.#gerador.eliminar(criado); // sem linha no banco o container ficaria fora do controle
      throw erro;
    }
    return alocado;
  }

  // A linha já está `eliminado` (reservada). Se o docker falhar aqui, o container fica órfão com o rótulo e a
  // `reconciliarNaSubida` seguinte o elimina.
  async #eliminarContainerReservado(reservado: AmbienteGravado): Promise<void> {
    await this.#gerador.eliminar(reservado);
  }
}
