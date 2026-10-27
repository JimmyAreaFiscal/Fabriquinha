// Serviço Encerramento da demanda (comparacao-sdlc-implementacao.md §§5 e 6): conduz o `encerrar_demanda` até a demanda
// `concluida`, sem agente, gate nem nota. PR final da branch da demanda para a base do projeto (D02), conflito (D06),
// check final, integração confirmada com SHA, limpeza por posse e evidências. Cada efeito externo é seguido da
// transição do domínio, que decide se ele se repete (progresso recuperável).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import type { AgregadoDemanda, EvidenciaDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import { validarEvidenciaDaEtapa } from "../dominio/evidencia_etapa.ts";
import { motivo } from "../dominio/primitivos.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { registrarFalhaTicket } from "../dominio/transicoes_demanda.ts";
import {
  concluirEncerramento,
  registrarConflitoEncerramento,
  registrarFalhaEncerramento,
  registrarIntegracao,
  registrarTentativaEncerramento,
  solicitarIntegracao,
} from "../dominio/transicoes_encerramento.ts";
import {
  corpoDoPRFinal,
  marcaDoPRFinal,
  type DemonstracaoLimpeza,
  montarArvorePRs,
  montarDemonstracaoLimpeza,
  tituloDoPRFinal,
} from "../evidencias/encerramento_demanda.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { raizDo } from "../persistencia/banco.ts";
import { commitDoTicketDemanda } from "../persistencia/commits_demanda.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { carregarSessoesDaDemanda } from "../persistencia/sessoes.ts";
import { limparDemanda, pendenciasDeLimpeza, sobrasDaDemanda } from "../repositorio/limpeza_demanda.ts";
import { integrarPR, type OpcoesVerificacao, publicarPRDe, verificarPR } from "../repositorio/pr.ts";
import { exigirGit } from "../repositorio/worktree.ts";

export interface DepsEncerramentoDemanda {
  /** Espera da verificação do PR (limite, intervalo e carência); o padrão é o de produção. */
  verificacao?: OpcoesVerificacao;
}

const contexto = () => ({ agora: new Date().toISOString() });

/**
 * Conduz o `encerrar_demanda` que o agendador reservou (`em_execucao`), de uma demanda em `encerramento`; fora disso
 * recusa sem efeito externo. Sai com o agregado no fim do que deu para fazer:
 * - com a integração gravada, só a limpeza pendente;
 * - senão publica (ou reaproveita) o PR final e registra a tentativa; erro até aqui falha o ticket e sobe;
 * - conflito com a base cria o `resolver_conflito` e devolve o ticket a `aberto`; check falho ou erro da hospedagem
 *   na verificação falha o ticket em `check_final`;
 * - integra, grava o SHA, limpa; sobras falham em `limpeza` e só elas se repetem; sem sobras, grava as evidências
 *   e conclui a demanda.
 */
export async function conduzirEncerramentoDemanda(
  banco: DatabaseSync,
  demanda_id: string,
  deps: DepsEncerramentoDemanda = {},
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, demanda_id);
  const ticket = ag.tickets.findLast((t) => t.etapa === "encerrar_demanda");
  if (ag.demanda.fase !== "encerramento" || ticket?.status !== "em_execucao") {
    throw new ErroDeRegra(
      `a demanda ${demanda_id} está em ${ag.demanda.fase} e o encerrar_demanda está ${ticket?.status ?? "ausente"}`,
      "só se encerra a demanda em encerramento, com o encerrar_demanda reservado pelo agendador",
    );
  }
  const projeto = existe(
    configuracaoProjeto(banco, ag.demanda.projeto),
    `o projeto ${ag.demanda.projeto} não tem configuração do SDLC`,
    "configure o projeto",
  );
  const raiz = raizDo(banco);
  mkdirSync(join(raiz, "execucoes"), { recursive: true });
  const log = join(raiz, "execucoes", `encerramento-${demanda_id}.log`);
  const hospedagem = { nome: projeto.nome, repo: projeto.raiz_git, hospedagem: projeto.hospedagem };
  const aplicar = (transicao: (a: AgregadoDemanda) => AgregadoDemanda) => comDemanda(banco, demanda_id, transicao);
  const falhar = (etapa: "check_final" | "integracao" | "limpeza", porque: string, limpeza_pendente: string[] = []) =>
    aplicar((a) =>
      registrarFalhaEncerramento(
        a,
        { demanda_id, etapa, motivo: motivo(porque), limpeza_pendente },
        FABRIQUINHA,
        contexto(),
      ),
    );
  const limpar = async () => {
    const pendentes = existe(
      carregarDemanda(banco, demanda_id).encerramento,
      `a demanda ${demanda_id} não tem progresso de encerramento`,
      "registre a tentativa antes",
    ).limpeza_pendente;
    const feito = await limparDemanda(raiz, hospedagem, pendentes);
    const sobras = [...feito.pendentes, ...(await sobrasDaDemanda(hospedagem, feito.removidos))];
    // A passada anterior (falha parcial) já gravou o que removeu; a demonstração final soma as duas.
    const anterior = carregarDemanda(banco, demanda_id).evidencias.findLast(
      (e) => e.ticket_id === ticket.ticket_id && e.tipo === "demonstracao_limpeza",
    );
    const antes = ((anterior?.dados as DemonstracaoLimpeza | undefined)?.removidas ?? []).map(
      (r) => `${r.tipo}:${r.alvo}`,
    );
    const demonstracao = montarDemonstracaoLimpeza([...new Set([...antes, ...feito.removidos])], sobras);
    if (sobras.length > 0) {
      gravarEvidencias(banco, demanda_id, ticket.ticket_id, demonstracao, false);
      return falhar("limpeza", `a limpeza deixou: ${sobras.join(", ")}`, sobras);
    }
    gravarEvidencias(banco, demanda_id, ticket.ticket_id, demonstracao);
    return aplicar((a) => concluirEncerramento(a, { demanda_id, limpeza_pendente: [] }, FABRIQUINHA, contexto()));
  };

  if (ag.encerramento?.integracao !== undefined) return limpar();

  let publicado: Awaited<ReturnType<typeof publicarFinal>>;
  try {
    publicado = await publicarFinal(banco, ag, hospedagem, projeto.branch_base, raiz, log);
    aplicar((a) =>
      registrarTentativaEncerramento(
        a,
        {
          demanda_id,
          base: projeto.branch_base,
          pr: { numero: Number(publicado.id), url: publicado.url },
          sha: publicado.head,
        },
        FABRIQUINHA,
      ),
    );
  } catch (erro) {
    aplicar((a) =>
      registrarFalhaTicket(a, { ticket_id: ticket.ticket_id, motivo: motivo(mensagem(erro)) }, contexto()),
    );
    throw erro;
  }

  try {
    const problemas = await verificarPR(hospedagem, publicado.id, log, deps.verificacao);
    if (problemas.conflito) {
      return aplicar((a) => registrarConflitoEncerramento(a, { demanda_id }, FABRIQUINHA, contexto()));
    }
    if (problemas.checksFalhos.length > 0) {
      const falhos = problemas.checksFalhos.map((c) => [c.nome, c.url].filter(Boolean).join(" "));
      return falhar("check_final", `check final falho no PR ${publicado.url}: ${falhos.join(", ")}`);
    }
  } catch (erro) {
    return falhar("check_final", mensagem(erro));
  }

  aplicar((a) => solicitarIntegracao(a, { demanda_id }, FABRIQUINHA));
  let sha;
  try {
    sha = await integrarPR(hospedagem, publicado.id);
  } catch (erro) {
    return falhar("integracao", mensagem(erro));
  }
  const pendentes = await pendenciasDeLimpeza(raiz, hospedagem, ag);
  aplicar((a) =>
    registrarIntegracao(a, { demanda_id, confirmada: true, sha, limpeza_pendente: pendentes }, FABRIQUINHA),
  );
  return limpar();
}

