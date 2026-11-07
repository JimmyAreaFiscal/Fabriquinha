// Serviço Planejamento da demanda (comparacao-sdlc-implementacao.md §§3 e 6): junta reserva, sessão interativa, plano e
// preparação das worktrees. Só orquestra as regras do domínio; git e preparação ficam fora da transação.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR, FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclos.ts";
import { Plano } from "../nucleo/demanda.ts";
import { predecessorasPendentes } from "../nucleo/dependencia_demanda.ts";
import { ErroDeRegra, existe, mensagem } from "../nucleo/erros.ts";
import { confirmarAprovacaoPlanejamento, reabrirTicket, reprovarPlanejamento } from "../nucleo/transicoes_demanda.ts";
import { reservarTicket } from "../nucleo/reserva_ticket.ts";
import { varrerBase } from "./retrabalho.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../armazenamento/dependencias_demanda.ts";
import { anotar } from "../infra/registro.ts";
import { carregarSessoesDoTicket } from "../armazenamento/sessoes.ts";
import {
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "../infra/repositorio/worktree-demanda.ts";
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
 * só retoma a mesma sessão. Reprovada, a retomada leva o motivo da última decisão; reaberta, a instrução do ticket.
 */
export function iniciarOuRetomarPlanejamento(
  banco: DatabaseSync,
  demandaId: string,
  limiteMin: number,
): { id: string; fim: Promise<void> } {
  const ag = carregarDemanda(banco, demandaId);
  CICLO_DA_DEMANDA.exigir(ag.demanda, "planejar");
  const ticket = ticketPlanejar(ag);
  if (ticket.estado === "aberto") {
    const satisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, demandaId)).length === 0;
    comDemanda(banco, demandaId, (a) =>
      reservarTicket(a, { ticket_id: ticket.ticket_id }, FABRIQUINHA, contexto(), satisfeitas),
    );
  } else if (ticket.estado !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket de planejamento da demanda ${demandaId} está ${ticket.estado} e não pode ser iniciado`,
      "só se inicia ou retoma o planejamento com o ticket aberto ou em execução",
    );
  }
  const ref = { demanda_id: demandaId, ticket_id: ticket.ticket_id };
  const ultima = ag.decisoes.filter((d) => d.ticket_id === ticket.ticket_id).at(-1);
  // A reprovação é o último fato da conversa: o motivo dela vem antes da instrução, que pode ser de uma reabertura
  // anterior (ou a cópia do próprio motivo, quando a reprovação reabriu o ticket falho).
  const retomada =
    ultima?.resultado === "recusado"
      ? { tipo: "devolucao" as const, motivo: existe(ultima.motivo, "a reprovação não tem motivo", "confira o banco") }
      : ticket.instrucao
        ? { tipo: "reabertura" as const, motivo: ticket.instrucao }
        : undefined;
  // Plano aprovado e depois descartado: a conversa que o produziu não volta, senão o agente reenvia o mesmo plano. O
  // replanejamento começa em sessão nova; já começado (execução depois da aprovação), é ele que se retoma.
  const iniciarEmSessaoNova =
    ultima?.resultado === "aprovado" &&
    !carregarSessoesDoTicket(banco, ref).execucoes.some((e) => e.inicio >= ultima.em);
  return iniciarExecucaoDemanda(banco, ref, { limiteMin, modo: "interativo", retomada, iniciarEmSessaoNova });
}

/**
 * O Auditor reprova com motivo; a demanda volta a `planejar`. Com o pi da sessão vivo e ocioso, o motivo vai a ele
 * como prompt; sem pi vivo, o despacho retoma a mesma sessão com o motivo.
 */
export function reprovarPlanejamentoDemanda(banco: DatabaseSync, demandaId: string, motivo: string): AgregadoDemanda {
  // Planejar Falhou (serviço reiniciado com o gate aberto): a reprovação o reabre com o motivo, na mesma transação.
  const ag = comDemanda(banco, demandaId, (a) => {
    const reprovada = reprovarPlanejamento(a, { motivo }, AUDITOR, contexto());
    const { ticket_id, estado } = ticketPlanejar(reprovada);
    return estado === "falhou"
      ? reabrirTicket(reprovada, { ticket_id, instrucao: motivo }, AUDITOR, contexto())
      : reprovada;
  });
  const { sessoes } = carregarSessoesDoTicket(banco, {
    demanda_id: demandaId,
    ticket_id: ticketPlanejar(ag).ticket_id,
  });
  const atual = sessoes.at(-1);
  const viva = atual && situacao(atual.id);
  if (viva && !viva.ocupado) {
    mandar(viva.execucao, { type: "prompt", message: `Planejamento reprovado pelo Auditor. Motivo: ${motivo}` });
  }
  return ag;
}

/**
 * Prepara antes de confirmar (§6): garante a worktree da demanda e a de cada rodada independente e só então grava a
 * aprovação. Falha de preparação deixa o gate aberto, vai ao log e sobe com o caminho da worktree. Repetível: o que já
 * existe é reaproveitado.
 */
export async function aprovarPlanejamentoDemanda(
  banco: DatabaseSync,
  demandaId: string,
  entrada: { nota?: number },
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, demandaId);
  // Ensaio: recusa antes de tocar o git (estado, falha, plano ausente).
  confirmarAprovacaoPlanejamento(ag, entrada, AUDITOR, contexto());
  const plano = Plano.parse(
    ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticketPlanejar(ag).ticket_id)?.dados,
  );
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  mkdirSync(join(raiz, "execucoes"), { recursive: true });
  const log = join(raiz, "execucoes", `planejamento-${demandaId}.log`);
  const passos = [
    {
      caminho: caminhoDaWorktreeDemanda(raiz, projeto.nome, demandaId),
      garantir: () => garantirWorktreeDemanda(raiz, projeto, demandaId, log, () => varrerBase(banco, projeto.nome)),
    },
    // D04: a rodada dependente nasce quando começa, da ponta da demanda já com as predecessoras integradas.
    ...plano.rodadas
      .filter((rodada) => rodada.depende.length === 0)
      .map(({ rodada_id }) => {
        const ref = { demanda_id: demandaId, rodada_id };
        return {
          caminho: caminhoDaWorktreeRodada(raiz, projeto.nome, ref),
          garantir: () => garantirWorktreeRodada(raiz, projeto, ref, log),
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
  const atual = sessoes.at(-1);
  const viva = atual && situacao(atual.id);
  if (viva) encerrar(viva.execucao);
  return aprovada;
}
