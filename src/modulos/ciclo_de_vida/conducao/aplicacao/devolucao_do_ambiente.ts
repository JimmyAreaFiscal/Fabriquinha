// A devolução do Ambiente ocioso (I-312): o Espaço que espera o humano (gate ou ticket falho) ou que acabou de ser preparado
// não segura sandbox do conjunto. A worktree fica no host; a próxima operação do Espaço passa por `prepararEspaco` e aloca de novo.
import { type AgregadoDemanda, carregarDemanda, type TicketDemanda } from "../../processo/publico.ts";
import { espacoDoTicket } from "../../../repositorio/publico.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { mensagem } from "../../../../shared/nucleo/erros.ts";
import { anotar, logDaOperacao } from "../../../../shared/infra/registro.ts";
import type { ExecucaoLancada } from "../../../sessoes/publico.ts";
import { projetosCadastrados } from "./projetos_cadastrados.ts";
import type { ModulosDoCiclo } from "./modulos_do_ciclo.ts";

type ModulosDaDevolucao = Pick<ModulosDoCiclo, "banco" | "repositorio" | "sessoes">;

/** O dono de um Espaço: a demanda (sem `rodada_id`) ou uma rodada dela. */
interface DonoDoEspaco {
  demanda_id: string;
  rodada_id?: number | undefined;
}

/**
 * Devolve ao conjunto o Ambiente do Espaço de `dono`, salvo se um pi dos tickets dele está vivo: limpar o container por
 * baixo dele o mataria. A falha só vai ao log: o Ambiente segue alocado, como antes da devolução.
 */
export async function devolverAmbienteDoEspaco(modulos: ModulosDaDevolucao, dono: DonoDoEspaco): Promise<void> {
  const { banco, repositorio, sessoes } = modulos;
  const demanda = carregarDemanda(banco, dono.demanda_id);
  const ticketsDoEspaco = new Set(
    demanda.tickets.filter((ticket) => ticket.rodada_id === dono.rodada_id).map((ticket) => ticket.ticket_id),
  );
  const temPiVivoNoEspaco = sessoes
    .listar({ demandas: [dono.demanda_id] })
    .some((sessao) => sessao.situacao !== undefined && ticketsDoEspaco.has(sessao.ticket_id));
  if (temPiVivoNoEspaco) return;
  const projeto = projetosCadastrados().carregarProjeto(banco, demanda.demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `devolucao-${dono.demanda_id}`);
  try {
    await repositorio.devolverAmbiente(projeto, espacoDoTicket(demanda, dono, projeto, raiz), log);
  } catch (erro) {
    anotar(log, `devolver o Ambiente falhou: ${mensagem(erro)}`);
  }
}

/**
 * O Espaço do ticket fica ocioso até uma decisão humana: a demanda no gate do plano ou da demanda, ou em `em_execucao`
 * (só as rodadas trabalham, e o Espaço da demanda espera a revisão); a rodada no gate do PR ou na sessão de ajustes, que
 * conversa com o Auditor.
 */
function espacoDoTicketEsperaOHumano(demanda: AgregadoDemanda, ticket: TicketDemanda): boolean {
  const rodada = demanda.rodadas.find((candidata) => candidata.rodada_id === ticket.rodada_id);
  if (rodada === undefined)
    return ["gate_planejamento", "gate_demanda", "em_execucao"].includes(demanda.demanda.estado);
  return rodada.estado === "gate_pr" || rodada.estado === "ajustar_resultado";
}

/**
 * Depois do fim da execução do ticket: se o Espaço dele espera uma decisão humana (`espacoDoTicketEsperaOHumano`) ou o
 * ticket falhou à espera do Auditor, o Espaço devolve o Ambiente.
 */
export async function devolverAmbienteSeOTicketEsperaOHumano(
  modulos: ModulosDaDevolucao,
  ticketEncerrado: { demanda_id: string; ticket_id: number },
): Promise<void> {
  const demanda = carregarDemanda(modulos.banco, ticketEncerrado.demanda_id);
  const ticket = demanda.tickets.find((candidato) => candidato.ticket_id === ticketEncerrado.ticket_id);
  if (ticket === undefined) return;
  if (espacoDoTicketEsperaOHumano(demanda, ticket) || ticket.estado === "falhou") {
    await devolverAmbienteDoEspaco(modulos, { demanda_id: ticketEncerrado.demanda_id, rodada_id: ticket.rodada_id });
  }
}

/**
 * O pi interativo que assenta (ocioso, sem diálogo) com a demanda no gate do plano nada mais tem a fazer no Ambiente: é
 * encerrado, e o fim da execução o devolve. A mensagem do Auditor depois do gate retoma a mesma sessão. O pi da sessão de
 * ajustes não: ele vive ocioso entre as mensagens do Auditor (CA-16 da I-229), e a ociosidade o encerra e devolve.
 */
export function encerrarPiQueAssentaNoGateDoPlano(modulos: ModulosDoCiclo, lancada: ExecucaoLancada): void {
  const { banco, sessoes } = modulos;
  const { id: sessao, demanda_id } = lancada.sessao;
  const cancelarAssinatura = sessoes.assinar(sessao, (evento) => {
    if (evento.type !== "estado") return;
    const piVivo = sessoes.listar({ sessoes: [sessao] })[0]?.situacao;
    const assentou = piVivo !== undefined && !piVivo.ocupado && piVivo.dialogos.length === 0;
    if (assentou && carregarDemanda(banco, demanda_id).demanda.estado === "gate_planejamento") {
      void sessoes.encerrar(lancada.execucao.id);
    }
  });
  void lancada.fim.then(cancelarAssinatura);
}
