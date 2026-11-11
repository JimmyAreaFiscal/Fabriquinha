// As seções do prompt que só o `planejar` lê.
import { linhaDoAnexo, secao } from "../prompt/secoes_do_prompt.ts";
import { type ContextoDoPrompt } from "../../sdlc/nucleo/contexto_do_prompt.ts";

interface DesenhoSolucao {
  resumo: string;
  arquivosPrevistos: Record<"caminho" | "acao" | "motivo", string>[];
  foraDeEscopo: string[];
}

/** Planejar: o desenho que o Auditor aprovou com a demanda e o HTML anexo; o plano parte dele. */
export function secaoDoPromptDoPlanejar({ ag, anexos }: ContextoDoPrompt): string {
  const ehDesenhoDaDemanda = (e: { tipo: string; rodada_id?: number; ticket_id?: number }) =>
    e.tipo === "desenho_solucao" && e.rodada_id === undefined && e.ticket_id === undefined;
  const desenho = ag.evidencias.find(ehDesenhoDaDemanda)?.dados as DesenhoSolucao | undefined;
  return secao(
    "Desenho aprovado",
    desenho
      ? [
          desenho.resumo,
          "Arquivos previstos:\n\n" +
            desenho.arquivosPrevistos.map((a) => `- \`${a.caminho}\` (${a.acao}): ${a.motivo}`).join("\n"),
          "Fora de escopo:\n\n" + (desenho.foraDeEscopo.map((f) => `- ${f}`).join("\n") || "(nada)"),
          "O HTML do desenho, num arquivo que você lê:\n\n" +
            anexos.filter(ehDesenhoDaDemanda).map(linhaDoAnexo).join("\n"),
        ].join("\n\n")
      : "",
  );
}
