// Como cada Métrica é mostrada e recortada: as de Sucesso que as Etapas declaram (CONCEITOS.md §16) e as do SDLC inteiro.
import type { TipoMetrica } from "../../etapas/publico.ts";

/** Como uma Métrica é mostrada: o rótulo da tela e de onde ela deriva; o tipo da de uma Etapa é o que a Etapa declara. */
export interface DefinicaoDaMetrica<Tipo extends string = TipoMetrica> {
  tipo: Tipo;
  rotulo: string;
  fonte: string;
}

/** O recorte de uma Métrica: período `[inicio, fim)`, Projeto ou Demanda; cada campo presente restringe, e ausente vale tudo. */
export interface Recorte {
  inicio?: string;
  fim?: string;
  projeto?: string | null;
  demandaId?: string;
}

/**
 * Os fatos do pedido que as Métricas leem. Chegam como dado de quem pede: o Ciclo de Vida não importa Demandas, que é
 * quem os guarda.
 */
export interface PedidoDasMetricas {
  id: string;
  projeto: string;
  titulo: string;
  /** A situação atual, que a tabela por demanda mostra e que diz se a demanda foi concluída. */
  estado: string;
  estadoAlteradoEm: string;
  /** A demanda nova não grava o registro nem a conclusão (só o backfill grava): `null`. */
  criadaEm: string | null;
  concluidaEm: string | null;
}

/**
 * O instante do registro da demanda: o gravado ou, na demanda nova, o da primeira evidência e, sem evidência, o da última
 * mudança de estado.
 */
export const registroDoPedido = (pedido: PedidoDasMetricas, primeiraEvidencia: string | undefined): string =>
  pedido.criadaEm ?? primeiraEvidencia ?? pedido.estadoAlteradoEm;

/** O instante está no período do recorte; a ponta ausente não restringe. */
export const noPeriodo = (instante: string, { inicio, fim }: Pick<Recorte, "inicio" | "fim">): boolean =>
  (inicio === undefined || instante >= inicio) && (fim === undefined || instante < fim);
