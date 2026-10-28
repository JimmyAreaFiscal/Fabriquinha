// Serviço Planejamento da demanda (comparacao-sdlc-implementacao.md §§3 e 6): junta reserva, sessão interativa, plano e
// preparação das worktrees. Só orquestra as regras do domínio; git e preparação ficam fora da transação.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Ator, AUDITOR, FABRIQUINHA } from "../dominio/agregado.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { Plano } from "../dominio/demanda.ts";
import { predecessorasPendentes } from "../dominio/dependencia_demanda.ts";
import { ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import {
  confirmarAprovacaoPlanejamento,
  exigirFase,
  reprovarPlanejamento,
  submeterPlano,
} from "../dominio/transicoes_demanda.ts";
import { reservarTicket } from "../dominio/reserva_ticket.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { raizDo } from "../persistencia/banco.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { predecessorasDaDemanda } from "../persistencia/dependencias_demanda.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { carregarSessoesDoTicket } from "../persistencia/sessoes.ts";
import {
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "../repositorio/worktree-demanda.ts";
import { iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { encerrar, mandar, situacao } from "./gerente.ts";

const contexto = () => ({ agora: new Date().toISOString() });

function ticketPlanejar(ag: AgregadoDemanda) {
  return existe(
    ag.tickets.find((t) => t.etapa === "planejar"),
    `a demanda ${ag.demanda.id} não tem ticket de etapa planejar`,
    "abra o ticket de planejamento",
  );
}

/**
 * Reserva o `planejar` (só com as predecessoras satisfeitas) e conduz a sessão interativa; com o ticket já em execução
 * só retoma a mesma sessão. Reprovada, a retomada leva o motivo da última decisão.
 */
export function iniciarOuRetomarPlanejamento(
  banco: DatabaseSync,
  demandaId: string,
  limiteMin: number,
): { id: string; fim: Promise<void> } {
  const ag = carregarDemanda(banco, demandaId);
  exigirFase(ag, "planejamento", "iniciar o planejamento");
  const ticket = ticketPlanejar(ag);
  if (ticket.status === "aberto") {
    const satisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, demandaId)).length === 0;
    comDemanda(banco, demandaId, (a) =>
      reservarTicket(a, { ticket_id: ticket.ticket_id }, FABRIQUINHA, contexto(), satisfeitas),
    );
  } else if (ticket.status !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket de planejamento da demanda ${demandaId} está ${ticket.status} e não pode ser iniciado`,
      "só se inicia ou retoma o planejamento com o ticket aberto ou em execução",
    );
  }
  const ultima = ag.decisoes.filter((d) => d.ticket_id === ticket.ticket_id).at(-1);
  const retomada =
    ultima?.resultado === "recusado"
      ? { tipo: "devolucao" as const, motivo: existe(ultima.motivo, "a reprovação não tem motivo", "confira o banco") }
      : undefined;
  return iniciarExecucaoDemanda(
    banco,
    { demanda_id: demandaId, ticket_id: ticket.ticket_id },
    { limiteMin, modo: "interativo", retomada },
  );
}

/** A submissão do agente, já validada pelo CLI: o domínio revalida e leva a demanda ao gate de aprovação. */
export const submeterPlanejamento = (
  banco: DatabaseSync,
  demandaId: string,
  plano: unknown,
  ator: Ator,
): AgregadoDemanda => comDemanda(banco, demandaId, (ag) => submeterPlano(ag, plano, ator, contexto()));

/**
 * O Auditor reprova com motivo; a demanda volta a `planejamento`. Com o pi da sessão vivo e ocioso, o motivo vai a ele
 * como prompt; sem pi vivo, o despacho retoma a mesma sessão com o motivo.
 */
export function reprovarPlanejamentoDemanda(banco: DatabaseSync, demandaId: string, motivo: string): AgregadoDemanda {
  const ag = comDemanda(banco, demandaId, (a) => reprovarPlanejamento(a, { motivo }, AUDITOR, contexto()));
  const { sessoes } = carregarSessoesDoTicket(banco, {
    demanda_id: demandaId,
    ticket_id: ticketPlanejar(ag).ticket_id,
  });
  const viva = sessoes[0] && situacao(sessoes[0].id);
  if (viva && !viva.ocupado) {
    mandar(viva.execucao, { type: "prompt", message: `Planejamento reprovado pelo Auditor. Motivo: ${motivo}` });
  }
  return ag;
}

/**
 * Prepara antes de confirmar (§6): garante a worktree da demanda e a de cada rodada do plano e só então grava a
 * aprovação. Falha de preparação deixa o gate aberto, vai ao log e sobe com o caminho da worktree. Repetível: o que já
 * existe é reaproveitado.
 */
export async function aprovarPlanejamentoDemanda(
  banco: DatabaseSync,
  demandaId: string,
  entrada: { nota?: number },
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, demandaId);
  // Ensaio: recusa antes de tocar o git (fase, falha, plano ausente).
  confirmarAprovacaoPlanejamento(ag, entrada, AUDITOR, contexto());
  const plano = Plano.parse(
    ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticketPlanejar(ag).ticket_id)?.dados,
  );
  const projeto = existe(
    configuracaoProjeto(banco, ag.demanda.projeto),
    `o projeto ${ag.demanda.projeto} não tem configuração do SDLC`,
    "configure o projeto",
  );
  const raiz = raizDo(banco);
  const worktree = {
    nome: projeto.nome,
    repo: projeto.raiz_git,
    branchBase: projeto.branch_base,
    preparacao: projeto.preparacao.map((c) => c.comando),
  };
  mkdirSync(join(raiz, "execucoes"), { recursive: true });
  const log = join(raiz, "execucoes", `planejamento-${demandaId}.log`);
  const passos = [
    {
      caminho: caminhoDaWorktreeDemanda(raiz, projeto.nome, demandaId),
      garantir: () => garantirWorktreeDemanda(raiz, worktree, demandaId, log, () => varrerBase(banco, projeto.nome)),
    },
    ...plano.rodadas.map(({ rodada_id }) => {
      const ref = { demanda_id: demandaId, rodada_id };
      return {
        caminho: caminhoDaWorktreeRodada(raiz, projeto.nome, ref),
        garantir: () => garantirWorktreeRodada(raiz, worktree, ref, log),
      };
    }),
  ];
  for (const { caminho, garantir } of passos) {
    try {
      await garantir();
    } catch (erro) {
      anotar(log, `preparação falhou em ${caminho}: ${mensagem(erro)}`);
      throw new ErroDeRegra(`${mensagem(erro)} (worktree ${caminho})`);
    }
  }
  const aprovada = comDemanda(banco, demandaId, (a) => confirmarAprovacaoPlanejamento(a, entrada, AUDITOR, contexto()));
  // O planejamento acabou: o pi ocioso à espera do gate para e a execução ganha o fim.
  const { sessoes } = carregarSessoesDoTicket(banco, {
    demanda_id: demandaId,
    ticket_id: ticketPlanejar(aprovada).ticket_id,
  });
  const viva = sessoes[0] && situacao(sessoes[0].id);
  if (viva) encerrar(viva.execucao);
  return aprovada;
}
