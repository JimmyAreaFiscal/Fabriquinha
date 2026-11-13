// O pedido (MELHORIAS §12): o conteúdo, quem o registrou e a situação administrativa. O andamento do desenvolvimento é
// do Ciclo de Vida e não entra aqui; a situação diz só se o pedido é rascunho, foi enviado, cancelado ou concluído.
import { z } from "zod";
import { type Ator, AtorExterno, exigirAutoria } from "../../../ciclo_de_vida/publico.ts";
import { DemandaId } from "../../../../shared/nucleo/demanda_id.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { Markdown, Slug, Titulo } from "../../../../shared/nucleo/primitivos.ts";

export const SituacaoDoPedido = z.enum(["rascunho", "enviado", "cancelado", "concluido"]);
export type SituacaoDoPedido = z.infer<typeof SituacaoDoPedido>;

const TipoDoPedido = z.enum(["funcionalidade", "problema"]);

const ConteudoDoPedido = z.strictObject({
  id: DemandaId,
  projeto: Slug,
  titulo: Titulo,
  tipo: TipoDoPedido,
  descricao: Markdown,
});
const EdicaoDoConteudo = z
  .strictObject({ titulo: Titulo.optional(), tipo: TipoDoPedido.optional(), descricao: Markdown.optional() })
  .refine((e) => (e.titulo ?? e.tipo ?? e.descricao) !== undefined, "informe ao menos um campo para editar");

export interface Pedido extends z.infer<typeof ConteudoDoPedido> {
  readonly criada_por: z.infer<typeof AtorExterno>;
  /** O conteúdo congela no envio, e o cancelamento depois dele não o descongela. */
  readonly enviada: boolean;
  readonly situacao: SituacaoDoPedido;
}

/** De que situações o pedido chega a cada uma; pedir a situação em que ele já está não muda nada. */
const SITUACOES_DE_ORIGEM: Record<SituacaoDoPedido, readonly SituacaoDoPedido[]> = {
  rascunho: [],
  enviado: ["rascunho"],
  cancelado: ["rascunho", "enviado"],
  concluido: ["enviado"],
};

/** O pedido cancelado ou concluído terminou: não espera mais nada. */
export const pedidoTerminou = (situacao: SituacaoDoPedido): boolean =>
  situacao === "cancelado" || situacao === "concluido";

/** O pedido novo, em rascunho, com o Ator externo que o registrou; a entrada inválida dá o `ZodError` do campo. */
export const pedidoRegistrado = (entrada: unknown, autor: Ator): Pedido => ({
  ...ConteudoDoPedido.parse(entrada),
  criada_por: AtorExterno.parse(autor),
  enviada: false,
  situacao: "rascunho",
});

/** Título, tipo ou descrição mudam só antes do envio e só pelo Ator externo que registrou o pedido. */
export function pedidoComConteudoEditado(pedido: Pedido, entrada: unknown, autor: Ator): Pedido {
  const edicao = EdicaoDoConteudo.parse(entrada);
  if (pedido.enviada) {
    throw new ErroDeRegra(
      `a demanda ${pedido.id} já foi enviada e o conteúdo está congelado`,
      "só custos, decisões e evidências de etapas posteriores entram depois do envio",
    );
  }
  exigirAutoria(pedido, autor, "editar");
  return {
    ...pedido,
    titulo: edicao.titulo ?? pedido.titulo,
    tipo: edicao.tipo ?? pedido.tipo,
    descricao: edicao.descricao ?? pedido.descricao,
  };
}

/** A situação nova, se o pedido chega a ela da situação em que está. */
export function pedidoNaSituacao(pedido: Pedido, situacao: SituacaoDoPedido): Pedido {
  if (pedido.situacao === situacao) return pedido;
  if (!SITUACOES_DE_ORIGEM[situacao].includes(pedido.situacao)) {
    throw new ErroDeRegra(
      `a demanda ${pedido.id} está na situação ${pedido.situacao} e não pode passar a ${situacao}`,
      "confira a situação da demanda antes de tentar de novo",
    );
  }
  return { ...pedido, situacao };
}
