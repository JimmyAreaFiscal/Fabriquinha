// O fluxo da remoção do projeto (I-4, MELHORIAS §5.1 e §5.3), entre Demandas, o Ciclo de Vida, Sessões e o Repositório:
// numa unidade de trabalho só, que Demandas abre, recusa a execução em andamento e apaga, cada domínio as suas tabelas e
// na ordem das chaves estrangeiras, os commits, as sessões e o desenvolvimento das demandas do projeto e o cursor da
// varredura dele; depois Demandas apaga as dependências, os pedidos, o cadastro e o disco.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../shared/nucleo/erros.ts";
import {
  apagarDesenvolvimentoDasDemandas,
  formatarTicketRef,
  ticketsDasDemandas,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";
import { montarRepositorio } from "../../../modulos/repositorio/publico.ts";
import { montarSessoesDeAgente, type SessoesDeAgente } from "../../../modulos/sessoes/publico.ts";

/** Recusa a remoção enquanto um ticket do projeto está em execução ou tem execução de sessão aberta. */
function recusarExecucaoEmAndamento(
  banco: DatabaseSync,
  sessoes: SessoesDeAgente,
  nome: string,
  pedidos: readonly string[],
): void {
  const comExecucaoAberta = new Set(
    sessoes
      .listar({ demandas: pedidos, abertas: true })
      .map(({ demanda_id, ticket_id }) => `${demanda_id}.${String(ticket_id)}`),
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
export const removerProjetoComOQueDependeDele = (
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  nome: string,
) =>
  gestaoDeDemandas.removerProjeto(nome, (pedidos) => {
    const sessoesDeAgente = montarSessoesDeAgente({ banco });
    recusarExecucaoEmAndamento(banco, sessoesDeAgente, nome, pedidos);
    const removerWorktrees = montarRepositorio({ banco }).esquecer(gestaoDeDemandas.projeto(nome), pedidos);
    const { execucoes, sessoes } = sessoesDeAgente.esquecer(pedidos);
    const anexosSemEvidencia = apagarDesenvolvimentoDasDemandas(banco, pedidos);
    return { execucoes, sessoes, anexosSemEvidencia, removerWorktrees };
  });
