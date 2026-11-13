// A GestaoDeDemandas (MELHORIAS §12), a única entrada do domínio Demandas: quem monta entrega o banco e a conferência do
// modelo pelo harness, e recebe a gestão, que cadastra, configura, consulta e remove os projetos e registra, edita, envia,
// cancela, conclui e consulta os pedidos com as dependências entre eles. O que o Ciclo de Vida grava junto do registro, do
// envio, do cancelamento e da conclusão chega como função e roda na unidade de trabalho do pedido: o erro de qualquer lado
// desfaz os dois.
import type { DatabaseSync } from "node:sqlite";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import type { Ator } from "../../../ciclo_de_vida/publico.ts";
import type { RepositorioDoProjeto } from "../../../repositorio/publico.ts";
import {
  cadastrarProjetoDoFormulario,
  type ConferirModeloNoHarness,
  editarProjetoDoFormulario,
  type FormularioDoProjeto,
  gravarConfiguracaoSdlc,
  listarProjetos,
  type Projeto,
  projetoExistente,
  removerProjeto,
  type SobrasNoDisco,
} from "../../projetos/publico.ts";
import type { RelacoesDoPedido } from "../nucleo/dependencia.ts";
import type { Pedido } from "../nucleo/pedido.ts";
import { apagarDependenciasDosPedidos } from "../armazenamento/dependencias.ts";
import {
  apagarPedidosDoProjeto,
  type FiltroDePedidos,
  lerPedidosDoFiltro,
  type PedidoComHistorico,
} from "../armazenamento/pedidos.ts";
import { cancelarComDependentes, registrarDependencia, relacoesGravadasDosPedidos } from "./gestao_de_dependencias.ts";
import { editarPedido, enviarPedido, registrarConclusaoDoPedido, registrarPedido } from "./gestao_de_pedidos.ts";

/** O que a gestão de Demandas recebe de quem a monta. */
interface MontagemDaGestaoDeDemandas {
  banco: DatabaseSync;
  /** F4 §9: o modelo novo ou trocado de cada etapa do projeto só é gravado depois de o harness conhecê-lo. */
  conferirModeloNoHarness: ConferirModeloNoHarness;
  /** Confere o repositório do projeto, fixa o cursor da varredura no cadastro e apaga os Espaços na remoção. */
  repositorio: Pick<RepositorioDoProjeto, "conferir" | "varrerBase" | "apagarEspacosDoProjeto">;
}

/** O pedido como a consulta o lê: o conteúdo, a situação, o histórico, a origem e as relações com os outros pedidos. */
type PedidoConsultado = PedidoComHistorico & RelacoesDoPedido;

/** O pedido que se registra: o conteúdo (projeto, título, tipo, descrição), ainda sem validar, e de quem ele depende. */
export type NovoPedido = { readonly dependencias?: readonly string[] } & Record<string, unknown>;

/** Apaga, dos outros domínios, o que depende das `demandas` do projeto removido, e diz o que sobra no disco. */
type ApagarOQueDependeDasDemandas = (demandas: readonly string[]) => SobrasNoDisco;

export interface GestaoDeDemandas {
  /** Todos os projetos, em ordem de nome. */
  projetos(): Projeto[];
  /** O projeto `nome`, ou `ErroDeInexistente` com a orientação. */
  projeto(nome: string, orientacaoSeNaoExistir?: string): Projeto;
  /** C19: confere o repositório e os modelos, grava o projeto novo e fixa o cursor inicial da varredura da base. */
  cadastrarProjeto(formulario: FormularioDoProjeto): Promise<Projeto>;
  /** C19: edita o projeto que já existe, com as conferências do cadastro; o nome é a chave e não muda. */
  editarProjeto(formulario: FormularioDoProjeto): Promise<Projeto>;
  /** Grava a configuração SDLC do projeto que existe; as etapas e a preparação ficam como o cadastro as deixou. */
  configurarSdlc(configurado: Projeto): Projeto;
  /**
   * I-4: remove o projeto, em qualquer estado, numa unidade de trabalho só: entrega as demandas dele a
   * `apagarOQueDependeDasDemandas`, para os outros domínios as esquecerem antes, e apaga as dependências, os pedidos e o
   * cadastro; depois, o disco. A falha no disco vira aviso.
   */
  removerProjeto(
    nome: string,
    apagarOQueDependeDasDemandas: ApagarOQueDependeDasDemandas,
  ): Promise<{ projeto: Projeto; avisos: string[] }>;

