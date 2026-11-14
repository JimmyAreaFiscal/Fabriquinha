// O fluxo do despacho do trabalho (MELHORIAS §5.3), entre Demandas e o Ciclo de Vida: Demandas informa, a cada chamada,
// as predecessoras que ainda não concluíram de cada pedido (o pedido sem nenhuma está liberado), e o Despacho escolhe e
// reserva os tickets. O ciclo do agendador e o "Executar agora" passam por aqui, com a mesma liberação.
import type { Relogio } from "../../../shared/nucleo/relogio.ts";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";
import {
  cicloDoDespacho,
  type Configuracao,
  type DepsDespacho,
  executarAgora,
  type ModulosDoCiclo,
  type MotivoDeRecusa,
} from "../../../modulos/ciclo_de_vida/publico.ts";

/**
 * A liberação dos pedidos pelas Dependências de Demandas, na forma que o Despacho pede.
 * @testes os testes que chamam o Despacho direto passam a mesma liberação do serviço
 */
export const predecessorasPendentesPelasDependencias =
  (gestaoDeDemandas: GestaoDeDemandas) =>
  (demandaIds: readonly string[]): Map<string, readonly string[]> =>
    new Map(gestaoDeDemandas.pedidos({ ids: demandaIds }).map((pedido) => [pedido.id, pedido.predecessorasPendentes]));

/** Um ciclo do agendador com os pedidos liberados por Demandas; devolve as etapas em segundo plano, que nunca rejeitam. */
export const despacharTrabalho = (
  modulos: ModulosDoCiclo,
  gestaoDeDemandas: GestaoDeDemandas,
  configuracaoDoServico: Configuracao,
  conducoes: DepsDespacho,
  relogio: Relogio,
): Promise<void>[] =>
  cicloDoDespacho(
    modulos,
    configuracaoDoServico,
    conducoes,
    predecessorasPendentesPelasDependencias(gestaoDeDemandas),
    relogio,
  );

/** O "Executar agora" de um ticket, com a mesma liberação do ciclo; o que o Despacho recusa volta como motivo. */
export const despacharAgora = (
  modulos: ModulosDoCiclo,
  gestaoDeDemandas: GestaoDeDemandas,
  ticket: { demanda_id: string; ticket_id: number },
  configuracaoDoServico: Configuracao,
  conducoes: DepsDespacho,
  relogio: Relogio,
): MotivoDeRecusa | Promise<void> =>
  executarAgora(
    modulos,
    ticket,
    configuracaoDoServico,
    conducoes,
    predecessorasPendentesPelasDependencias(gestaoDeDemandas),
    relogio,
  );
