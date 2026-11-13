// Serviço Encerramento da rodada (comparacao-sdlc-implementacao.md §§4 e 6): o que a `ConducaoDeEncerrarRodada` faz depois do
// agente (documentação) até o gate do PR: relatório de produtividade, ponta da demanda (D04), PR da rodada, `pr_aberto` e
// conferência. A decisão do Auditor sobre o PR fica fora. Tickets e rodadas só pelo endereço público (D09).
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA, formatarRodadaRef, formatarTicketRef, Endereco } from "../../../etapas/publico.ts";
import {
  type AgregadoDemanda,
  carregarDemanda,
  conferirPRDaRodada,
  registrarPRDaRodada,
  submeterEvidencia,
  type TicketDemanda,
} from "../../../processo/publico.ts";
import { ErroDeRegra, existe } from "../../../../../shared/nucleo/erros.ts";
import { ticketAtualDaEtapa } from "../../../planejamento/publico.ts";
import { espacoDoTicket, montarRepositorio } from "../../../../repositorio/publico.ts";
import { LIMITE_DO_CORPO } from "./documentacao_do_pr/corpo_do_pr.ts";
import { montarPRRodada, marcaDoPRRodada } from "./documentacao_do_pr/pr_rodada.ts";
import { produtividadeDaRodada } from "../../../metricas_de_qualidade/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { anotar, logDaOperacao } from "../../../../../shared/infra/registro.ts";
import { ConferenciaDoPR, montarVerificacoesDaEtapa } from "../../../verificacoes/publico.ts";
import type { Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { condutor } from "../politica_dos_agentes/condutor.ts";
import { carregarSessoesDoContexto, registrarUsoDaConsulta } from "../../../../sessoes/publico.ts";
import { projetosCadastrados } from "../projetos_cadastrados.ts";

export interface RefRodada {
  demanda_id: string;
  rodada_id: number;
}

/** Tempo máximo do resumo do contexto do PR; passado, o PR vai sem o contexto. */
const LIMITE_RESUMO_MS = 3 * 60_000;

/**
 * O contexto do PR (demanda, tickets e custo) resumido por uma chamada do pi com o modelo padrão. O Uso da consulta conta
 * para a rodada: vai à última execução do `encerrar_rodada`, que é da rodada.
 */
async function resumirContextoDoPR(
  banco: DatabaseSync,
  ticket: TicketDemanda,
  contexto: string,
  limite: number,
): Promise<string | undefined> {
  const prompt = [
    `Resuma, em português e em Markdown, o contexto do pull request abaixo em no máximo ${String(limite)} caracteres.`,
    "Mantenha o porquê da demanda, os endereços (como I-206.R2 e I-206.T3) e o custo total.",
    "Não use títulos (#). Responda só com o resumo.",
    contexto,
  ].join("\n\n");
  const resposta = await condutor.consultar(prompt, undefined, LIMITE_RESUMO_MS);
  const execucaoDoEncerramento = carregarSessoesDoContexto(banco, ticket).execucoes.at(-1);
  if (resposta && execucaoDoEncerramento) {
    registrarUsoDaConsulta(banco, ticket, execucaoDoEncerramento.id, resposta.uso);
  }
  return resposta?.saida.trim();
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

/** O `encerrar_rodada` atual da rodada em encerramento, em execução. */
function encerramentoEmExecucao(ag: AgregadoDemanda, ref: RefRodada) {
  const ticket = existe(
    ticketAtualDaEtapa(ag, "encerrar_rodada", ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem ticket encerrar_rodada`,
    "confira o estado da rodada",
  );
  if (ticket.estado !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef(ticket)} está ${ticket.estado}`,
      "só o encerrar_rodada em_execucao segue",
    );
  }
  return ticket;
}

/** Uma correção da rodada: id local, na rodada, sem dependências (o domínio renumera). */
const correcao = (ref: RefRodada, n: number, titulo: string, descricao: string, arquivos_previstos: string[] = []) => ({
  demanda_id: ref.demanda_id,
  ticket_id: n,
  rodada_id: ref.rodada_id,
  titulo: titulo.replaceAll(/\s+/g, " ").slice(0, 120),
  descricao,
  arquivos_previstos,
});

/** As evidências do encerramento não têm anexo: nenhuma origem é lida. */
const SEM_ORIGEM_DE_ANEXO = { worktree: "", saida: "", fora: "", copie: "" };

/** Submete a evidência da Fabriquinha ao ticket; a recusa sobe como erro, que falha o ticket, e nada é gravado. */
function submeterEvidenciaDoEncerramento(
  banco: DatabaseSync,
  ticket: TicketDemanda,
  tipo: "relatorio_produtividade" | "pr_aberto",
  dados: unknown,
): void {
  const avaliacao = submeterEvidencia(
    banco,
    {
      tipo,
      dono: Endereco.doTicket(ticket.demanda_id, ticket.ticket_id),
      produtor: FABRIQUINHA,
      dados,
      anexos: [],
    },
    { origens: SEM_ORIGEM_DE_ANEXO },
  );
  if (avaliacao.resultado === "recusada") {
    throw new ErroDeRegra(avaliacao.motivo, `corrija o ${tipo} do encerramento da rodada e reabra o ticket`);
  }
}

/** Os fatos da conferência vão ao domínio, que volta a `implementar` com as correções ou leva ao gate. */
function conferir(
  banco: DatabaseSync,
  relogio: Relogio,
  ref: RefRodada,
  ticket: TicketDemanda,
  fatos: { documentacao_entregue: boolean; conflito: boolean; check_falho: boolean; correcoes?: unknown[] },
): AgregadoDemanda {
  return conferirPRDaRodada(
    banco,
    ref.demanda_id,
    { ...ref, ticket_id: ticket.ticket_id, ...fatos },
    FABRIQUINHA,
    relogio,
  );
}

/**
 * Conclui o `encerrar_rodada` em execução até a conferência do PR. Repetível: o ticket não muda antes dela.
 * 1. Sem `mensagem_pr` e `aula_codigo` do ticket, o domínio recusa a conferência e o ticket segue em execução.
 * 2. Grava o `relatorio_produtividade`.
 * 3. Incorpora a ponta da demanda (D04); conflito volta a `implementar` com uma correção para o merge, sem PR.
 * 4. Publica (ou atualiza, pela marca do ticket) o PR da branch da rodada para a da demanda e grava o `pr_aberto`.
 * 5. Confere conflito e checks do PR: com problema volta a `implementar`, sem ele vai ao gate.
 * O erro sobe para a condução falhar o ticket; o `pr_aberto` só existe com o PR publicado.
 */
export async function conferirEncerramentoRodada(
  banco: DatabaseSync,
  relogio: Relogio,
  ref: RefRodada,
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const rodada = rodadaEmEncerramento(ag, ref);
  const ticket = encerramentoEmExecucao(ag, ref);
  const entregue = (tipo: string) => ag.evidencias.some((e) => e.ticket_id === ticket.ticket_id && e.tipo === tipo);
  if (!entregue("mensagem_pr") || !entregue("aula_codigo")) {
    return conferir(banco, relogio, ref, ticket, {
      documentacao_entregue: false,
      conflito: false,
      check_falho: false,
    });
  }
  return publicarEConferir(banco, relogio, ag, ref, rodada.branch, ticket);
}

async function publicarEConferir(
  banco: DatabaseSync,
  relogio: Relogio,
  ag: AgregadoDemanda,
  ref: RefRodada,
  branchRodada: string,
  ticket: TicketDemanda,
): Promise<AgregadoDemanda> {
  const { demanda } = ag;
  const refRodada = formatarRodadaRef(ref);
  const projeto = projetosCadastrados().carregarProjeto(banco, demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `encerramento-${refRodada}`);

  const doRodada = ag.tickets.filter((t) => t.rodada_id === ref.rodada_id);
  const { sessoes, execucoes, usos } = carregarSessoesDoContexto(banco, { demanda_id: demanda.id, ticket_id: null });
  const relatorio = produtividadeDaRodada(sessoes, execucoes, usos, doRodada);
  submeterEvidenciaDoEncerramento(banco, ticket, "relatorio_produtividade", relatorio);

  const espaco = espacoDoTicket(ag, { rodada_id: ref.rodada_id }, projeto, raiz);
  const repositorio = montarRepositorio({ banco });
  const atualizacao = await repositorio.atualizarComBase(projeto, espaco, log);
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
    return conferir(banco, relogio, ref, ticket, {
      documentacao_entregue: true,
      conflito: true,
      check_falho: false,
      correcoes,
    });
  }

  const pr = await montarPRRodada(
    ag,
    ref.rodada_id,
    ticket.ticket_id,
    relatorio,
    LIMITE_DO_CORPO[projeto.hospedagem],
    async (contexto, limite) => {
      const resumo = await resumirContextoDoPR(banco, ticket, contexto, limite);
      if (resumo === undefined || resumo.length > limite) {
        anotar(log, `${refRodada}: o pi não resumiu o contexto do PR em ${String(limite)} caracteres; vai sem ele`);
      }
      return resumo;
    },
  );
  const commitsRegistrados = new Set(
    doRodada
      .filter((t) => t.etapa === "implementar")
      .map((t) => repositorio.commitDoTicket(demanda.id, t.ticket_id)?.sha),
  );
  const recusarCommitOrfao = (orfao: string) =>
    new ErroDeRegra(
      `a branch ${branchRodada} tem o commit ${orfao.slice(0, 12)}, que nenhum ticket de desenvolvimento da ${refRodada} registrou: ` +
        "um agente commitou fora do desenvolvimento, e esse commit não sobe no PR",
      `desfaça com git -C ${espaco.pasta} reset --hard HEAD~1, repetindo até a HEAD ` +
        "ser um commit de ticket da Fabriquinha, e reabra o ticket",
    );
  // Os PRs que os `encerrar_rodada` anteriores da rodada já registraram; a marca cobre o que a queda deixou sem registro.
  const anteriores = new Set<number | undefined>(
    doRodada.filter((t) => t.etapa === "encerrar_rodada" && t.ticket_id < ticket.ticket_id).map((t) => t.ticket_id),
  );
  const conhecidos = ag.evidencias
    .filter((e) => e.tipo === "pr_aberto" && anteriores.has(e.ticket_id))
    .map((e) => (e.dados as { id: string }).id);
  const publicado = await repositorio.publicarPR(
    projeto,
    espaco,
    {
      titulo: pr.titulo,
      corpo: pr.publicado,
      conhecidos,
      marca: marcaDoPRRodada(demanda.id, ticket.ticket_id),
      commitsRegistrados,
      recusarCommitOrfao,
    },
    log,
  );
  submeterEvidenciaDoEncerramento(banco, ticket, "pr_aberto", {
    ...publicado,
    hospedagem: projeto.hospedagem,
    base: demanda.branch,
    corpoCompleto: pr.completo,
    condensado: pr.completo !== pr.publicado,
  });
  // O PR do Espaço da rodada acompanha a evidência; a queda entre os dois é refeita na repetição do ticket, que adota o PR.
  registrarPRDaRodada(banco, demanda.id, ref.rodada_id, {
    numero: Number(publicado.id),
    url: publicado.url,
    head: publicado.head,
    estado: "aberto",
    atualizado_em: relogio.agora(),
  });
  anotar(log, `${refRodada}: PR ${publicado.id} publicado, ${publicado.url}`);

  const { conferencia_do_pr: conferenciaDoPR } = montarVerificacoesDaEtapa("encerrar_rodada", {
    conferencia_do_pr: () => new ConferenciaDoPR(repositorio, projeto, publicado.id, log),
  });
  const problemas = await conferenciaDoPR.conferir();
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
  return conferir(banco, relogio, ref, ticket, {
    documentacao_entregue: true,
    conflito: problemas.conflito,
    check_falho: problemas.checksFalhos.length > 0,
    ...(correcoes.length > 0 && { correcoes }),
  });
}
