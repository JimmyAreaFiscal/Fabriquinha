// Coleta por etapa depois do pi (F3 §7). Só roda quando o pi terminou bem; se ele falhou, o ticket falha direto.
import type { DatabaseSync } from "node:sqlite";
import type { Agregado, Ticket, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Etapa, Id } from "../dominio/primitivos.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import { commitarTicket } from "../repositorio/commit.ts";
import { descartarAlteracoes } from "../repositorio/worktree.ts";
import { coletarFitness, coletarTestes } from "./coletores.ts";
import { coletarSonar } from "./sonar.ts";

/** O que a coleta grava na mesma transação do C7 do ticket (F5 §4, passo 4). */
export type NaConclusao = (banco: DatabaseSync) => void;

type Coleta = (banco: DatabaseSync, ticket: Ticket, worktree: string, log: string) => Promise<NaConclusao | undefined>;

const descartar: Coleta = async (_banco, _ticket, worktree, log) => {
  await descartarAlteracoes(worktree, log);
  return undefined;
};

/** Roda o coletor e devolve o agregado se a evidência `tipo` saiu aprovada; senão, o ticket falha. */
async function exigirAprovada(
  banco: DatabaseSync,
  ticket: Id,
  tipo: TipoEvidencia,
  coletar: (banco: DatabaseSync, ticket: Id) => Promise<Agregado>,
): Promise<Agregado> {
  const ag = await coletar(banco, ticket);
  if (!ag.evidencias.some((e) => e.ticket === ticket && e.tipo === tipo && e.aprovada === true)) {
    const t = `T-${String(ticket)}`;
    throw new ErroDeRegra(
      `a evidência ${tipo} de ${t} reprovou`,
      `veja o que reprovou com fabriquinha evidencia ver ${t} ${tipo} e execute o ticket de novo`,
    );
  }
  return ag;
}

/**
 * F3 §7: testes, fitness e SonarQube (D6), parando no primeiro reprovado, e o commit (F5 §4, D4), que volta para a
 * transação do C7. O desenvolvimento não descarta nada: é a única etapa que muda código.
 */
const desenvolver: Coleta = async (banco, ticket) => {
  await exigirAprovada(banco, ticket.id, "execucao_testes", coletarTestes);
  await exigirAprovada(banco, ticket.id, "matriz_fitness", coletarFitness);
  const { issue } = await exigirAprovada(banco, ticket.id, "relatorio_sonar", coletarSonar);
  const commit = await commitarTicket(banco, issue.projeto, issue, ticket);
  return (b) => {
    gravarCommit(b, ticket.id, commit);
  };
};

/**
 * Registro e desenho não mudam código: o descarte (F5 §3.3) vem depois de as evidências estarem guardadas.
 * ponytail: revisão, encerramento e sessão entram aqui com os tickets 16, 20 e 21.
 */
const DEPOIS_DO_PI: Partial<Record<Etapa, Coleta>> = {
  registro: descartar,
  desenho: descartar,
  desenvolvimento: desenvolver,
};

/**
 * F3 §9: o que a Fabriquinha faz na worktree e no banco ao fim do pi do ticket; etapa sem coleta não faz nada.
 * Devolve o que gravar na transação do C7, quando há.
 */
export async function depoisDoPi(
  banco: DatabaseSync,
  ticket: Ticket,
  worktree: string,
  log: string,
): Promise<NaConclusao | undefined> {
  return DEPOIS_DO_PI[ticket.etapa]?.(banco, ticket, worktree, log);
}
