// As peças de seção do prompt do ticket que mais de uma Etapa usa, sem I/O: a condução de cada Etapa traz as seções que
// só ela lê, e a montagem (`prompt_demanda.ts`) as junta ao modo de trabalhar.
import type { AgregadoDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { AnexoNoDisco, ContextoDoPrompt } from "./contexto_do_prompt.ts";
import { ticketAtualDaEtapa } from "../../../planejamento/publico.ts";

/** A seção do prompt que só uma Etapa lê, com dados que já existem quando o agente dela é lançado. */
export type SecaoDoPrompt = (contexto: ContextoDoPrompt) => string;

export const secao = (titulo: string, texto: string): string => `## ${titulo}\n\n${texto.trim() || "(vazio)"}\n`;

export const linhaDoAnexo = (a: AnexoNoDisco): string => `- \`${a.nome}\`: \`${a.caminho}\``;

export interface ArquivosAlterados {
  arquivos: {
    caminho: string;
    status: string;
    adicionadas: number | null;
    removidas: number | null;
    previsto: string | null;
  }[];
  previstosNaoTocados: string[];
}

/** O `arquivos_alterados` que a Fabriquinha gravou no ticket revisor antes do pi dele. */
export const arquivosAlteradosDoRevisor = (ag: AgregadoDemanda, revisor: number): ArquivosAlterados | undefined =>
  ag.evidencias.find((e) => e.tipo === "arquivos_alterados" && e.ticket_id === revisor)?.dados as
    ArquivosAlterados | undefined;

const VERIFICACOES_DO_COMMIT = ["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const;

/**
 * Revisões: o que a Fabriquinha já verificou no último commit de cada rodada (testes, fitness e Sonar, antes de
 * commitar o ticket), com os comandos e os logs. Código igual ao verificado não precisa rodar de novo.
 */
export function secaoVerificacoesJaFeitas({ ag, ticket, anexos, commitsDosTickets }: ContextoDoPrompt): string {
  const rodadas = ticket.etapa === "revisar_rodada" ? [ticket.rodada_id] : ag.rodadas.map((r) => r.rodada_id);
  const linhas = rodadas.flatMap((rodada_id) => {
    const ultimo = ticketAtualDaEtapa(
      ag,
      "implementar",
      rodada_id,
      (t) => commitsDosTickets?.has(t.ticket_id) === true,
    );
    if (!ultimo) return [];
    const doTicket = (e: { tipo: string; ticket_id?: number }) => e.ticket_id === ultimo.ticket_id;
    const verificacoes = VERIFICACOES_DO_COMMIT.map((tipo) => {
      const evidencia = ag.evidencias.findLast((e) => doTicket(e) && e.tipo === tipo);
      const dados = evidencia?.dados as { comandos?: { comando: string; codigoSaida: number | null }[] } | undefined;
      const comandos = (dados?.comandos ?? []).map((c) => `\`${c.comando}\` saiu com ${String(c.codigoSaida)}`);
      // O mesmo log pode vir de mais de uma tentativa do ticket: vale o da última, gravada por último.
      const logs = [...new Map(anexos.filter((a) => doTicket(a) && a.tipo === tipo).map((a) => [a.nome, a])).values()];
      return (
        `  - \`${tipo}\`: ${evidencia === undefined ? "sem evidência aceita" : "evidência aceita"}` +
        (comandos.length > 0 ? ` (${comandos.join("; ")})` : "") +
        `; logs: ${logs.map((a) => `\`${a.caminho}\``).join(", ") || "(nenhum)"}`
      );
    });
    const endereco = `${ag.demanda.id}.T${String(ultimo.ticket_id)}`;
    return [
      `- ${ag.demanda.id}.R${String(rodada_id)}: último commit ${endereco}, \`${String(commitsDosTickets?.get(ultimo.ticket_id))}\``,
      ...verificacoes,
    ];
  });
  return secao(
    "Verificações já feitas",
    "A Fabriquinha rodou estas verificações no commit de cada ticket abaixo, antes de commitá-lo. Se " +
      "`git rev-parse HEAD^{tree}` na worktree é igual a `git rev-parse <sha>^{tree}` de um deles e " +
      "`git status --porcelain` está vazio, o código é o verificado: use estes resultados e logs, sem rodar de novo " +
      "os comandos listados.\n\n" +
      (linhas.join("\n") || "(nenhuma)"),
  );
}