/** Publica o PR da branch da demanda para a base, reaproveitando o do progresso ou o marcado; só commits de ticket sobem. */
function publicarFinal(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  projeto: Pick<Projeto, "nome" | "repo" | "hospedagem">,
  base: string,
  raiz: string,
  log: string,
) {
  const { demanda } = ag;
  const registrados = new Set(ag.tickets.map((t) => commitDoTicketDemanda(banco, demanda.id, t.ticket_id)?.sha));
  const conferirCommits = async (head: string) => {
    // Os commits da base já estão no remoto; a ponta dele vem fresca para a comparação.
    await exigirGit(projeto.repo, "fetch", "origin", base);
    const novos = await exigirGit(projeto.repo, "rev-list", "--no-merges", `refs/remotes/origin/${base}..${head}`);
    const orfao = novos.split("\n").find((sha) => sha !== "" && !registrados.has(sha));
    if (orfao === undefined) return;
    throw new ErroDeRegra(
      `a branch ${demanda.branch} tem o commit ${orfao.slice(0, 12)}, que nenhum ticket da ${demanda.id} registrou: ` +
        "um agente commitou fora do desenvolvimento, e esse commit não sobe no PR",
      `desfaça-o na worktree da demanda e reabra o ticket`,
    );
  };
  return publicarPRDe(
    raiz,
    projeto,
    { branch: demanda.branch, base, publicarBase: false },
    {
      titulo: tituloDoPRFinal(ag),
      corpo: corpoDoPRFinal(ag),
      conhecidos: ag.encerramento?.pr ? [String(ag.encerramento.pr.numero)] : [],
      marca: marcaDoPRFinal(demanda.id),
    },
    conferirCommits,
    () => varrerBase(banco, projeto.nome),
    log,
  );
}

/** Grava a árvore de PRs e a demonstração de limpeza no ticket, no lugar das anteriores do mesmo tipo. */
function gravarEvidencias(
  banco: DatabaseSync,
  demanda_id: string,
  ticket_id: number,
  limpeza: DemonstracaoLimpeza,
  completa = true,
): void {
  const ag = carregarDemanda(banco, demanda_id);
  const { sessoes, execucoes, usos } = carregarSessoesDaDemanda(banco, demanda_id);
  const dados = {
    ...(completa && { arvore_prs_criterios_custos: montarArvorePRs(ag, sessoes, execucoes, usos) }),
    demonstracao_limpeza: limpeza,
  };
  const evidencias = (Object.keys(dados) as (keyof typeof dados)[]).map((tipo) => {
    const e = validarEvidenciaDaEtapa(
      { demanda_id, ticket_id, etapa: "encerrar_demanda" },
      { demanda_id, ticket_id, tipo, produtor: "fabriquinha", aprovada: limpeza.aprovada, dados: dados[tipo] },
    );
    return {
      demanda_id,
      rodada_id: undefined,
      ticket_id,
      tipo,
      dados: e.dados as EvidenciaDemanda["dados"],
      em: new Date().toISOString(),
    };
  });
  comDemanda(banco, demanda_id, (a) => ({
    ...a,
    evidencias: [...a.evidencias.filter((x) => x.ticket_id !== ticket_id || !(x.tipo in dados)), ...evidencias],
  }));
}
