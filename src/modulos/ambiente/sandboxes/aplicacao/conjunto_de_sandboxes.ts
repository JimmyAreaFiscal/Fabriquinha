// O conjunto compartilhado de sandboxes em container (CONCEITOS.md §7 e §13): aloca um container a cada ocupante
// (exclusivo enquanto ele o usa), limpa e devolve ao conjunto quando ele o libera e elimina os que ficam ociosos.
// O banco diz quem é de quem; o `GeradorDeAmbientes` é o único que cria e elimina os containers. A alocação devolvida é a
// referência que a Execução usa para rodar comandos no container.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
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
import { configuracaoDoAmbiente } from "../../configuracao/publico.ts";
import type { Copias, GeradorDeAmbientes, Montagens } from "../infra/gerador_de_ambientes.ts";
import { recolherParaOEspaco } from "../infra/pastas_do_ambiente.ts";

const MS_POR_MINUTO = 60_000;

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

/** O tipo configurado tem conjunto de containers? `host_local` não tem: o trabalho roda no Ambiente do serviço. */
export function tipoConfiguradoTemConjunto(banco: DatabaseSync): boolean {
  switch (configuracaoDoAmbiente(banco).tipo) {
    case "host_local":
      return false;
    case "container":
      return true;
  }
}

export class ConjuntoDeSandboxes {
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

  /** A alocação que o ocupante já tem, ou `undefined`. */
  alocacaoDe({ dono }: Pick<OcupanteDoAmbiente, "dono">): AmbienteGravado | undefined {
    return buscarAmbienteAlocadoPara(this.#banco, dono);
  }

  /** O container `id` do conjunto (alocado ou não), ou `undefined` se ele não está no banco. */
  sandboxPorId(id: string): AmbienteGravado | undefined {
    return listarAmbientes(this.#banco).find((candidato) => candidato.id === id);
  }

  /** Dá ao ocupante um livre da mesma imagem ou, sem nenhum, um container novo; o que já tem um recebe o mesmo. */
  async alocar(
    { dono: alocadoPara, pasta_das_worktrees_do_projeto }: OcupanteDoAmbiente,
    projeto: ProjetoDoAmbiente,
  ): Promise<AmbienteGravado> {
    const servico = this.servicoObrigatorio(); // antes de criar qualquer container
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
    if (jaAlocado) return jaAlocado;
    const livreReaproveitado = alocarAmbienteLivreDaImagem(this.#banco, imagem, alocadoPara);
    if (livreReaproveitado) return livreReaproveitado;
    const montagens: Montagens = {
      pastaDasWorktreesDoProjeto: pasta_das_worktrees_do_projeto,
      raiz_git: projeto.raiz_git,
      raiz: servico.raiz,
      pacote: servico.pacote_do_harness,
    };
    const copias: Copias = { dir_do_pi: servico.dir_do_harness_do_auditor, home_do_usuario: servico.home_do_usuario };
    return this.#criarAlocado(imagem, alocadoPara, servico.porta_da_api, montagens, copias);
  }

  /** Limpa o container do ocupante e o devolve ao conjunto: `livre` se a limpeza deu certo, `sujo` se não. */
  async liberar({ dono }: Pick<OcupanteDoAmbiente, "dono">): Promise<void> {
    const ambiente = buscarAmbienteAlocadoPara(this.#banco, dono);
    if (ambiente) await this.#limparEDevolver(ambiente);
  }

  async #limparEDevolver(ambiente: AmbienteGravado): Promise<void> {
    let estadoDepoisDaLiberacao: "livre" | "sujo" = "livre";
    try {
      // As sessões e execuções do ocupante saem do container antes de ele servir a outro ocupante.
      recolherParaOEspaco(this.servicoObrigatorio().raiz, ambiente.id, String(ambiente.alocado_para));
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

  /** O que o conjunto sabe do serviço; sem ele, só elimina containers. */
  servicoObrigatorio(): ServicoDoConjunto {
    return existe(
      this.#servico,
      "o conjunto de Ambientes não conhece a raiz da Fabriquinha",
      "monte o conjunto pela composição do serviço",
    );
  }

  async #criarAlocado(
    imagem: string,
    alocadoPara: string,
    portaDaApi: number,
    montagens: Montagens,
    copias: Copias,
  ): Promise<AmbienteGravado> {
    const criado = await this.#gerador.criar(
      imagem,
      configuracaoDoAmbiente(this.#banco),
      portaDaApi,
      montagens,
      copias,
    );
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
