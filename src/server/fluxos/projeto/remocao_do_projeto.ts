// O fluxo da remoção do projeto (I-4, MELHORIAS §5.1 e §5.3), entre Demandas, o Ciclo de Vida, Sessões e o Repositório:
// numa unidade de trabalho só, recusa a execução em andamento e apaga, cada domínio as suas tabelas e na ordem das chaves
// estrangeiras, os commits, as sessões, o desenvolvimento, as dependências e os pedidos do projeto e o cursor da
// varredura dele; o cadastro do projeto e o disco ficam com Demandas, que abre a unidade de trabalho.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../shared/nucleo/erros.ts";
import {
  apagarDesenvolvimentoDasDemandas,
  formatarTicketRef,
  ticketsDasDemandas,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import {
  apagarDependenciasDosPedidos,
  apagarPedidosDoProjeto,
  pedidosDoProjeto,
  removerProjeto,
} from "../../../modulos/demandas/publico.ts";
import { apagarCommitsDasDemandas, apagarVarreduraDoProjeto } from "../../../modulos/repositorio/publico.ts";
import { apagarSessoesDasDemandas, execucoesAbertas } from "../../../modulos/sessoes/publico.ts";

/** Recusa a remoção enquanto um ticket do projeto está em execução ou tem execução de sessão aberta. */
function recusarExecucaoEmAndamento(banco: DatabaseSync, nome: string, pedidos: readonly string[]): void {
  const comExecucaoAberta = new Set(
    execucoesAbertas(banco).map(({ demanda_id, ticket_id }) => `${demanda_id}.${String(ticket_id)}`),
  );
  const ticketEmAndamento = ticketsDasDemandas(banco, pedidos).find(
    (ticket) =>
      ticket.estado === "em_execucao" || comExecucaoAberta.has(`${ticket.demanda_id}.${String(ticket.ticket_id)}`),
  );
  if (ticketEmAndamento) {
    throw new ErroDeRegra(
      `o projeto ${nome} tem execução em andamento no ${formatarTicketRef(ticketEmAndamento)}`,
      "espere ela terminar ou pare a sessão, e remova de novo",
    );
  }
}

/** Remove o projeto e tudo o que depende dele, em qualquer estado; falha no disco vira aviso. */
export const removerProjetoComOQueDependeDele = (banco: DatabaseSync, nome: string) =>
  removerProjeto(banco, nome, () => {
    const pedidos = pedidosDoProjeto(banco, nome);
    recusarExecucaoEmAndamento(banco, nome, pedidos);
    apagarCommitsDasDemandas(banco, pedidos);
    const { execucoes, sessoes } = apagarSessoesDasDemandas(banco, pedidos);
    const anexosSemEvidencia = apagarDesenvolvimentoDasDemandas(banco, pedidos);
    apagarDependenciasDosPedidos(banco, pedidos);
    apagarPedidosDoProjeto(banco, nome);
    apagarVarreduraDoProjeto(banco, nome);
    return { execucoes, sessoes, anexosSemEvidencia };
  });
