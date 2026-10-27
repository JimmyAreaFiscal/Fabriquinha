// Prompt do ticket da demanda (comparacao-sdlc-implementacao.md §§6, 8 e 11, D09): Markdown montado do agregado da
// demanda, com o modo de trabalhar de `etapas/<etapa>.md`. Tickets e rodadas aparecem só pelo endereço público.
import { readFileSync } from "node:fs";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { catalogoDaEtapa } from "../dominio/evidencia_etapa.ts";
import { skillsDaEtapaDemanda } from "./pi_demanda.ts";

export interface ContextoDemanda {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: { nome: string; branch_base: string };
  worktree: string;
  saida: string;
  retomada?: { tipo: "devolucao" | "reabertura"; motivo: string };
}

const secao = (titulo: string, texto: string): string => `## ${titulo}\n\n${texto.trim() || "(vazio)"}\n`;

type Criterio = Record<"id" | "dado" | "quando" | "entao", string>;
const linhaCriterio = (c: Criterio): string => `- **${c.id}**: dado ${c.dado}, quando ${c.quando}, então ${c.entao}.`;

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
