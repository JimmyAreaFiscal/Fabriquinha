// Prompt do ticket da demanda (comparacao-sdlc-implementacao.md §§6, 8 e 11, D09): Markdown montado do agregado da
// demanda, com o modo de trabalhar e a seção que só a Etapa lê, que a condução dela traz. Tickets e rodadas aparecem só
// pelo endereço público.
import { catalogoDaEtapa, lerModoDeTrabalhar } from "../../ciclo_de_vida/publico.ts";
import { secao, type SecaoDoPrompt } from "./secoes_do_prompt.ts";
import { type ContextoDoPrompt } from "../../sdlc/nucleo/contexto_do_prompt.ts";
import { skillsDaEtapaDemanda } from "../../sdlc/aplicacao/execucao/lancamento_do_ticket.ts";

type Criterio = Record<"id" | "dado" | "quando" | "entao", string>;
const linhaCriterio = (c: Criterio): string => `- **${c.id}**: dado ${c.dado}, quando ${c.quando}, então ${c.entao}.`;

/**
 * Tudo o que entra na conversa é reenviado a cada turno; arquivo inteiro despejado cedo é o maior custo das sessões
 * (investigação de 2026-11-04 sobre as sessões do pi).
 */
const SECAO_LEITURA_ECONOMICA = secao(
  "Leitura e edição",
  [
    "Tudo o que entra na conversa é reenviado a cada turno: leia só o que vai usar.",
    "",
    "- Localize com `grep -n` antes de abrir um arquivo e abra só a faixa que interessa, com `read` e `offset`/`limit`.",
    "- Não despeje arquivos inteiros, nem vários de uma vez, com `cat`, `sed -n` ou `head`.",
    "- Altere arquivos com `edit` e crie com `write`; não use heredoc, `python` ou `sed -i` para editar código.",
    "- Para explorar várias partes do código, delegue ao subagente `Explore` e traga só a conclusão.",
  ].join("\n"),
);

export function montarPromptDemanda(c: ContextoDoPrompt, secaoDaEtapa?: SecaoDoPrompt): string {
  const { ag, ticket, retomada } = c;
  const { demanda } = ag;
  const endDemanda = demanda.id;
  const rodada = ag.rodadas.find((r) => r.rodada_id === ticket.rodada_id);
  const endRodada = rodada ? `${endDemanda}.R${String(rodada.rodada_id)}` : "(sem rodada)";
  const endTicket = `${endDemanda}.T${String(ticket.ticket_id)}`;
  const modo = lerModoDeTrabalhar(ticket.etapa, { demanda: endDemanda, rodada: endRodada, ticket: endTicket });

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
        ? `${endRodada}, ${rodada.titulo} (estado ${rodada.estado})\n\nCritérios citados:\n\n` +
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
    ...(retomada ? [secao(retomada.titulo, retomada.texto)] : []),
    modo.trim() + "\n",
    SECAO_LEITURA_ECONOMICA,
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
