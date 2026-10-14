// Coleta por etapa antes e depois do pi (F3 §7). O depois só roda quando o pi terminou bem; se ele falhou, o ticket
// falha direto.
import type { DatabaseSync } from "node:sqlite";
import type { Agregado, Contexto, Ticket, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Etapa, Id } from "../dominio/primitivos.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { commitarTicket } from "../repositorio/commit.ts";
import { descartarAlteracoes } from "../repositorio/worktree.ts";
import {
  coletarArquivosAlterados,
  coletarFitness,
  coletarPR,
  coletarProdutividade,
  coletarTestes,
  verificarOPR,
} from "./coletores.ts";
import { coletarSonar } from "./sonar.ts";

/** O que a coleta grava na mesma transação do C7 do ticket (F5 §4, passo 4). */
export type NaConclusao = (banco: DatabaseSync, ctx: Contexto) => Contexto;

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
  return (b, ctx) => {
    gravarCommit(b, ticket.id, commit);
    return ctx;
  };
};

/**
 * F3 §7: o encerramento descarta o que o agente mexeu, para não subir lixo no PR; registra o relatório de
 * produtividade (F6) e publica o PR (F5), cada um por C17. O C7 só vem depois, e exige as quatro evidências da etapa.
 * Se a publicação sair e o registro de `pr_aberto` falhar, o ticket falha; a próxima execução reconhece o PR pela
 * marca do ticket e o adota (`publicarPR`).
 */
const encerrar: Coleta = async (banco, ticket, worktree, log) => {
  await descartarAlteracoes(worktree, log);
  await coletarProdutividade(banco, ticket.id);
  anotar(log, "relatorio_produtividade registrado");
  await coletarPR(banco, ticket.id, log);
  anotar(log, "pr_aberto registrado");
  const problemasPR = await verificarOPR(banco, ticket.id, log);
  const falhos = `${String(problemasPR.checksFalhos.length)} check(s) falho(s)`;
  anotar(log, `PR verificado: ${problemasPR.conflito ? "com conflito" : falhos}`);
  return (_b, ctx) => ({ ...ctx, problemasPR });
};

/**
 * Desenho, revisão e encerramento são autônomos e não mudam código: o descarte (F5 §3.3) vem depois de as
 * evidências estarem guardadas. Registro e sessão em aberto são interativos e descartam ao encerrar a etapa, no F4.
 */
const DEPOIS_DO_PI: Partial<Record<Etapa, Coleta>> = {
  desenho: descartar,
  desenvolvimento: desenvolver,
  revisao: descartar,
  encerramento: encerrar,
};

/**
 * F3 §7, antes do pi, em ordem: o que a revisão lê e explica, coletado da worktree como o desenvolvimento a deixou.
 * Na revisão, a matriz de fitness não barra a execução: reprovada, ela obriga o agente a reprovar a revisão (F3 §8).
 */
const ANTES_DO_PI: Partial<
  Record<Etapa, readonly [TipoEvidencia, (banco: DatabaseSync, ticket: Id) => Promise<Agregado>][]>
> = {
  revisao: [
    ["arquivos_alterados", coletarArquivosAlterados],
    ["matriz_fitness", coletarFitness],
  ],
};

/**
 * F3 §9: o que a Fabriquinha coleta antes de lançar o pi do ticket, já em execução, anotando cada coleta no `log` da
 * execução. Devolve o agregado com o que coletou, para o prompt levar (F4 §6.3); etapa sem coleta devolve `ag` como
 * veio. Uma falha lança, e o F4 falha o ticket como em qualquer passo da execução.
 */
export async function antesDoPi(banco: DatabaseSync, ag: Agregado, ticket: Ticket, log: string): Promise<Agregado> {
  let atual = ag;
  for (const [tipo, coletar] of ANTES_DO_PI[ticket.etapa] ?? []) {
    anotar(log, `coleta antes do pi: ${tipo}`);
    atual = await coletar(banco, ticket.id);
    anotar(log, `coleta antes do pi: ${tipo} registrada`);
  }
  return atual;
}

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