  /** Os pedidos do filtro (sem filtro, todos), na ordem do registro, lidos num snapshot só. */
  pedidos(filtro?: FiltroDePedidos): PedidoConsultado[];
  /** O pedido `id`, ou `ErroDeInexistente`. */
  pedido(id: string): PedidoConsultado;
  /**
   * CA-1 e CA-2: o rascunho novo, com o ID da sequência, o processo que `criarProcessoDoPedido` cria e as dependências,
   * numa unidade de trabalho: qualquer erro desfaz tudo, ID incluído. Devolve o processo.
   */
  registrar<Processo>(novo: NovoPedido, autor: Ator, criarProcessoDoPedido: (pedido: Pedido) => Processo): Processo;
  /** CA-4 a CA-6: edita título, tipo ou descrição do rascunho, só pelo Ator externo que o registrou. */
  editar(id: string, mudanca: unknown, autor: Ator): Pedido;
  /** O rascunho fica `enviado`, com o conteúdo congelado, depois que `aceitarNoProcesso` aceita o envio. */
  enviar<Processo>(id: string, aceitarNoProcesso: () => Processo): Processo;
  /**
   * CA-11: `cancelarOsProcessos` recebe os dependentes de `id` que ainda não terminaram e cancela os processos; os pedidos
   * que ele diz cancelados ficam `cancelados`, na mesma unidade de trabalho.
   */
  cancelar<Cancelamento extends { readonly canceladas: readonly string[] }>(
    id: string,
    cancelarOsProcessos: (dependentes: string[]) => Cancelamento,
  ): Cancelamento;
  /** O pedido fica `concluido` junto do encerramento do processo; concluir de novo não muda nada. */
  concluir(id: string, gravarEncerramentoDoProcesso: () => void): void;
}

/** Monta a gestão de Demandas sobre o `banco`. */
export function montarGestaoDeDemandas({
  banco,
  conferirModeloNoHarness,
  repositorio,
}: MontagemDaGestaoDeDemandas): GestaoDeDemandas {
  const pedidosConsultados = (filtro: FiltroDePedidos): PedidoConsultado[] =>
    lerEmSnapshot(banco, () => {
      const lidos = lerPedidosDoFiltro(banco, filtro);
      const relacoesDe = relacoesGravadasDosPedidos(
        banco,
        lidos.map(({ id }) => id),
      );
      return lidos.map((pedido) => ({ ...pedido, ...relacoesDe(pedido.id) }));
    });
  return {
    projetos: () => listarProjetos(banco),
    projeto: (nome, orientacaoSeNaoExistir) => projetoExistente(banco, nome, orientacaoSeNaoExistir),
    cadastrarProjeto: (formulario) =>
      cadastrarProjetoDoFormulario(banco, formulario, { conferirModeloNoHarness, repositorio }),
    editarProjeto: (formulario) =>
      editarProjetoDoFormulario(banco, formulario, { conferirModeloNoHarness, repositorio }),
    configurarSdlc: (configurado) => gravarConfiguracaoSdlc(banco, configurado),
    removerProjeto: (nome, apagarOQueDependeDasDemandas) =>
      removerProjeto(
        banco,
        nome,
        () => {
          // Dos mais novos para os mais antigos, a ordem em que a remoção sempre entregou as demandas.
          const demandas = lerPedidosDoFiltro(banco, { projeto: nome })
            .map(({ id }) => id)
            .reverse();
          const sobras = apagarOQueDependeDasDemandas(demandas);
          apagarDependenciasDosPedidos(banco, demandas);
          apagarPedidosDoProjeto(banco, nome);
          return sobras;
        },
        repositorio,
      ),

    pedidos: (filtro = {}) => pedidosConsultados(filtro),
    pedido: (id) =>
      encontrado(pedidosConsultados({ ids: [id] })[0], `a demanda ${id} não existe`, "confira o id da demanda"),
    registrar: ({ dependencias = [], ...conteudo }, autor, criarProcessoDoPedido) =>
      registrarPedido(banco, conteudo, autor, (pedido) => {
        const processo = criarProcessoDoPedido(pedido);
        for (const dependeId of dependencias) registrarDependencia(banco, pedido.id, dependeId);
        return processo;
      }),
    editar: (id, mudanca, autor) => editarPedido(banco, id, mudanca, autor),
    enviar: (id, aceitarNoProcesso) => enviarPedido(banco, id, aceitarNoProcesso),
    cancelar: (id, cancelarOsProcessos) => cancelarComDependentes(banco, id, cancelarOsProcessos),
    concluir: (id, gravarEncerramentoDoProcesso) => {
      registrarConclusaoDoPedido(banco, id, gravarEncerramentoDoProcesso);
    },
  };
}
