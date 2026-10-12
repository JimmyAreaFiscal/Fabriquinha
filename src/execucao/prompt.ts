// Prompt da etapa (F4 §6.3): Markdown montado do agregado da issue, com o modo de trabalhar e o CLI da etapa, que
// ficam em `etapas/<etapa>.md`, versionados com o código.
import { readFileSync } from "node:fs";
import type { Agregado, ModoExecucao, Ticket } from "../dominio/agregado.ts";
import type { Etapa } from "../dominio/primitivos.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { skillsDaEtapa } from "./pi.ts";

export interface Contexto {
  ag: Agregado;
  ticket: Ticket;
  /** A instrução do Auditor lida antes de C5, que a consome (F4 §6.4). */
  instrucao: string | undefined;
  projeto: Pick<Projeto, "nome" | "branchBase">;
  worktree: string;
  saida: string;
  modo: ModoExecucao;
}

const secao = (titulo: string, texto: string): string => `## ${titulo}\n\n${texto.trim() || "(vazio)"}\n`;

/** Os `dados` da evidência `tipo` mais recente da issue: a do último desenho, que é o aprovado, por exemplo. */
const dadosDe = (ag: Agregado, tipo: string): Record<string, unknown> | undefined =>
  ag.evidencias.findLast((e) => e.tipo === tipo)?.dados;

// Os formatos vêm dos schemas do F3, validados na submissão.
type Criterio = Record<"id" | "dado" | "quando" | "entao", string>;
interface DesenhoSolucao {
  resumo: string;
  arquivosPrevistos: Record<"caminho" | "acao" | "motivo", string>[];
  foraDeEscopo: string[];
}

const criteriosDeAceite = (ag: Agregado): string =>
  secao(
    "Critérios de aceite",
    ((dadosDe(ag, "criterios_aceite")?.criterios ?? []) as Criterio[])
      .map((c) => `- **${c.id}**: dado ${c.dado}, quando ${c.quando}, então ${c.entao}.`)
      .join("\n"),
  );

/**
 * O contexto próprio da etapa (F4 §6.3). O registro leva as dependências informadas (o resto vem da conversa); o
 * desenho lê o registro: o resumo do comportamento e os critérios. O desenvolvimento lê o desenho aprovado, os
 * critérios e os tickets de desenvolvimento já concluídos.
 * ponytail: revisão, encerramento e sessão ganham o seu contexto com os tickets 16, 20 e 21.
 */
const CONTEXTO_DA_ETAPA: Partial<Record<Etapa, (ag: Agregado) => string[]>> = {
  registro: (ag) => [secao("Dependências informadas", ag.issue.deps.map((d) => `- I-${String(d)}`).join("\n"))],
  desenho: (ag) => [
    secao(
      "Comportamento registrado",
      (dadosDe(ag, "comportamento") as { descricao: string } | undefined)?.descricao ?? "",
    ),
    criteriosDeAceite(ag),
  ],
  desenvolvimento: (ag) => {
    const desenho = dadosDe(ag, "desenho_solucao") as DesenhoSolucao | undefined;
    const concluidos = ag.tickets.filter((t) => t.etapa === "desenvolvimento" && t.status === "concluido");
    return [
      secao("Desenho aprovado", desenho?.resumo ?? ""),
      secao(
        "Arquivos previstos",
        (desenho?.arquivosPrevistos ?? []).map((a) => `- \`${a.caminho}\` (${a.acao}): ${a.motivo}`).join("\n"),
      ),
      secao("Fora do escopo", (desenho?.foraDeEscopo ?? []).map((f) => `- ${f}`).join("\n")),
      criteriosDeAceite(ag),
      secao(
        "Tickets de desenvolvimento já concluídos",
        concluidos.map((t) => `- T-${String(t.id)}, ${t.titulo}`).join("\n"),
      ),
    ];
  },
};

/** O texto do modo de trabalhar e do CLI da etapa. */
const textoDaEtapa = (etapa: Etapa): string => readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8");

export function montarPrompt(c: Contexto): string {
  const { ag, ticket } = c;
  const issue = ag.issue;
  const skills = skillsDaEtapa(ticket.etapa);
  const partes = [
    ...(c.instrucao ? [`# Instrução do Auditor\n\n${c.instrucao.trim()}\n`] : []),
    "# Contexto\n",
    [
      `- Projeto: ${c.projeto.nome} (branch base ${c.projeto.branchBase})`,
      `- Issue: I-${String(issue.id)}, ${issue.titulo ?? "sem título"} (${issue.tipo ?? "tipo ainda não definido"})`,
      `- Seu ticket: T-${String(ticket.id)}, ${ticket.titulo} (etapa ${ticket.etapa})`,
      `- Worktree (diretório de trabalho): ${c.worktree}`,
      `- Diretório de saída (\`$FABRIQUINHA_SAIDA\`): ${c.saida}`,
      "",
    ].join("\n"),
    secao("Descrição da issue", issue.descricao),
    secao("Descrição do ticket", ticket.descricao),
    ...(CONTEXTO_DA_ETAPA[ticket.etapa]?.(ag) ?? []),
    textoDaEtapa(ticket.etapa).trim() + "\n",
    ...(skills.length > 0
      ? [
          secao(
            "Skills de artefato",
            "Leia a skill de cada evidência antes de produzi-la:\n\n" + skills.map((s) => `- \`${s}\``).join("\n"),
          ),
        ]
      : []),
    ...(c.modo === "autonomo"
      ? [
          secao(
            "Execução autônoma",
            "Ninguém acompanha esta execução para responder perguntas. Decida com o que você tem e registre a " +
              "dúvida no artefato em que ela pesa.",
          ),
        ]
      : []),
  ];
  return partes.join("\n");
}
