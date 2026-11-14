// O conjunto compartilhado de sandboxes em container (CONCEITOS.md §7 e §13): aloca um container a cada ocupante
// (exclusivo enquanto ele o usa), limpa e devolve ao conjunto quando ele acaba e, no conjunto variável, elimina os que
// ficam ociosos até o mínimo; o fixo os mantém. Na capacidade, um parado cede a vaga ao novo e, sem parado, o conjunto
// informa a indisponibilidade (MELHORIAS §8, regra 4).
// O banco diz quem é de quem; o `GeradorDeAmbientes` é o único que cria e elimina os containers. A alocação devolvida é a
// referência que a Execução usa para rodar comandos no container.
import type { InstalacaoDoHarness } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, ErroExterno } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import {
  type AmbienteGravado,
  alocarAmbienteLivreDaImagem,
  buscarAmbienteAlocadoPara,
  eliminarAmbiente,
  inserirAmbienteAlocado,
  liberarAmbiente,
  listarAmbientes,
  reservarAmbienteParaEliminar,
} from "../armazenamento/ambientes.ts";
import type { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import type { Copias, GeradorDeAmbientes, Montagens, Recursos } from "../infra/gerador_de_ambientes.ts";
import { recolherParaOEspaco } from "../infra/pastas_do_ambiente.ts";

const MS_POR_MINUTO = 60_000;

/** O parado (livre ou sujo) que sai primeiro: o sujo, que nunca é reusado, e depois o liberado há mais tempo. */
const primeiroOSujoDepoisOMaisAntigo = (a: AmbienteGravado, b: AmbienteGravado): number =>
  Number(a.estado !== "sujo") - Number(b.estado !== "sujo") ||
  String(a.liberado_em).localeCompare(String(b.liberado_em));

const estaParado = ({ estado, liberado_em }: AmbienteGravado): boolean => estado !== "alocado" && liberado_em !== null;

/**
 * O que o conjunto precisa saber do serviço para montar o `AmbienteContainer`: a raiz da Fabriquinha, a porta da API do
 * agente, o home do usuário, de onde o container copia o `.claude` e o `.codex`, e o que o harness leva ao container: o
 * pacote dele (montado, com o `bin` à frente no PATH) e a pasta de configuração do harness do Auditor, que é copiada.
 */
export interface ServicoDoConjunto {
  raiz: string;
  porta_da_api: number;
  home_do_usuario: string;
  pacote_do_harness: string;
  /** Perguntada só ao criar um container: o host sem o harness instalado roda no host_local. */
  instalacao_do_harness: () => InstalacaoDoHarness;
  dir_do_harness_do_auditor: string;
}

/**
 * Quem pede um sandbox, como o conjunto o vê: o identificador do ocupante (o `alocado_para` do banco) e a pasta que o
 * container monta em leitura e escrita.
 */
export interface OcupanteDoAmbiente {
  /**
   * O identificador opaco do ocupante: o conjunto só o compara, o grava em `alocado_para` e nomeia com ele a pasta para
   * onde recolhe as pastas de processo na liberação; quem pede escolhe o formato.
   */
  dono: string;
  /** A pasta das worktrees do projeto: o container volta ao conjunto e serve a outro trabalho do projeto, então monta a pasta do projeto, não a de um trabalho só. */
  pasta_das_worktrees_do_projeto: string;
}

/** O que o conjunto lê do Projeto: a imagem do Ambiente, e o clone de onde ela sai e o `.env` que o container recebe. */
export interface ProjetoDoAmbiente {
  nome: string;
  raiz_git: string;
  imagem_do_ambiente?: string;
}

/** Um container do conjunto como a lista o mostra: o gravado e, no Ambiente `container`, o uso medido agora pelo docker. */
export interface SituacaoDoAmbiente extends AmbienteGravado {
  /** Ausente no `host_local`, que nunca chama o docker, ou quando o docker não responde. */
  medido?: Recursos;
}

export class ConjuntoDeSandboxes {
  readonly #banco: DatabaseSync;
  readonly #gerador: GeradorDeAmbientes;
  /** A Configuração do Ambiente de quem monta, perguntada a cada uso: a mudança pela tela vale na pergunta seguinte. */
  readonly #configuracao: () => ConfiguracaoDoAmbiente;
  readonly #relogio: Relogio;
  readonly #servico: ServicoDoConjunto;
  /** Os containers que um `alocar` está criando e que o banco ainda não tem: ocupam vaga desde a decisão de criar. */
  #criacoesEmAndamento = 0;

  constructor(
    banco: DatabaseSync,
    gerador: GeradorDeAmbientes,
    configuracao: () => ConfiguracaoDoAmbiente,
    servico: ServicoDoConjunto,
    relogio: Relogio = relogioDoSistema,
  ) {
    this.#banco = banco;
    this.#gerador = gerador;
    this.#configuracao = configuracao;
    this.#relogio = relogio;
    this.#servico = servico;
  }

  /** A alocação que o ocupante já tem, ou `undefined`. */
  alocacaoDe(ocupante: string): AmbienteGravado | undefined {
    return buscarAmbienteAlocadoPara(this.#banco, ocupante);
  }

  /**
   * O conjunto vivo, do mais antigo ao mais novo, com o uso medido de cada container numa chamada só ao docker, no
   * Ambiente `container`; no `host_local` o docker nunca é chamado. O docker que não responde só deixa o medido de fora.
   */
  async listar(): Promise<SituacaoDoAmbiente[]> {
    const gravados = listarAmbientes(this.#banco);
    if (this.#configuracao().tipo === "host_local") return gravados;
    const medidos = await this.#gerador
      .medirUso(gravados.map(({ container_id }) => container_id))
      .catch(() => new Map<string, Recursos>());
    return gravados.map((gravado) => {
      const medido = medidos.get(gravado.container_id);
      return medido ? { ...gravado, medido } : gravado;
    });
  }

  /**
   * Dá ao ocupante um livre da mesma imagem ou, sem nenhum, um container novo; o que já tem um recebe o mesmo. Na
   * capacidade, o novo toma a vaga de um parado e, sem parado, lança `ErroExterno` de indisponibilidade: quem pede decide
   * se aguarda ou reagenda (a Condução reagenda como falha de infraestrutura).
   */
  async alocar(
    { dono: alocadoPara, pasta_das_worktrees_do_projeto }: OcupanteDoAmbiente,
    projeto: Required<ProjetoDoAmbiente>,
  ): Promise<AmbienteGravado> {
    const servico = this.#servico;
    const imagem = await this.#gerador.garantirImagem(projeto);
    // Tudo daqui até o retorno é síncrono, então dois alocar ao mesmo tempo nunca pegam o mesmo livre.
    const jaAlocado = buscarAmbienteAlocadoPara(this.#banco, alocadoPara);
    if (jaAlocado) return jaAlocado;
    const livreReaproveitado = alocarAmbienteLivreDaImagem(this.#banco, imagem, alocadoPara);
    if (livreReaproveitado) return livreReaproveitado;
    const montagens: Montagens = {
      pastaDasWorktreesDoProjeto: pasta_das_worktrees_do_projeto,
      raiz_git: projeto.raiz_git,
      raiz: servico.raiz,
      pacote: servico.pacote_do_harness,
      harness: servico.instalacao_do_harness(),
    };
    const copias: Copias = { dir_do_pi: servico.dir_do_harness_do_auditor, home_do_usuario: servico.home_do_usuario };
    const paradoQueCedeAVaga = this.#reservarVagaNoConjunto();
    try {
      if (paradoQueCedeAVaga) await this.#eliminarContainerReservado(paradoQueCedeAVaga);
      return await this.#criarAlocado(imagem, alocadoPara, servico.porta_da_api, montagens, copias);
    } finally {
      this.#criacoesEmAndamento--;
    }
  }

  /**
   * Reserva a vaga do container que o `alocar` vai criar, ainda no trecho síncrono: abaixo da capacidade (ou sem ela),
   * só conta a criação; na capacidade, reserva para eliminar o parado que cede a vaga e o devolve; sem parado, lança a
   * indisponibilidade.
   */
  #reservarVagaNoConjunto(): AmbienteGravado | undefined {
    const capacidade = this.#configuracao().capacidade_do_conjunto;
    const vivos = listarAmbientes(this.#banco);
    let paradoQueCedeAVaga: AmbienteGravado | undefined;
    if (capacidade !== null && vivos.length + this.#criacoesEmAndamento >= capacidade) {
      // Da leitura à reserva não há `await`: o primeiro parado da lista ainda está parado.
      const [primeiroParado] = vivos.filter(estaParado).sort(primeiroOSujoDepoisOMaisAntigo);
      paradoQueCedeAVaga = primeiroParado && reservarAmbienteParaEliminar(this.#banco, primeiroParado.id);
      if (!paradoQueCedeAVaga)
        throw new ErroExterno(
          `nenhum sandbox disponível: o conjunto está na capacidade de ${String(capacidade)}, todos ocupados`,
          "o trabalho volta a tentar quando um sandbox for liberado; ou aumente a capacidade na Configuração do Ambiente",
        );
    }
    this.#criacoesEmAndamento++;
    return paradoQueCedeAVaga;
  }

  /** Limpa o container `id` alocado e o devolve ao conjunto: `livre` se a limpeza deu certo, `sujo` se não. O que não está alocado fica como está. */
  async limpar(id: string): Promise<void> {
    const alocado = listarAmbientes(this.#banco).find(
      (candidato) => candidato.id === id && candidato.estado === "alocado",
    );
    if (alocado) await this.#limparEDevolver(alocado);
  }

  async #limparEDevolver(ambiente: AmbienteGravado): Promise<void> {
    let estadoDepoisDaLiberacao: "livre" | "sujo" = "livre";
    try {
      // As sessões e execuções do ocupante saem do container antes de ele servir a outro ocupante.
      recolherParaOEspaco(this.#servico.raiz, ambiente.id, String(ambiente.alocado_para));
      await this.#gerador.limpar(ambiente);
    } catch {
      estadoDepoisDaLiberacao = "sujo";
    }
    liberarAmbiente(this.#banco, ambiente.id, estadoDepoisDaLiberacao, this.#relogio.agora());
  }

  /** Elimina um container do conjunto; só vale para o `livre` ou `sujo`, nunca para o que um ocupante está usando. */
  async eliminar(id: string): Promise<void> {
    const reservado = reservarAmbienteParaEliminar(this.#banco, id);
    if (reservado) return this.#eliminarContainerReservado(reservado);
    const ambiente = listarAmbientes(this.#banco).find((candidato) => candidato.id === id);
    if (!ambiente) throw new ErroDeRegra(`o ambiente ${id} não existe`, "confira o id do ambiente");
    throw new ErroDeRegra(`o ambiente ${id} está alocado a ${String(ambiente.alocado_para)}`, "espere o Espaço acabar");
  }

  /**
   * No conjunto variável, elimina os `livre` e `sujo` parados há mais de `ociosidade_para_eliminar_min`, sem deixar o
   * conjunto abaixo do mínimo: o sujo sai primeiro, depois o mais antigo. O fixo mantém os que criou.
   */
  async eliminarOciosos(agora: Instante): Promise<void> {
    const { conjunto, ociosidade_para_eliminar_min, minimo_do_conjunto } = this.#configuracao();
    if (conjunto === "fixo") return;
    const limiteMs = ociosidade_para_eliminar_min * MS_POR_MINUTO;
    const vivos = listarAmbientes(this.#banco);
    // Reserva todos de uma vez, sem esperar o docker, para um `alocar` não pegar um ocioso no meio do caminho.
    const reservados = vivos
      .filter(
        (ambiente) => estaParado(ambiente) && Date.parse(agora) - Date.parse(String(ambiente.liberado_em)) >= limiteMs,
      )
      .sort(primeiroOSujoDepoisOMaisAntigo)
      .slice(0, Math.max(0, vivos.length - minimo_do_conjunto))
      .map(({ id }) => reservarAmbienteParaEliminar(this.#banco, id))
      .filter((reservado) => reservado !== undefined);
    for (const reservado of reservados) await this.#eliminarContainerReservado(reservado);
  }

  /**
   * Confere o banco com o docker na subida: container com o rótulo que o banco não conhece é órfão e é eliminado; linha
   * do banco cujo container sumiu vira `eliminado`. O que não tem o rótulo nem aparece, porque a listagem só traz os da
   * Fabriquinha. Todo container ainda `alocado` era de um ocupante da instância anterior, cujo processo morreu com o
   * reinício: é limpo e volta `livre` (`sujo` se a limpeza falhar).
   * ponytail: um `alocar` que chegue durante esta espera pode ter o container recém-alocado limpo; a subida é curta e o
   * agendador só liga depois dela.
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
    for (const alocado of noBanco.filter(
      ({ estado, container_id }) => estado === "alocado" && containersDoDocker.has(container_id),
    ))
      await this.#limparEDevolver(alocado);
  }

  /** O que o conjunto sabe do serviço: a raiz, a porta da API e o harness que o `AmbienteContainer` usa. */
  get servico(): ServicoDoConjunto {
    return this.#servico;
  }

  async #criarAlocado(
    imagem: string,
    alocadoPara: string,
    portaDaApi: number,
    montagens: Montagens,
    copias: Copias,
  ): Promise<AmbienteGravado> {
    const criado = await this.#gerador.criar(imagem, this.#configuracao(), portaDaApi, montagens, copias);
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
