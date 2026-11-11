// As seções do prompt que só o `revisar_rodada` lê: as revisões anteriores, o diff e a matriz que a Fabriquinha apurou
// antes do agente, e as verificações já feitas no último commit da rodada.
import {
  arquivosAlteradosDoRevisor,
  type ArquivosAlterados,
  linhaDoAnexo,
  secao,
  secaoVerificacoesJaFeitas,
} from "../prompt/secoes_do_prompt.ts";
import { type ContextoDoPrompt } from "../../sdlc/nucleo/contexto_do_prompt.ts";

type LinhaFitness = Record<"nome" | "descricao" | "comando" | "log", string> & {
  codigoSaida: number | null;
  estourou: boolean;
};

/** Revisar rodada: a matriz que a Fabriquinha coletou antes do pi, com o arquivo de cada log; o revisor a explica. */
function secaoMatrizFitness({ ag, ticket, anexos }: ContextoDoPrompt): string {
  const ehMatrizDoTicket = (e: { tipo: string; ticket_id?: number }) =>
    e.tipo === "matriz_fitness" && e.ticket_id === ticket.ticket_id;
  const linhasDaMatriz =
    (ag.evidencias.find(ehMatrizDoTicket)?.dados as { linhas: LinhaFitness[] } | undefined)?.linhas ?? [];
  const resultadoDoComando = (l: LinhaFitness) =>
    l.estourou ? "estourou o tempo" : `saiu com código ${String(l.codigoSaida)}`;
  return secao(
    "Matriz de fitness functions",
    "A Fabriquinha rodou cada fitness function na worktree antes desta execução:\n\n" +
      (linhasDaMatriz
        .map((l) => `- **${l.nome}** (${l.descricao}): \`${l.comando}\` ${resultadoDoComando(l)}; log \`${l.log}\``)
        .join("\n") || "(nenhuma)") +
      "\n\nOs logs, em arquivos que você lê:\n\n" +
      (anexos.filter(ehMatrizDoTicket).map(linhaDoAnexo).join("\n") || "(nenhum)"),
  );
}

/** Revisar rodada: o diff da rodada que a Fabriquinha apurou antes do pi, cada arquivo com o caminho do plano que casou. */
function secaoArquivosAlterados({ ag, ticket }: ContextoDoPrompt): string {
  const alterados = arquivosAlteradosDoRevisor(ag, ticket.ticket_id);
  const linhasDoDiff = (a: ArquivosAlterados["arquivos"][number]) =>
    a.adicionadas === null ? "binário" : `+${String(a.adicionadas)} −${String(a.removidas)}`;
  return secao(
    "Arquivos alterados",
    "O diff da rodada contra a branch da demanda, apurado pela Fabriquinha antes desta execução, com o caminho dos " +
      "tickets do plano que cada arquivo casou:\n\n" +
      ((alterados?.arquivos ?? [])
        .map((a) => `- \`${a.caminho}\` (${a.status}, ${linhasDoDiff(a)}): ${a.previsto ?? "não previsto"}`)
        .join("\n") || "(nenhum)") +
      "\n\nCaminhos do plano que a rodada não tocou:\n\n" +
      ((alterados?.previstosNaoTocados ?? []).map((c) => `- \`${c}\``).join("\n") || "(nenhum)"),
  );
}

/**
 * Revisar rodada: o que cada ticket anterior da rodada recusou (revisão ou gate do PR), os corretivos que a recusa gerou
 * (`implementar` até a revisão seguinte) e as perguntas que ela fez com resposta; a revisão confere isso e não reabre.
 */
function secaoRevisoesAnteriores({ ag, ticket, perguntasDasRevisoesAnteriores }: ContextoDoPrompt): string {
  const endereco = (id: number) => `${ag.demanda.id}.T${String(id)}`;
  const daRodada = ag.tickets.filter((t) => t.rodada_id === ticket.rodada_id);
  const idsDasRevisoes = daRodada.filter((t) => t.etapa === "revisar_rodada").map((t) => t.ticket_id);
  const entradas = ag.decisoes
    .filter((d) => d.resultado === "reprovado" && d.ticket_id < ticket.ticket_id)
    .flatMap((d) => {
      const reprovado = daRodada.find((t) => t.ticket_id === d.ticket_id);
      return reprovado ? [{ decisao: d, etapa: reprovado.etapa }] : [];
    })
    .sort((a, b) => a.decisao.ticket_id - b.decisao.ticket_id)
    .map(({ decisao, etapa }) => {
      const proximaRevisao = Math.min(...idsDasRevisoes.filter((id) => id > decisao.ticket_id), Infinity);
      const corretivos = daRodada
        .filter((t) => t.etapa === "implementar" && t.ticket_id > decisao.ticket_id && t.ticket_id < proximaRevisao)
        .map((t) => endereco(t.ticket_id));
      const perguntas = (perguntasDasRevisoesAnteriores?.get(decisao.ticket_id) ?? []).map(
        (p) => `  - Pergunta: ${p.pergunta}\n    Resposta: ${p.resposta}`,
      );
      return [
        `- ${endereco(decisao.ticket_id)} (${etapa}), reprovado: ${String(decisao.motivo)}`,
        ...(corretivos.length ? [`  - Corretivos: ${corretivos.join(", ")}`] : []),
        ...perguntas,
      ].join("\n");
    });
  return secao(
    "Revisões anteriores da rodada",
    "Decisões reprovadas dos tickets anteriores da rodada, pelo revisor ou pelo Auditor; confira cada uma e não " +
      "reabra o que já foi decidido:\n\n" +
      (entradas.join("\n") || "(nenhuma)"),
  );
}

export const secaoDoPromptDoRevisarRodada = (contexto: ContextoDoPrompt): string =>
  [
    secaoRevisoesAnteriores(contexto),
    secaoArquivosAlterados(contexto),
    secaoMatrizFitness(contexto),
    secaoVerificacoesJaFeitas(contexto),
  ].join("\n");
