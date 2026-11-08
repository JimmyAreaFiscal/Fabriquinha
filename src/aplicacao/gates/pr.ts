// Efeitos do gate do PR da rodada fora do agregado (comparacao-sdlc-implementacao.md §§4 e 6): integrar o PR na
// hospedagem, avançar a demanda local e abrir a sessão de ajustes do PR reprovado. A hospedagem é a fonte da verdade,
// então repetir a aprovação é seguro.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../nucleo/agregado_demanda.ts";
import { type Ator, exigirAtor } from "../../nucleo/ator.ts";
import { formatarRodadaRef } from "../../nucleo/demanda.ts";
import { ErroDeRegra, existe } from "../../nucleo/erros.ts";
import { espacoDoTicket } from "../../nucleo/espaco_de_trabalho.ts";
import { type EntradaDoGate, GATES } from "../../nucleo/gate.ts";
import { type Endereco, ticketAtualDaEtapa } from "../../nucleo/item_de_trabalho.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { carregarProjeto } from "../../armazenamento/projetos.ts";
import { configuracao } from "../../armazenamento/servico.ts";
import { integrarPR } from "../../infra/repositorio/pr.ts";
import { exigirGit, naFilaDoProjeto } from "../../infra/repositorio/worktree.ts";
import { abrirSessaoDeAjustes, guardarMarcoDaSessao } from "../sessao_ajustes.ts";

const gate = GATES.gate_pr;
const contexto = () => ({ agora: new Date().toISOString() });

const referenciaDaRodada = (endereco: Endereco) => ({
  demanda_id: endereco.demanda_id,
  rodada_id: existe(
    endereco.rodada_id,
    `o endereço ${endereco.toString()} não é de uma rodada`,
    "use o endereço da rodada, como I-206.R2",
  ),
});

/**
 * Aprova o PR da rodada com a nota (o Auditor) ou sem ela (a Fabriquinha, na aprovação automática). Falha antes da
 * confirmação não grava nada: o gate segue aberto para nova tentativa.
 */
export async function aprovarPR(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
): Promise<AgregadoDemanda> {
  const ref = referenciaDaRodada(endereco);
  const ag = carregarDemanda(banco, ref.demanda_id);
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não existe`,
    "use uma rodada da demanda",
  );
  const ticket = existe(
    ticketAtualDaEtapa(ag, "encerrar_rodada", ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem ticket encerrar_rodada`,
    "confira o estado da rodada",
  );

  if (rodada.estado === "concluida") {
    exigirAtor(ator, "aprovar o PR da rodada", "auditor");
    const decisao = ag.decisoes.find((d) => d.ticket_id === ticket.ticket_id && d.resultado === "aprovado");
    if (decisao?.nota === entrada.nota) return ag;
    throw new ErroDeRegra(
      `a rodada ${formatarRodadaRef(ref)} já foi concluída com ${decisao ? `a nota ${String(decisao.nota)}` : "outra decisão"}`,
      "a decisão do gate não muda depois de registrada",
    );
  }

  gate.ensaiar(ag, endereco, entrada, ator, contexto()); // recusa antes de integrar na hospedagem
  const pr = existe(
    ag.evidencias.findLast((e) => e.ticket_id === ticket.ticket_id && e.tipo === "pr_aberto"),
    `a rodada ${formatarRodadaRef(ref)} não tem PR publicado`,
    "o encerramento publica o PR",
  );
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const { branch } = ag.demanda;
  await integrarPR(projeto, pr.dados.id as string);
  // A ref local da demanda só avança em fast-forward: o merge da hospedagem é o único commit novo dela.
  const { pasta: demanda } = espacoDoTicket(ag, {}, projeto, raiz);
  await naFilaDoProjeto(raiz, projeto.nome, async () => {
    await exigirGit(demanda, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    await exigirGit(demanda, "merge", "--ff-only", `refs/remotes/origin/${branch}`);
  });

  return comDemanda(banco, ref.demanda_id, (a) => gate.decidir(a, endereco, entrada, ator, contexto()));
}

/**
 * Reprova o PR da rodada e abre a sessão de ajustes na hora (interativa, sem esperar o agendador). A recusa do domínio
 * (motivo vazio, ator, estado) lança antes de gravar o marco ou mudar o banco.
 */
export async function reprovarPR(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  motivo: string,
): Promise<{ demanda: AgregadoDemanda; sessao: string }> {
  const ref = referenciaDaRodada(endereco);
  const ag = carregarDemanda(banco, ref.demanda_id);
  gate.ensaiar(ag, endereco, entrada, ator, contexto());
  await guardarMarcoDaSessao(banco, ref, ag);
  const demanda = comDemanda(banco, ref.demanda_id, (a) => gate.decidir(a, endereco, entrada, ator, contexto()));
  const { id } = abrirSessaoDeAjustes(banco, ref, demanda, motivo, { limiteMin: configuracao(banco).timeoutMin });
  return { demanda, sessao: id };
}
