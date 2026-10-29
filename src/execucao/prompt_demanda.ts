// Prompt do ticket da demanda (comparacao-sdlc-implementacao.md §§6, 8 e 11, D09): Markdown montado do agregado da
// demanda, com o modo de trabalhar de `etapas/<etapa>.md`. Tickets e rodadas aparecem só pelo endereço público.
import { readFileSync } from "node:fs";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { catalogoDaEtapa } from "../dominio/evidencia_etapa.ts";
import type { EtapaTicket } from "../dominio/primitivos.ts";
import type { AnexoDaDemanda } from "../persistencia/evidencia_demanda.ts";
import { skillsDaEtapaDemanda } from "./pi_demanda.ts";

/** Um anexo de evidência da demanda com o caminho do arquivo no disco, que o agente lê direto. */
export type AnexoNoDisco = AnexoDaDemanda & { caminho: string };

export interface ContextoDemanda {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: { nome: string; branch_base: string };
  worktree: string;
  saida: string;
  retomada?: { tipo: "devolucao" | "reabertura"; motivo: string };
  /** Os anexos das evidências da demanda: a seção da etapa dá o caminho dos que o agente precisa ler. */
  anexos: readonly AnexoNoDisco[];
}

const secao = (titulo: string, texto: string): string => `## ${titulo}\n\n${texto.trim() || "(vazio)"}\n`;

type Criterio = Record<"id" | "dado" | "quando" | "entao", string>;
const linhaCriterio = (c: Criterio): string => `- **${c.id}**: dado ${c.dado}, quando ${c.quando}, então ${c.entao}.`;

const linhaDoAnexo = (a: AnexoNoDisco): string => `- \`${a.nome}\`: \`${a.caminho}\``;

interface DesenhoSolucao {
  resumo: string;
  arquivosPrevistos: Record<"caminho" | "acao" | "motivo", string>[];
  foraDeEscopo: string[];
}

