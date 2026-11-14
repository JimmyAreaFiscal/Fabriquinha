// A devolução do Ambiente ocioso (I-312): o Espaço que espera o humano (gate ou ticket falho) ou que acabou de ser preparado
// não segura sandbox do conjunto. A worktree fica no host; a próxima operação do Espaço passa por `prepararEspaco` e aloca de novo.
import { carregarDemanda } from "../../processo/publico.ts";
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
  const ag = carregarDemanda(banco, dono.demanda_id);
  const ticketsDoEspaco = new Set(ag.tickets.filter((t) => t.rodada_id === dono.rodada_id).map((t) => t.ticket_id));
  const temPiVivoNoEspaco = sessoes
    .listar({ demandas: [dono.demanda_id] })
    .some((s) => s.situacao !== undefined && ticketsDoEspaco.has(s.ticket_id));
  if (temPiVivoNoEspaco) return;
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `devolucao-${dono.demanda_id}`);
  try {
    await repositorio.devolverAmbiente(projeto, espacoDoTicket(ag, dono, projeto, raiz), log);
  } catch (erro) {
    anotar(log, `devolver o Ambiente falhou: ${mensagem(erro)}`);
  }
}

/**
 * Depois do fim da execução do ticket: se a demanda ou a rodada dele espera uma decisão humana (gate do plano, da
 * demanda ou do PR) ou o ticket falhou à espera do Auditor, o Espaço dele devolve o Ambiente.
 */
export async function devolverAmbienteSeOTicketEsperaOHumano(
  modulos: ModulosDaDevolucao,
  ref: { demanda_id: string; ticket_id: number },
): Promise<void> {
  const ag = carregarDemanda(modulos.banco, ref.demanda_id);
  const ticket = ag.tickets.find((t) => t.ticket_id === ref.ticket_id);
  if (ticket === undefined) return;
  const rodada = ag.rodadas.find((r) => r.rodada_id === ticket.rodada_id);
  const estaNoGate =
    rodada === undefined
      ? ag.demanda.estado === "gate_planejamento" || ag.demanda.estado === "gate_demanda"
      : rodada.estado === "gate_pr";
  if (estaNoGate || ticket.estado === "falhou") {
    await devolverAmbienteDoEspaco(modulos, { demanda_id: ref.demanda_id, rodada_id: ticket.rodada_id });
  }
}

/**
 * O pi interativo que assenta (ocioso, sem diálogo) com a demanda no gate do plano nada mais tem a fazer no Ambiente: é
 * encerrado, e o fim da execução o devolve. A mensagem do Auditor depois do gate retoma a mesma sessão.
 */
export function encerrarPiQueAssentaNoGateDoPlano(modulos: ModulosDoCiclo, lancada: ExecucaoLancada): void {
  const { banco, sessoes } = modulos;
  const { id: sessao, demanda_id } = lancada.sessao;
  const cancelarAssinatura = sessoes.assinar(sessao, (evento) => {
    if (evento.type !== "estado") return;
    const viva = sessoes.listar({ sessoes: [sessao] })[0]?.situacao;
    const assentou = viva !== undefined && !viva.ocupado && viva.dialogos.length === 0;
    if (assentou && carregarDemanda(banco, demanda_id).demanda.estado === "gate_planejamento") {
      void sessoes.encerrar(lancada.execucao.id);
    }
  });
  void lancada.fim.then(cancelarAssinatura);
}
