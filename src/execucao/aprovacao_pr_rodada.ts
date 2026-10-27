// Aprovação do PR da rodada pelo Auditor (comparacao-sdlc-implementacao.md §§4 e 6): validar, integrar na hospedagem,
// avançar a demanda local, confirmar e registrar. A hospedagem é a fonte da verdade, então repetir a decisão é seguro.
import type { DatabaseSync } from "node:sqlite";
import { type Ator, exigirAuditor } from "../dominio/agregado.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { formatarRodadaRef } from "../dominio/demanda.ts";
import { ErroDeRegra, existe } from "../dominio/erros.ts";
import { confirmarAprovacaoPullRequest, validarAprovacaoPullRequest } from "../dominio/transicoes_rodada.ts";
import { raizDo } from "../persistencia/banco.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { integrarPR } from "../repositorio/pr.ts";
import { caminhoDaWorktreeDemanda } from "../repositorio/worktree-demanda.ts";
import { exigirGit, naFilaDoProjeto } from "../repositorio/worktree.ts";
import type { RefRodada } from "./encerramento_rodada.ts";

/** Aprova o PR da rodada com `nota`. Falha antes da confirmação não grava nada: o gate segue aberto para nova tentativa. */
export async function aprovarPRRodada(
  banco: DatabaseSync,
  ref: RefRodada,
  nota: number | undefined,
  ator: Ator,
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não existe`,
    "use uma rodada da demanda",
  );
  const ticket = existe(
    ag.tickets
      .filter((t) => t.rodada_id === ref.rodada_id && t.etapa === "encerrar_rodada")
      .sort((a, b) => b.ticket_id - a.ticket_id)[0],
    `a rodada ${formatarRodadaRef(ref)} não tem ticket encerrar_rodada`,
    "confira o estado da rodada",
  );
  const entrada = { ...ref, ticket_id: ticket.ticket_id, nota };

  if (rodada.fase === "concluida") {
    exigirAuditor(ator, "aprovar o PR da rodada");
    const decisao = ag.decisoes.find((d) => d.ticket_id === ticket.ticket_id && d.resultado === "aprovado");
    if (decisao?.nota === nota) return ag;
    throw new ErroDeRegra(
      `a rodada ${formatarRodadaRef(ref)} já foi concluída com ${decisao ? `a nota ${String(decisao.nota)}` : "outra decisão"}`,
      "a decisão do gate não muda depois de registrada",
    );
  }

  validarAprovacaoPullRequest(ag, entrada, ator);
  const pr = existe(
    ag.evidencias.findLast((e) => e.ticket_id === ticket.ticket_id && e.tipo === "pr_aberto"),
    `a rodada ${formatarRodadaRef(ref)} não tem PR publicado`,
    "o encerramento publica o PR",
  );
  const projeto = existe(
    configuracaoProjeto(banco, ag.demanda.projeto),
    `o projeto ${ag.demanda.projeto} não tem configuração do SDLC`,
    "configure o projeto",
  );
  const raiz = raizDo(banco);
  const { branch } = ag.demanda;
  await integrarPR({ repo: projeto.raiz_git, hospedagem: projeto.hospedagem }, pr.dados.id as string);
  // A ref local da demanda só avança em fast-forward: o merge da hospedagem é o único commit novo dela.
  const demanda = caminhoDaWorktreeDemanda(raiz, projeto.nome, ag.demanda.id);
  await naFilaDoProjeto(raiz, projeto.nome, async () => {
    await exigirGit(demanda, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    await exigirGit(demanda, "merge", "--ff-only", `refs/remotes/origin/${branch}`);
  });

  return comDemanda(banco, ref.demanda_id, (a) =>
    confirmarAprovacaoPullRequest(a, entrada, ator, {
      agora: new Date().toISOString(),
      integracao: { ...ref, ticket_id: ticket.ticket_id, confirmada: true, branch_destino: branch },
    }),
  );
}
