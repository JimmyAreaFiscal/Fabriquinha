// As seções do prompt que só o `encerrar_rodada` lê: os arquivos não previstos e o impacto que a `mensagem_pr` explica.
import { ticketAtualDaEtapa } from "../../../planejamento/publico.ts";
import { impactoExigeReversao } from "../../../evidencias/publico.ts";
import { arquivosAlteradosDoRevisor, secao } from "../prompt/secoes_do_prompt.ts";
import { type ContextoDoPrompt } from "../prompt/contexto_do_prompt.ts";

/**
 * Encerrar rodada: os arquivos alterados fora dos caminhos do plano, que a `mensagem_pr` justifica um a um. Vêm da
 * mesma revisão que a submissão confere: a última concluída da rodada.
 */
function secaoArquivosNaoPrevistos({ ag, ticket }: ContextoDoPrompt): string {
  const ultimaRevisaoConcluida = ticketAtualDaEtapa(
    ag,
    "revisar_rodada",
    ticket.rodada_id,
    (t) => t.estado === "concluido",
  );
  const arquivosAlterados = ultimaRevisaoConcluida
    ? (arquivosAlteradosDoRevisor(ag, ultimaRevisaoConcluida.ticket_id)?.arquivos ?? [])
    : [];
  const naoPrevistos = arquivosAlterados.filter((a) => a.previsto === null).map((a) => `- \`${a.caminho}\``);
  return secao(
    "Arquivos não previstos",
    "Alterados fora dos caminhos dos tickets do plano, segundo a última revisão concluída da rodada; " +
      "explique exatamente estes em `naoPrevistos` da mensagem do PR:\n\n" +
      (naoPrevistos.join("\n") || "(nenhum)"),
  );
}

/** Encerrar rodada: o impacto do relatório da demanda, a mesma fonte com que a submissão da `mensagem_pr` exige `reversao`. */
function secaoImpactoArquitetura({ ag }: ContextoDoPrompt): string {
  const impacto = ag.evidencias.find((e) => e.tipo === "relatorio_impactos_arquitetura")?.dados.impacto as
    string | undefined;
  return secao(
    "Impacto na arquitetura",
    impactoExigeReversao(impacto)
      ? `${String(impacto)}: escreva em \`reversao\` da mensagem do PR como desfazer a mudança.`
      : `${impacto ?? "a demanda não tem relatório de impactos"}: \`reversao\` é opcional na mensagem do PR.`,
  );
}

export const secaoDoPromptDoEncerrarRodada = (contexto: ContextoDoPrompt): string =>
  secaoArquivosNaoPrevistos(contexto) + "\n" + secaoImpactoArquitetura(contexto);
