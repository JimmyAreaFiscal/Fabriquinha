// Aprovação do PR da rodada pelo Auditor (comparacao-sdlc-implementacao.md §§4 e 6): validar, integrar na hospedagem,
// avançar a demanda local, confirmar e registrar. A hospedagem é a fonte da verdade, então repetir a decisão é seguro.
import type { DatabaseSync } from "node:sqlite";
import { type Ator, exigirAtor, FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { formatarRodadaRef } from "../nucleo/demanda.ts";
import { ErroDeRegra, existe } from "../nucleo/erros.ts";
import { confirmarAprovacaoPullRequest, validarAprovacaoPullRequest } from "../nucleo/transicoes_rodada.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { configuracaoProjeto } from "../armazenamento/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { integrarPR } from "../infra/repositorio/pr.ts";
import { caminhoDaWorktreeDemanda } from "../infra/repositorio/worktree-demanda.ts";
import { exigirGit, naFilaDoProjeto } from "../infra/repositorio/worktree.ts";
import { noLog } from "../infra/registro.ts";
import type { RefRodada } from "./encerramento_rodada.ts";

/**
 * Aprova o PR da rodada com `nota` (o Auditor) ou sem ela (a Fabriquinha, na aprovação automática). Falha antes da
 * confirmação não grava nada: o gate segue aberto para nova tentativa.
 */
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
  const entrada = { ...ref, ticket_id: ticket.ticket_id, ...(nota !== undefined && { nota }) };

  if (rodada.estado === "concluida") {
    exigirAtor(ator, "aprovar o PR da rodada", "auditor");
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

/**
 * Os projetos que aprovam sozinhos o PR da rodada: `$FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA`, nomes separados por
 * vírgula (vem do `ambiente` do serviço). Ausente, nenhum: o Auditor decide todo gate, como sempre.
 */
const aprovaPRDaRodadaSozinho = (projeto: string, env: NodeJS.ProcessEnv): boolean =>
  (env.FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA ?? "")
    .split(",")
    .map((nome) => nome.trim())
    .includes(projeto);

/**
 * Logo depois do encerramento: no projeto que a ligou, a Fabriquinha aprova o PR da rodada que chegou ao gate, porque
 * chegar a ele já exige a revisão aprovada e o PR sem conflito nem check falho. O Auditor fica com o PR final da demanda.
 * A falha só vai ao log e deixa o gate aberto para o Auditor; fora do gate ou sem a opção, nada acontece. Devolve a
 * demanda aprovada, ou `ag` como veio.
 */
export async function aprovarPRRodadaSeAutomatico(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  ref: RefRodada,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgregadoDemanda> {
  const noGate = ag.rodadas.some((r) => r.rodada_id === ref.rodada_id && r.estado === "gate_pr");
  if (!noGate || !aprovaPRDaRodadaSozinho(ag.demanda.projeto, env)) return ag;
  return aprovarPRRodada(banco, ref, undefined, FABRIQUINHA).catch((erro: unknown) => {
    noLog(erro);
    return ag;
  });
}
