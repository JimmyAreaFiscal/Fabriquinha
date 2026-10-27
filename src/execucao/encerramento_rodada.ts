// Serviço Encerramento da rodada (comparacao-sdlc-implementacao.md §§4 e 6): conduz o `encerrar_rodada` até o gate do PR.
// Reserva e agente (documentação), relatório de produtividade, ponta da demanda (D04), PR da rodada, `pr_aberto` e
// conferência. A decisão do Auditor sobre o PR fica fora. Tickets e rodadas só pelo endereço público (D09).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import type { AgregadoDemanda, EvidenciaDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../dominio/demanda.ts";
import { predecessorasPendentes } from "../dominio/dependencia_demanda.ts";
import { ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import { validarEvidenciaDaEtapa } from "../dominio/evidencia_etapa.ts";
import { motivo } from "../dominio/primitivos.ts";
import { reservarTicket } from "../dominio/reserva_ticket.ts";
import { conferirPullRequestRodada } from "../dominio/transicoes_rodada.ts";
import { registrarFalhaTicket } from "../dominio/transicoes_demanda.ts";
import { LIMITE_DO_CORPO } from "../evidencias/pr.ts";
import { montarPRRodada, marcaDoPRRodada } from "../evidencias/pr_rodada.ts";
import { produtividadeDaRodada } from "../evidencias/produtividade_rodada.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { raizDo } from "../persistencia/banco.ts";
import { commitDoTicketDemanda } from "../persistencia/commits_demanda.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { predecessorasDaDemanda } from "../persistencia/dependencias_demanda.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { carregarSessoesDaDemanda } from "../persistencia/sessoes.ts";
import { publicarPRDe, verificarPR } from "../repositorio/pr.ts";
import { atualizarWorktreeRodada, caminhoDaWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { exigirGit } from "../repositorio/worktree.ts";
import { iniciarExecucaoDemanda } from "./execucao_demanda.ts";

export interface RefRodada {
  demanda_id: string;
  rodada_id: number;
}

const contexto = () => ({ agora: new Date().toISOString() });

/** A rodada em `encerramento` de uma demanda em `execucao` e o `encerrar_rodada` atual (o de maior id), num dos `status`. */
function encerramentoAtual(ag: AgregadoDemanda, ref: RefRodada, status: readonly TicketDemanda["status"][]) {
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não existe`,
    "use uma rodada da demanda",
  );
  if (ag.demanda.fase !== "execucao" || rodada.fase !== "encerramento") {
    throw new ErroDeRegra(
      `a rodada ${formatarRodadaRef(ref)} está em ${rodada.fase} e a demanda em ${ag.demanda.fase}`,
      "só se encerra a rodada em encerramento, numa demanda em execucao",
    );
  }
  const ticket = existe(
    ag.tickets
      .filter((t) => t.rodada_id === ref.rodada_id && t.etapa === "encerrar_rodada")
      .sort((a, b) => b.ticket_id - a.ticket_id)[0],
    `a rodada ${formatarRodadaRef(ref)} não tem ticket encerrar_rodada`,
    "confira o estado da rodada",
  );
  if (!status.includes(ticket.status)) {
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef(ticket)} está ${ticket.status}`,
      `só o encerrar_rodada ${status.join(" ou ")} segue`,
    );
  }
  return { rodada, ticket };
}

/**
 * Reserva o `encerrar_rodada` (aberto, só com as predecessoras satisfeitas) e roda o agente que escreve a documentação do
 * PR; com o ticket já em execução só roda de novo. Reabrir o ticket falho é chamar de novo.
 */
export function iniciarEncerramentoRodada(
  banco: DatabaseSync,
  ref: RefRodada,
  limiteMin: number,
): { id: string; fim: Promise<void> } {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const { ticket } = encerramentoAtual(ag, ref, ["aberto", "em_execucao"]);
  if (ticket.status === "aberto") {
    const satisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, ref.demanda_id)).length === 0;
    comDemanda(banco, ref.demanda_id, (a) =>
      reservarTicket(a, { ticket_id: ticket.ticket_id }, FABRIQUINHA, contexto(), satisfeitas),
    );
  }
  const retomada = ticket.instrucao ? { tipo: "reabertura" as const, motivo: ticket.instrucao } : undefined;
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
): void {
  const { demanda_id, ticket_id } = ticket;
  const e = validarEvidenciaDaEtapa(
    { demanda_id, ticket_id, etapa: "encerrar_rodada" },
    { demanda_id, ticket_id, tipo, produtor: "fabriquinha", dados },
  );
  comDemanda(banco, demanda_id, (ag) => ({
    ...ag,
    evidencias: [
      ...ag.evidencias.filter((x) => x.ticket_id !== ticket_id || x.tipo !== tipo),
      {
        demanda_id,
        rodada_id: undefined,
        ticket_id,
        tipo,
        dados: e.dados as EvidenciaDemanda["dados"],
        em: new Date().toISOString(),
      },
    ],
  }));
}

