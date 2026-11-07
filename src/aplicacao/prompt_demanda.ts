// Prompt do ticket da demanda (comparacao-sdlc-implementacao.md §§6, 8 e 11, D09): Markdown montado do agregado da
// demanda, com o modo de trabalhar de `etapas/<etapa>.md`. Tickets e rodadas aparecem só pelo endereço público.
import { readFileSync } from "node:fs";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { catalogoDaEtapa } from "../nucleo/evidencia_etapa.ts";
import type { EtapaTicket } from "../nucleo/primitivos.ts";
import { impactoExigeReversao } from "../nucleo/schemas.ts";
import type { AnexoDaDemanda } from "../armazenamento/evidencia_demanda.ts";
import { skillsDaEtapaDemanda } from "./pi_demanda.ts";

/** Um anexo de evidência da demanda com o caminho do arquivo no disco, que o agente lê direto. */
type AnexoNoDisco = AnexoDaDemanda & { caminho: string };

export interface ContextoDemanda {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: { nome: string; branch_base: string };
  worktree: string;
  saida: string;
  retomada?: { tipo: "devolucao" | "reabertura"; motivo: string };
  /** Os anexos das evidências da demanda: a seção da etapa dá o caminho dos que o agente precisa ler. */
  anexos: readonly AnexoNoDisco[];
  /** As perguntas respondidas na sessão de cada ticket (por `ticket_id`); a seção de revisões anteriores as lista. */
  perguntasDasRevisoesAnteriores?: ReadonlyMap<number, readonly { pergunta: string; resposta: string }[]>;
  /** O SHA do commit de cada ticket que a Fabriquinha commitou (por `ticket_id`); as revisões leem o que já foi verificado nele. */
  commitsDosTickets?: ReadonlyMap<number, string>;
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

interface ArquivosAlterados {
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
const arquivosAlteradosDoRevisor = (ag: AgregadoDemanda, revisor: number): ArquivosAlterados | undefined =>
  ag.evidencias.find((e) => e.tipo === "arquivos_alterados" && e.ticket_id === revisor)?.dados as
    ArquivosAlterados | undefined;

/** Revisar rodada: o diff da rodada que a Fabriquinha apurou antes do pi, cada arquivo com o caminho do plano que casou. */
function secaoArquivosAlterados({ ag, ticket }: ContextoDemanda): string {
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
 * Encerrar rodada: os arquivos alterados fora dos caminhos do plano, que a `mensagem_pr` justifica um a um. Vêm da
 * mesma revisão que a submissão confere: a última concluída da rodada.
 */
function secaoArquivosNaoPrevistos({ ag, ticket }: ContextoDemanda): string {
  const ultimaRevisaoConcluida = ag.tickets.findLast(
    (t) => t.rodada_id === ticket.rodada_id && t.etapa === "revisar_rodada" && t.status === "concluido",
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
function secaoImpactoArquitetura({ ag }: ContextoDemanda): string {
  const impacto = ag.evidencias.find((e) => e.tipo === "relatorio_impactos_arquitetura")?.dados.impacto as
    string | undefined;
  return secao(
    "Impacto na arquitetura",
    impactoExigeReversao(impacto)
      ? `${String(impacto)}: escreva em \`reversao\` da mensagem do PR como desfazer a mudança.`
      : `${impacto ?? "a demanda não tem relatório de impactos"}: \`reversao\` é opcional na mensagem do PR.`,
  );
}

/**
 * Revisar rodada: o que cada ticket anterior da rodada recusou (revisão ou gate do PR), os corretivos que a recusa gerou
 * (`implementar` até a revisão seguinte) e as perguntas que ela fez com resposta; a revisão confere isso e não reabre.
 */
function secaoRevisoesAnteriores({ ag, ticket, perguntasDasRevisoesAnteriores }: ContextoDemanda): string {
  const endereco = (id: number) => `${ag.demanda.id}.T${String(id)}`;
  const daRodada = ag.tickets.filter((t) => t.rodada_id === ticket.rodada_id);
  const idsDasRevisoes = daRodada.filter((t) => t.etapa === "revisar_rodada").map((t) => t.ticket_id);
  const entradas = ag.decisoes
    .filter((d) => d.resultado === "recusado" && d.ticket_id < ticket.ticket_id)
    .flatMap((d) => {
      const recusado = daRodada.find((t) => t.ticket_id === d.ticket_id);
      return recusado ? [{ decisao: d, etapa: recusado.etapa }] : [];
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
        `- ${endereco(decisao.ticket_id)} (${etapa}), recusado: ${String(decisao.motivo)}`,
        ...(corretivos.length ? [`  - Corretivos: ${corretivos.join(", ")}`] : []),
        ...perguntas,
      ].join("\n");
    });
  return secao(
    "Revisões anteriores da rodada",
    "Decisões recusadas dos tickets anteriores da rodada, pelo revisor ou pelo Auditor; confira cada uma e não " +
      "reabra o que já foi decidido:\n\n" +
      (entradas.join("\n") || "(nenhuma)"),
  );
}

const VERIFICACOES_DO_COMMIT = ["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const;

/**
 * Revisões: o que a Fabriquinha já verificou no último commit de cada rodada (testes, fitness e Sonar, antes de
 * commitar o ticket), com os comandos e os logs. Código igual ao verificado não precisa rodar de novo.
 */
function secaoVerificacoesJaFeitas({ ag, ticket, anexos, commitsDosTickets }: ContextoDemanda): string {
  const rodadas = ticket.etapa === "revisar_rodada" ? [ticket.rodada_id] : ag.rodadas.map((r) => r.rodada_id);
  const linhas = rodadas.flatMap((rodada_id) => {
    const ultimo = ag.tickets.findLast(
      (t) => t.rodada_id === rodada_id && t.etapa === "implementar" && commitsDosTickets?.has(t.ticket_id),
    );
    if (!ultimo) return [];
    const doTicket = (e: { tipo: string; ticket_id?: number }) => e.ticket_id === ultimo.ticket_id;
    const verificacoes = VERIFICACOES_DO_COMMIT.map((tipo) => {
      const dados = ag.evidencias.findLast((e) => doTicket(e) && e.tipo === tipo)?.dados as
        { aprovada?: boolean; comandos?: { comando: string; codigoSaida: number | null }[] } | undefined;
      const comandos = (dados?.comandos ?? []).map((c) => `\`${c.comando}\` saiu com ${String(c.codigoSaida)}`);
      // O mesmo log pode vir de mais de uma tentativa do ticket: vale o da última, gravada por último.
      const logs = [...new Map(anexos.filter((a) => doTicket(a) && a.tipo === tipo).map((a) => [a.nome, a])).values()];
      return (
        `  - \`${tipo}\`: ${dados?.aprovada === true ? "aprovada" : "não aprovada"}` +
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

/** As seções que só a etapa precisa, com dados que já existem quando o pi dela é lançado. */
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

const SECAO_DA_ETAPA: Partial<Record<EtapaTicket, (c: ContextoDemanda) => string>> = {
  planejar: secaoDesenhoAprovado,
  revisar_rodada: (c) =>
    [secaoRevisoesAnteriores(c), secaoArquivosAlterados(c), secaoMatrizFitness(c), secaoVerificacoesJaFeitas(c)].join(
      "\n",
    ),
  revisar_demanda: secaoVerificacoesJaFeitas,
  encerrar_rodada: (c) => secaoArquivosNaoPrevistos(c) + "\n" + secaoImpactoArquitetura(c),
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