/** Planejar: o desenho que o Auditor aprovou com a demanda e o HTML anexo; o plano parte dele. */
function secaoDesenhoAprovado({ ag, anexos }: ContextoDemanda): string {
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

type LinhaFitness = Record<"nome" | "descricao" | "comando" | "log", string> & {
  codigoSaida: number | null;
  estourou: boolean;
};

/** Revisar rodada: a matriz que a Fabriquinha coletou antes do pi, com o arquivo de cada log; o revisor a explica. */
function secaoMatrizFitness({ ag, ticket, anexos }: ContextoDemanda): string {
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

/**
 * Encerrar rodada: os arquivos alterados fora dos caminhos do plano, que a `mensagem_pr` justifica um a um. Vêm da
 * mesma revisão que a submissão confere: a última concluída da rodada.
 */
function secaoArquivosNaoPrevistos({ ag, ticket }: ContextoDemanda): string {
  const ultimaRevisaoConcluida = ag.tickets.findLast(
    (t) => t.rodada_id === ticket.rodada_id && t.etapa === "revisar_rodada" && t.status === "concluido",
  );
  const arquivosAlterados = ultimaRevisaoConcluida
    ? ((
        ag.evidencias.find((e) => e.tipo === "arquivos_alterados" && e.ticket_id === ultimaRevisaoConcluida.ticket_id)
          ?.dados as { arquivos: { caminho: string; previsto: string | null }[] } | undefined
      )?.arquivos ?? [])
    : [];
  const naoPrevistos = arquivosAlterados.filter((a) => a.previsto === null).map((a) => `- \`${a.caminho}\``);
  return secao(
    "Arquivos não previstos",
    "Alterados fora dos caminhos dos tickets do plano, segundo a última revisão concluída da rodada; " +
      "explique exatamente estes em `naoPrevistos` da mensagem do PR:\n\n" +
      (naoPrevistos.join("\n") || "(nenhum)"),
  );
}

/** As seções que só a etapa precisa, com dados que já existem quando o pi dela é lançado. */
const SECAO_DA_ETAPA: Partial<Record<EtapaTicket, (c: ContextoDemanda) => string>> = {
  planejar: secaoDesenhoAprovado,
  revisar_rodada: secaoMatrizFitness,
  encerrar_rodada: secaoArquivosNaoPrevistos,
};

/** O texto do modo de trabalhar da etapa, com os placeholders trocados pelos endereços públicos. */
function modoDeTrabalhar(etapa: string, enderecos: Record<"demanda" | "rodada" | "ticket", string>): string {
  let texto: string;
  try {
    texto = readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8");
  } catch {
    throw new Error(`a etapa ${etapa} não tem modo de trabalhar escrito (etapas/${etapa}.md)`);
  }
  return texto.replace(/\{(demanda|rodada|ticket)\}/g, (_, nome: keyof typeof enderecos) => enderecos[nome]);
}

export function montarPromptDemanda(c: ContextoDemanda): string {
  const { ag, ticket, retomada } = c;
  const { demanda } = ag;
  const endDemanda = demanda.id;
  const rodada = ag.rodadas.find((r) => r.rodada_id === ticket.rodada_id);
  const endRodada = rodada ? `${endDemanda}.R${String(rodada.rodada_id)}` : "(sem rodada)";
  const endTicket = `${endDemanda}.T${String(ticket.ticket_id)}`;
  const modo = modoDeTrabalhar(ticket.etapa, { demanda: endDemanda, rodada: endRodada, ticket: endTicket });

  const criterios =
    (
      ag.evidencias.find((e) => e.tipo === "criterios_aceite" && e.rodada_id === undefined && e.ticket_id === undefined)
        ?.dados as { criterios?: Criterio[] } | undefined
    )?.criterios ?? [];
  const citados = new Set(
    ag.criterios_citados.filter((x) => x.rodada_id === rodada?.rodada_id).map((x) => x.criterio_id),
  );
  const dependencias = ag.dependencias_ticket
    .filter((d) => d.ticket_id === ticket.ticket_id)
    .map((d) => `- ${endDemanda}.T${String(d.depende_ticket_id)}`);
  const caminhos = ag.caminhos_ticket.filter((x) => x.ticket_id === ticket.ticket_id).map((x) => `- \`${x.caminho}\``);
  const catalogo = catalogoDaEtapa(ticket.etapa);
  const doAgente = catalogo.filter((i) => i.produtor === "agente");
  const daFabriquinha = catalogo.filter((i) => i.produtor === "fabriquinha");
  const item = (i: (typeof catalogo)[number]) => `- \`${i.tipo}\`${i.obrigatoria ? "" : " (opcional)"}`;
  const skills = skillsDaEtapaDemanda(ticket.etapa);
  const secaoDaEtapa = SECAO_DA_ETAPA[ticket.etapa];

  const partes = [
    "# Contexto\n",
    [
      `- Projeto: ${c.projeto.nome} (branch base ${c.projeto.branch_base})`,
      `- Worktree (diretório de trabalho): ${c.worktree}`,
      `- Diretório de saída (\`$FABRIQUINHA_SAIDA\`): ${c.saida}`,
      "",
    ].join("\n"),
    secao("Demanda", `${endDemanda}, ${demanda.titulo} (${demanda.tipo})\n\n${demanda.descricao}`),
    secao("Critérios de aceite da demanda", criterios.map(linhaCriterio).join("\n")),
    secao(
      "Rodada",
      rodada
        ? `${endRodada}, ${rodada.titulo} (fase ${rodada.fase})\n\nCritérios citados:\n\n` +
            (criterios
              .filter((x) => citados.has(x.id))
              .map(linhaCriterio)
              .join("\n") || "(nenhum)")
        : "Este ticket não tem rodada.",
    ),
    secao(
      "Ticket",
      [
        `${endTicket}, ${ticket.titulo ?? "sem título"} (etapa ${ticket.etapa})`,
        ticket.descricao ?? "",
        `Dependências:\n\n${dependencias.join("\n") || "(nenhuma)"}`,
        `Caminhos:\n\n${caminhos.join("\n") || "(nenhum)"}`,
      ].join("\n\n"),
    ),
    ...(secaoDaEtapa ? [secaoDaEtapa(c)] : []),
    ...(retomada
      ? [
          secao(
            retomada.tipo === "devolucao" ? "Devolução" : "Reabertura",
            (retomada.tipo === "devolucao"
              ? `O ticket ${endTicket} foi devolvido a você: a entrega anterior não passou. Corrija o que o motivo aponta e não refaça o resto.`
              : `O Auditor reabriu o ticket ${endTicket}. Continue de onde a entrega anterior parou e atenda ao motivo.`) +
              `\n\nMotivo: ${retomada.motivo}`,
          ),
        ]
      : []),
    modo.trim() + "\n",
    secao(
      "Evidências",
      [
        doAgente.length > 0
          ? "Você submete (`fabriquinha evidencia schema <tipo>` mostra o formato; `fabriquinha evidencia add <tipo> --dados <arquivo.json> --arquivo <caminho>...` submete):\n\n" +
            doAgente.map(item).join("\n")
          : "Esta etapa não tem evidência do agente.",
        daFabriquinha.length > 0
          ? "A Fabriquinha produz:\n\n" + daFabriquinha.map(item).join("\n")
          : "A Fabriquinha não produz evidência nesta etapa.",
      ].join("\n\n"),
    ),
    ...(skills.length > 0
      ? [
          secao(
            "Skills de artefato",
            "Leia a skill de cada evidência antes de produzi-la:\n\n" + skills.map((s) => `- \`${s}\``).join("\n"),
          ),
        ]
      : []),
  ];
  return partes.join("\n");
}