/** Os fatos da conferência vão ao domínio, que volta a `desenvolvimento` com as correções ou leva ao gate. */
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
 * 3. Incorpora a ponta da demanda (D04); conflito volta a `desenvolvimento` com uma correção por arquivo, sem PR.
 * 4. Publica (ou atualiza, pela marca do ticket) o PR da branch da rodada para a da demanda e grava o `pr_aberto`.
 * 5. Confere conflito e checks do PR: com problema volta a `desenvolvimento`, sem ele vai ao gate.
 * Erro de 2 a 5 falha o ticket com a mensagem e sobe; o `pr_aberto` só existe com o PR publicado.
 */
export async function concluirEncerramentoRodada(banco: DatabaseSync, ref: RefRodada): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const { rodada, ticket } = encerramentoAtual(ag, ref, ["em_execucao"]);
  const entregue = (tipo: string) => ag.evidencias.some((e) => e.ticket_id === ticket.ticket_id && e.tipo === tipo);
  if (!entregue("mensagem_pr") || !entregue("aula_codigo")) {
    return conferir(banco, ref, ticket, { documentacao_entregue: false, conflito: false, check_falho: false });
  }
  try {
    return await publicarEConferir(banco, ag, ref, rodada.branch, ticket);
  } catch (erro) {
    comDemanda(banco, ref.demanda_id, (a) =>
      registrarFalhaTicket(a, { ticket_id: ticket.ticket_id, motivo: motivo(mensagem(erro)) }, contexto()),
    );
    throw erro;
  }
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
  const projeto = existe(
    configuracaoProjeto(banco, demanda.projeto),
    `o projeto ${demanda.projeto} não tem configuração do SDLC`,
    "configure o projeto",
  );
  const raiz = raizDo(banco);
  mkdirSync(join(raiz, "execucoes"), { recursive: true });
  const log = join(raiz, "execucoes", `encerramento-${refRodada}.log`);

  const doRodada = ag.tickets.filter((t) => t.rodada_id === ref.rodada_id);
  const { sessoes, execucoes, usos } = carregarSessoesDaDemanda(banco, demanda.id);
  const relatorio = produtividadeDaRodada(sessoes, execucoes, usos, doRodada);
  gravarEvidencia(banco, ticket, "relatorio_produtividade", relatorio);

  const worktree = {
    nome: projeto.nome,
    repo: projeto.raiz_git,
    branchBase: projeto.branch_base,
    preparacao: projeto.preparacao.map((c) => c.comando),
  };
  const atualizacao = await atualizarWorktreeRodada(raiz, worktree, ref, log);
  if (atualizacao.status === "conflito") {
    const correcoes = atualizacao.arquivos.map((arquivo, i) =>
      correcao(
        ref,
        i + 1,
        `Resolver o conflito de ${arquivo} com ${demanda.branch}`,
        `A ${refRodada} não incorpora a ponta de ${demanda.branch}: ${arquivo} conflita. Resolva o conflito na rodada.`,
        [arquivo],
      ),
    );
    return conferir(banco, ref, ticket, { documentacao_entregue: true, conflito: true, check_falho: false, correcoes });
  }

  const pr = montarPRRodada(ag, ref.rodada_id, ticket.ticket_id, relatorio, LIMITE_DO_CORPO[projeto.hospedagem]);
  const registrados = new Set(
    doRodada
      .filter((t) => t.etapa === "implementar")
      .map((t) => commitDoTicketDemanda(banco, demanda.id, t.ticket_id)?.sha),
  );
  const conferirCommits = async (head: string) => {
    const novos = (
      await exigirGit(projeto.raiz_git, "rev-list", "--no-merges", `refs/heads/${demanda.branch}..${head}`)
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
    { nome: projeto.nome, repo: projeto.raiz_git, hospedagem: projeto.hospedagem },
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
  gravarEvidencia(banco, ticket, "pr_aberto", {
    ...publicado,
    base: demanda.branch,
    corpoCompleto: pr.completo,
    condensado: pr.completo !== pr.publicado,
  });
  anotar(log, `${refRodada}: PR ${publicado.id} publicado, ${publicado.url}`);

  const problemas = await verificarPR({ repo: projeto.raiz_git, hospedagem: projeto.hospedagem }, publicado.id, log);
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
