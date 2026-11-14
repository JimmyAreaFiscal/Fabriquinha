// Os casos de uso dos Pedidos (MELHORIAS §12): registrar, editar, enviar e registrar o cancelamento e a conclusão. Cada
// um abre a sua unidade de trabalho; o registro, o envio e a conclusão recebem do fluxo do servidor o que o Ciclo de Vida
// grava junto (o processo), e o rodam dentro dela: o erro de qualquer lado desfaz os dois.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Ator } from "../../../../shared/nucleo/demanda/ator.ts";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { projetoExistente } from "../../projetos/publico.ts";
import { type Pedido, pedidoComConteudoEditado, pedidoNaSituacao, pedidoRegistrado } from "../nucleo/pedido.ts";
import {
  alocarIdDoPedido,
  gravarConteudoDoPedido,
  gravarEnvioDoPedido,
  gravarPedidoNovo,
  gravarSituacaoDoPedido,
  lerPedido,
} from "../armazenamento/pedidos.ts";

/** O `ZodError` da entrada vira ErroDeRegra com o campo e a correção (CA-18). */
function comCampoInvalidoComoErroDeRegra<T>(operacaoQueValidaAEntrada: () => T): T {
  try {
    return operacaoQueValidaAEntrada();
  } catch (erro) {
    if (!(erro instanceof z.ZodError)) throw erro;
    const campos = erro.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
    throw new ErroDeRegra(campos, "corrija o campo indicado e tente de novo");
  }
}

/**
 * CA-1: o pedido novo do projeto, em rascunho, com o ID da sequência, e o processo dele, que `criarProcessoDoPedido`
 * cria na mesma unidade de trabalho: o erro de lá desfaz tudo, ID incluído.
 */
export const registrarPedido = <Processo>(
  banco: DatabaseSync,
  conteudo: Record<string, unknown>,
  autor: Ator,
  criarProcessoDoPedido: (pedido: Pedido) => Processo,
): Processo =>
  comCampoInvalidoComoErroDeRegra(() =>
    escrever(banco, () => {
      projetoExistente(banco, String(conteudo.projeto));
      const pedido = pedidoRegistrado({ ...conteudo, id: alocarIdDoPedido(banco) }, autor);
      gravarPedidoNovo(banco, pedido);
      return criarProcessoDoPedido(pedido);
    }),
  );

/** CA-6 e CA-7: edita título, tipo ou descrição do rascunho, só pelo Ator externo que o registrou. */
export const editarPedido = (banco: DatabaseSync, id: string, entrada: unknown, autor: Ator): Pedido =>
  comCampoInvalidoComoErroDeRegra(() =>
    escrever(banco, () => {
      const editado = pedidoComConteudoEditado(lerPedido(banco, id), entrada, autor);
      gravarConteudoDoPedido(banco, editado);
      return editado;
    }),
  );

/**
 * O rascunho fica `enviado`, com o conteúdo congelado, depois que `aceitarNoProcesso` leva o processo ao Gate da demanda,
 * na mesma unidade de trabalho.
 */
export const enviarPedido = <Processo>(banco: DatabaseSync, id: string, aceitarNoProcesso: () => Processo): Processo =>
  escrever(banco, () => {
    const processo = aceitarNoProcesso();
    gravarEnvioDoPedido(banco, pedidoNaSituacao(lerPedido(banco, id), "enviado"));
    return processo;
  });

/** Os pedidos `ids` ficam `cancelados`: o pedido e as dependentes, que o fluxo do cancelamento leva juntos. */
export const registrarCancelamentoDosPedidos = (banco: DatabaseSync, ids: readonly string[]): void => {
  escrever(banco, () => {
    for (const id of ids) gravarSituacaoDoPedido(banco, pedidoNaSituacao(lerPedido(banco, id), "cancelado"));
  });
};

/**
 * O pedido `id` fica `concluido` junto do encerramento do processo, que `gravarEncerramentoDoProcesso` grava na mesma
 * unidade de trabalho; registrar de novo não muda nada.
 */
export const registrarConclusaoDoPedido = (
  banco: DatabaseSync,
  id: string,
  gravarEncerramentoDoProcesso: () => void,
): void => {
  escrever(banco, () => {
    gravarEncerramentoDoProcesso();
    gravarSituacaoDoPedido(banco, pedidoNaSituacao(lerPedido(banco, id), "concluido"));
  });
};
