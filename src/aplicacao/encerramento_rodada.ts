// Serviço Encerramento da rodada (comparacao-sdlc-implementacao.md §§4 e 6): conduz o `encerrar_rodada` até o gate do PR.
// Reserva e agente (documentação), relatório de produtividade, ponta da demanda (D04), PR da rodada, `pr_aberto` e
// conferência. A decisão do Auditor sobre o PR fica fora. Tickets e rodadas só pelo endereço público (D09).
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import {
  type AgregadoDemanda,
  comPrDaRodada,
  type EvidenciaDemanda,
  type TicketDemanda,
} from "../nucleo/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../nucleo/demanda.ts";
import { predecessorasPendentes } from "../nucleo/dependencia_demanda.ts";
import { ErroDeRegra, existe } from "../nucleo/erros.ts";
import { ticketAtualDaEtapa } from "../nucleo/item_de_trabalho.ts";
import { validarEvidenciaDaEtapa } from "../nucleo/evidencia_etapa.ts";
import { reservarTicket } from "../nucleo/reserva_ticket.ts";
import { falhaDoErro, retornoAoAgenteDoTicket } from "../nucleo/tentativa.ts";
import { conferirPullRequestRodada } from "../nucleo/transicoes_rodada.ts";
import { registrarFalhaTicket } from "../nucleo/transicoes_demanda.ts";
import { LIMITE_DO_CORPO } from "./evidencias/pr.ts";
import { montarPRRodada, marcaDoPRRodada } from "./evidencias/pr_rodada.ts";
import { produtividadeDaRodada } from "./evidencias/produtividade_rodada.ts";
import { varrerBase } from "./retrabalho.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { commitDoTicketDemanda } from "../armazenamento/commits_demanda.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../armazenamento/dependencias_demanda.ts";
import { anotar, logDaOperacao } from "../infra/registro.ts";
import { carregarTrabalhosDaDemanda } from "../armazenamento/trabalho_agentico.ts";
import { publicarPRDe } from "../infra/repositorio/pr.ts";
import { ConferenciaDoPR } from "../infra/verificacao/conferencia_do_pr.ts";
import { exigidaPelaEtapa } from "../infra/verificacao/verificacao.ts";
import { atualizarWorktreeRodada, caminhoDaWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { exigirGit } from "../infra/repositorio/worktree.ts";
import { aprovarPRRodadaSeAutomatico } from "./aprovacao_pr_rodada.ts";
import { iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { condutor } from "./trabalho/condutor.ts";

export interface RefRodada {
  demanda_id: string;
  rodada_id: number;
}

const contexto = () => ({ agora: new Date().toISOString() });

/** Tempo máximo do resumo do contexto do PR; passado, o PR vai sem o contexto. */
const LIMITE_RESUMO_MS = 3 * 60_000;

/** O contexto do PR (demanda, tickets e custo) resumido por uma chamada do pi com o modelo padrão. */
async function resumirContextoDoPR(contexto: string, limite: number): Promise<string | undefined> {
  const prompt = [
    `Resuma, em português e em Markdown, o contexto do pull request abaixo em no máximo ${String(limite)} caracteres.`,
    "Mantenha o porquê da demanda, os endereços (como I-206.R2 e I-206.T3) e o custo total.",
    "Não use títulos (#). Responda só com o resumo.",
    contexto,
  ].join("\n\n");
  return (await condutor.consultar(prompt, undefined, LIMITE_RESUMO_MS))?.trim();
}

/** A rodada em `encerrar_rodada`, numa demanda em `em_execucao`. */
function rodadaEmEncerramento(ag: AgregadoDemanda, ref: RefRodada) {
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não existe`,
    "use uma rodada da demanda",
  );
  if (ag.demanda.estado !== "em_execucao" || rodada.estado !== "encerrar_rodada") {
    throw new ErroDeRegra(
      `a rodada ${formatarRodadaRef(ref)} está em ${rodada.estado} e a demanda em ${ag.demanda.estado}`,
      "só se encerra a rodada em encerrar_rodada, numa demanda em em_execucao",
    );
  }
  return rodada;
}

/** O `encerrar_rodada` atual da rodada em encerramento, num dos `estados`. */
function encerramentoNoEstado(ag: AgregadoDemanda, ref: RefRodada, estados: readonly TicketDemanda["estado"][]) {
  const ticket = existe(
    ticketAtualDaEtapa(ag, "encerrar_rodada", ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem ticket encerrar_rodada`,
    "confira o estado da rodada",
  );
  if (!estados.includes(ticket.estado)) {
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef(ticket)} está ${ticket.estado}`,
      `só o encerrar_rodada ${estados.join(" ou ")} segue`,
    );
  }
  return ticket;
}

/**
 * Reserva o `encerrar_rodada` (aberto, só com as predecessoras satisfeitas) e roda o agente que escreve a documentação do
 * PR; com o ticket já em execução só roda de novo. Reabrir o ticket falho é chamar de novo.
 */
export function iniciarEncerramentoRodada(
  banco: DatabaseSync,
  ref: RefRodada,
  limiteMin: number,
): ReturnType<typeof iniciarExecucaoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  rodadaEmEncerramento(ag, ref);
  const ticket = encerramentoNoEstado(ag, ref, ["aberto", "em_execucao"]);
  if (ticket.estado === "aberto") {
    const satisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, ref.demanda_id)).length === 0;
    comDemanda(banco, ref.demanda_id, (a) =>
      reservarTicket(a, { ticket_id: ticket.ticket_id }, FABRIQUINHA, contexto(), satisfeitas),
    );
  }
  const retomada = retornoAoAgenteDoTicket(carregarDemanda(banco, ref.demanda_id).tentativas, ticket.ticket_id);
  return iniciarExecucaoDemanda(
    banco,
    { demanda_id: ref.demanda_id, ticket_id: ticket.ticket_id },
    { limiteMin, retomada },
  );
}

/** Uma correção da rodada: id local, na rodada, sem dependências (o domínio renumera). */
const correcao = (ref: RefRodada, n: number, titulo: string, descricao: string, caminhos: string[] = []) => ({
  demanda_id: ref.demanda_id,
  ticket_id: n,
  rodada_id: ref.rodada_id,
  titulo: titulo.replaceAll(/\s+/g, " ").slice(0, 120),
  descricao,
  caminhos,
});

/** Grava a evidência da Fabriquinha no ticket, no lugar da anterior do mesmo tipo (o domínio não tem transição para isso). */
function gravarEvidencia(
  banco: DatabaseSync,
  ticket: TicketDemanda,
  tipo: "relatorio_produtividade" | "pr_aberto",
  dados: unknown,
  prPublicado?: { rodada_id: number; id: string; url: string; head: string },
): void {
  const { demanda_id, ticket_id } = ticket;
  const e = validarEvidenciaDaEtapa(
    { demanda_id, ticket_id, etapa: "encerrar_rodada" },
    { demanda_id, ticket_id, tipo, produtor: "fabriquinha", dados },
  );
  const em = new Date().toISOString();
  comDemanda(banco, demanda_id, (ag) => ({
    ...ag,
    // O PR do Espaço da rodada acompanha a evidência, na mesma gravação.
    pull_requests:
      prPublicado === undefined
        ? ag.pull_requests
        : comPrDaRodada(ag, prPublicado.rodada_id, {
            numero: Number(prPublicado.id),
            url: prPublicado.url,
            head: prPublicado.head,
            estado: "aberto",
            atualizado_em: em,
          }),
    evidencias: [
      ...ag.evidencias.filter((x) => x.ticket_id !== ticket_id || x.tipo !== tipo),
      {
        demanda_id,
        rodada_id: undefined,
        ticket_id,
        tipo,
        dados: e.dados as EvidenciaDemanda["dados"],
        autor: FABRIQUINHA,
        em,
      },
    ],
  }));
}

/** Os fatos da conferência vão ao domínio, que volta a `implementar` com as correções ou leva ao gate. */
function conferir(
  banco: DatabaseSync,
  ref: RefRodada,
  ticket: TicketDemanda,
  fatos: { documentacao_entregue: boolean; conflito: boolean; check_falho: boolean; correcoes?: unknown[] },
): AgregadoDemanda {
  return comDemanda(banco, ref.demanda_id, (ag) =>
    conferirPullRequestRodada(ag, { ...ref, ticket_id: ticket.ticket_id, ...fatos }, FABRIQUINHA, contexto()),
  );
}

/**
 * Conclui o `encerrar_rodada` em execução até a conferência do PR. Repetível: o ticket não muda antes dela.
 * 1. Sem `mensagem_pr` e `aula_codigo` do ticket, o domínio recusa a conferência e o ticket segue em execução.
 * 2. Grava o `relatorio_produtividade`.
 * 3. Incorpora a ponta da demanda (D04); conflito volta a `implementar` com uma correção para o merge, sem PR.
 * 4. Publica (ou atualiza, pela marca do ticket) o PR da branch da rodada para a da demanda e grava o `pr_aberto`.
 * 5. Confere conflito e checks do PR: com problema volta a `implementar`, sem ele vai ao gate.
 * 6. No projeto com a aprovação automática, o PR que chegou ao gate é aprovado ali mesmo.
 * Erro de 2 a 5 falha o ticket com a mensagem e sobe; o `pr_aberto` só existe com o PR publicado.
 */
export async function concluirEncerramentoRodada(banco: DatabaseSync, ref: RefRodada): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const rodada = rodadaEmEncerramento(ag, ref);
  const ticket = encerramentoNoEstado(ag, ref, ["em_execucao"]);
  const entregue = (tipo: string) => ag.evidencias.some((e) => e.ticket_id === ticket.ticket_id && e.tipo === tipo);
  if (!entregue("mensagem_pr") || !entregue("aula_codigo")) {
    return conferir(banco, ref, ticket, { documentacao_entregue: false, conflito: false, check_falho: false });
  }
  let conferido: AgregadoDemanda;
  try {
    conferido = await publicarEConferir(banco, ag, ref, rodada.branch, ticket);
  } catch (erro) {
    comDemanda(banco, ref.demanda_id, (a) =>
      registrarFalhaTicket(a, { ticket_id: ticket.ticket_id, falha: falhaDoErro(erro) }, contexto()),
    );
    throw erro;
  }
  return aprovarPRRodadaSeAutomatico(banco, conferido, ref);
}

async function publicarEConferir(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  ref: RefRodada,
  branchRodada: string,
  ticket: TicketDemanda,
): Promise<AgregadoDemanda> {
  const { demanda } = ag;
  const refRodada = formatarRodadaRef(ref);
  const projeto = carregarProjeto(banco, demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `encerramento-${refRodada}`);

  const doRodada = ag.tickets.filter((t) => t.rodada_id === ref.rodada_id);
  const { sessoes, execucoes, usos } = carregarTrabalhosDaDemanda(banco, demanda.id);
  const relatorio = produtividadeDaRodada(sessoes, execucoes, usos, doRodada);
  gravarEvidencia(banco, ticket, "relatorio_produtividade", relatorio);

  const atualizacao = await atualizarWorktreeRodada(raiz, projeto, ref, log);
  if (atualizacao.status === "conflito") {
    // Um merge, um corretivo: quem resolve um arquivo resolve o merge inteiro, e um por arquivo rodava os outros à toa.
    const arquivosEmConflito = atualizacao.arquivos.join(", ");
    const correcoes = [
      correcao(
        ref,
        1,
        `Resolver o conflito da ${refRodada} com ${demanda.branch}`,
        `A ${refRodada} não incorpora a ponta de ${demanda.branch}: ${arquivosEmConflito} conflita(m). ` +
          "Resolva o conflito de todos na rodada.",
        atualizacao.arquivos,
      ),
    ];
    return conferir(banco, ref, ticket, { documentacao_entregue: true, conflito: true, check_falho: false, correcoes });
  }

  const pr = await montarPRRodada(
    ag,
    ref.rodada_id,
    ticket.ticket_id,
    relatorio,
    LIMITE_DO_CORPO[projeto.hospedagem],
    async (contexto, limite) => {
      const resumo = await resumirContextoDoPR(contexto, limite);
      if (resumo === undefined || resumo.length > limite) {
        anotar(log, `${refRodada}: o pi não resumiu o contexto do PR em ${String(limite)} caracteres; vai sem ele`);
      }
      return resumo;
    },
  );
  const registrados = new Set(
    doRodada
      .filter((t) => t.etapa === "implementar")
      .map((t) => commitDoTicketDemanda(banco, demanda.id, t.ticket_id)?.sha),
  );
  const conferirCommits = async (head: string) => {
    // Commit que já está na base publicada veio de trazer a base para a rodada (merge), não de um agente: não é órfão.
    const basePublicada = `refs/remotes/origin/${projeto.branch_base}`;
    await exigirGit(projeto.raiz_git, "fetch", "origin", `+refs/heads/${projeto.branch_base}:${basePublicada}`);
    const novos = (
      await exigirGit(
        projeto.raiz_git,
        "rev-list",
        "--no-merges",
        head,
        `^refs/heads/${demanda.branch}`,
        `^${basePublicada}`,
      )
    )
      .split("\n")
      .filter(Boolean);
    const orfao = novos.find((sha) => !registrados.has(sha));
    if (orfao === undefined) return;
    throw new ErroDeRegra(
      `a branch ${branchRodada} tem o commit ${orfao.slice(0, 12)}, que nenhum ticket de desenvolvimento da ${refRodada} registrou: ` +
        "um agente commitou fora do desenvolvimento, e esse commit não sobe no PR",
      `desfaça com git -C ${caminhoDaWorktreeRodada(raiz, projeto.nome, ref)} reset --hard HEAD~1, repetindo até a HEAD ` +
        "ser um commit de ticket da Fabriquinha, e reabra o ticket",
    );
  };
  // Os PRs que os `encerrar_rodada` anteriores da rodada já registraram; a marca cobre o que a queda deixou sem registro.
  const anteriores = new Set<number | undefined>(
    doRodada.filter((t) => t.etapa === "encerrar_rodada" && t.ticket_id < ticket.ticket_id).map((t) => t.ticket_id),
  );
  const conhecidos = ag.evidencias
    .filter((e) => e.tipo === "pr_aberto" && anteriores.has(e.ticket_id))
    .map((e) => (e.dados as { id: string }).id);
  const publicado = await publicarPRDe(
    raiz,
    projeto,
    { branch: branchRodada, base: demanda.branch, publicarBase: true },
    {
      titulo: pr.titulo,
      corpo: pr.publicado,
      conhecidos,
      marca: marcaDoPRRodada(demanda.id, ticket.ticket_id),
    },
    conferirCommits,
    () => varrerBase(banco, projeto.nome),
    log,
  );
  gravarEvidencia(
    banco,
    ticket,
    "pr_aberto",
    {
      ...publicado,
      base: demanda.branch,
      corpoCompleto: pr.completo,
      condensado: pr.completo !== pr.publicado,
    },
    { ...publicado, rodada_id: ref.rodada_id },
  );
  anotar(log, `${refRodada}: PR ${publicado.id} publicado, ${publicado.url}`);

  const problemas = await exigidaPelaEtapa(
    "encerrar_rodada",
    new ConferenciaDoPR(projeto, publicado.id, log),
  ).conferir();
  const correcoes = [
    ...(problemas.conflito
      ? [
          correcao(
            ref,
            1,
            `Resolver o conflito do PR da ${refRodada} com ${demanda.branch}`,
            `O PR ${publicado.url} da ${refRodada} conflita com ${demanda.branch}. Resolva o conflito na rodada.`,
          ),
        ]
      : []),
    ...problemas.checksFalhos.map(({ nome, url }, i) =>
      correcao(
        ref,
        i + 1 + Number(problemas.conflito),
        `Corrigir o check ${nome} do PR da ${refRodada}`,
        `O check ${nome} falhou no PR ${publicado.url} da ${refRodada}${[url]
          .filter((u): u is string => Boolean(u))
          .map((u) => ` (${u})`)
          .join("")}. Corrija a causa.`,
      ),
    ),
  ];
  return conferir(banco, ref, ticket, {
    documentacao_entregue: true,
    conflito: problemas.conflito,
    check_falho: problemas.checksFalhos.length > 0,
    ...(correcoes.length > 0 && { correcoes }),
  });
}
