// Serviço Encerramento da demanda (comparacao-sdlc-implementacao.md §§5 e 6): conduz o `encerrar_demanda` até a demanda
// `concluida`, sem agente, gate nem nota. PR final da branch da demanda para a base do projeto (D02), conflito (D06),
// check final, espera do merge humano na plataforma (a integração final depende do humano), integração confirmada com
// SHA, limpeza por posse e evidências. Cada efeito externo é seguido da
// transição do domínio, que decide se ele se repete (progresso recuperável).
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import { type AgregadoDemanda, prDaDemanda } from "../nucleo/agregado_demanda.ts";
import { ErroDeRegra, existe } from "../nucleo/erros.ts";
import { Endereco, ticketAtualDaEtapa } from "../nucleo/item_de_trabalho.ts";
import type { Projeto } from "../nucleo/projeto.ts";
import { type FalhaDaTentativa, falhaDoErro, falhaQueExigeOAuditor } from "../nucleo/tentativa.ts";
import { registrarFalhaTicket } from "../nucleo/transicoes_demanda.ts";
import {
  concluirEncerramento,
  registrarConflitoEncerramento,
  registrarFalhaEncerramento,
  registrarIntegracao,
  registrarTentativaEncerramento,
  solicitarIntegracao,
} from "../nucleo/transicoes_encerramento.ts";
import {
  corpoDoPRFinal,
  marcaDoPRFinal,
  montarArvorePRs,
  montarDemonstracaoLimpeza,
  tituloDoPRFinal,
} from "./evidencias/encerramento_demanda.ts";
import { submeterEvidencia } from "./evidencia/submeter.ts";
import { varrerBase } from "./retrabalho.ts";
import { cicloDoEspaco } from "./espaco/ciclo_do_espaco.ts";
import { espacoDaDemanda } from "../nucleo/espaco_de_trabalho.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { commitDoTicketDemanda } from "../armazenamento/commits_demanda.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { carregarTrabalhosDaDemanda } from "../armazenamento/trabalho_agentico.ts";
import { lerUsoDeclarado } from "../armazenamento/uso_declarado.ts";
import { logDaOperacao } from "../infra/registro.ts";
import { limparDemanda, pendenciasDeLimpeza, sobrasDaDemanda } from "../infra/repositorio/limpeza_demanda.ts";
import { lerPR, type OpcoesVerificacao, publicarPRDe } from "../infra/repositorio/pr.ts";
import { ConferenciaDoPR } from "../infra/verificacao/conferencia_do_pr.ts";
import { exigidaPelaEtapa } from "../infra/verificacao/verificacao.ts";
import { exigirGit } from "../infra/repositorio/worktree.ts";

export interface DepsEncerramentoDemanda {
  /** Espera da verificação do PR (limite, intervalo e carência); o padrão é o de produção. */
  verificacao?: OpcoesVerificacao;
}

/** As evidências do encerramento não têm anexo: nenhuma origem é lida. */
const SEM_ORIGEM_DE_ANEXO = { worktree: "", saida: "", fora: "", copie: "" };

const contexto = () => ({ agora: new Date().toISOString() });

/**
 * Conduz o `encerrar_demanda` que o agendador reservou (`em_execucao`), de uma demanda em `encerrar_demanda`; fora disso
 * recusa sem efeito externo. Sai com o agregado no fim do que deu para fazer:
 * - com a integração gravada, só a limpeza pendente;
 * - senão publica (ou reaproveita) o PR final e registra a tentativa; erro até aqui falha o ticket e sobe;
 * - conflito com a base cria o `resolver_conflito` e devolve o ticket a `aberto`; check falho ou erro da hospedagem
 *   na verificação falha o ticket em `check_final`;
 * - verificado, espera o humano aprovar e integrar o PR na plataforma: o ticket volta a `aberto` e cada ciclo do
 *   agendador relê o PR, sem publicar nem verificar de novo; PR fechado sem merge falha o ticket em `integracao`;
 * - mergeado pelo humano, grava o SHA, limpa; sobras falham em `limpeza` e só elas se repetem; sem sobras, grava as
 *   evidências e conclui a demanda.
 */
export async function conduzirEncerramentoDemanda(
  banco: DatabaseSync,
  demanda_id: string,
  deps: DepsEncerramentoDemanda = {},
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, demanda_id);
  const ticket = ticketAtualDaEtapa(ag, "encerrar_demanda");
  if (ag.demanda.estado !== "encerrar_demanda" || ticket?.estado !== "em_execucao") {
    throw new ErroDeRegra(
      `a demanda ${demanda_id} está em ${ag.demanda.estado} e o encerrar_demanda está ${ticket?.estado ?? "ausente"}`,
      "só se encerra a demanda em encerramento, com o encerrar_demanda reservado pelo agendador",
    );
  }
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `encerramento-${demanda_id}`);
  const aplicar = (transicao: (a: AgregadoDemanda) => AgregadoDemanda) => comDemanda(banco, demanda_id, transicao);
  const falhar = (
    etapa: "check_final" | "integracao" | "limpeza",
    falha: FalhaDaTentativa,
    limpeza_pendente: string[] = [],
  ) =>
    aplicar((a) =>
      registrarFalhaEncerramento(
        a,
        {
          demanda_id,
          etapa,
          motivo: falha.motivo,
          ...(falha.tipo === "falha_infraestrutura" && { causa: falha.causa }),
          limpeza_pendente,
        },
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
    const feito = await limparDemanda(raiz, projeto, pendentes);
    const sobras = [...feito.pendentes, ...(await sobrasDaDemanda(projeto, feito.removidos))];
    const demonstracao = montarDemonstracaoLimpeza(feito.removidos, sobras);
    const { sessoes, execucoes, usos } = carregarTrabalhosDaDemanda(banco, demanda_id);
    // Com sobras só a demonstração é submetida: o Avaliador a recusa e nada é gravado.
    const submissoes = [
      ...(sobras.length === 0
        ? [
            {
              tipo: "arvore_prs_criterios_custos" as const,
              dados: montarArvorePRs(
                carregarDemanda(banco, demanda_id),
                sessoes,
                execucoes,
                usos,
                lerUsoDeclarado(banco, demanda_id),
              ),
            },
          ]
        : []),
      { tipo: "demonstracao_limpeza" as const, dados: demonstracao },
    ];
    for (const { tipo, dados } of submissoes) {
      const avaliacao = submeterEvidencia(
        banco,
        { tipo, dono: Endereco.doTicket(demanda_id, ticket.ticket_id), produtor: FABRIQUINHA, dados, anexos: [] },
        { origens: SEM_ORIGEM_DE_ANEXO },
      );
      if (avaliacao.resultado === "recusada") {
        if (sobras.length > 0) {
          return falhar(
            "limpeza",
            falhaQueExigeOAuditor(`${avaliacao.motivo}: a limpeza deixou ${sobras.join(", ")}`),
            sobras,
          );
        }
        // A falha de limpeza exige pendências; a evidência inválida falha só o ticket, e reaberto ele submete de novo.
        return aplicar((a) =>
          registrarFalhaTicket(
            a,
            { ticket_id: ticket.ticket_id, falha: falhaQueExigeOAuditor(avaliacao.motivo) },
            contexto(),
          ),
        );
      }
    }
    return aplicar((a) => concluirEncerramento(a, { demanda_id, limpeza_pendente: [] }, FABRIQUINHA, contexto()));
  };

  // A Fabriquinha não integra o PR final: a plataforma pode exigir a aprovação do humano (Azure Repos) e o merge é dele.
  const aguardarMergeHumano = async () => {
    const pr = existe(
      prDaDemanda(carregarDemanda(banco, demanda_id)),
      `a demanda ${demanda_id} não tem PR final`,
      "registre a tentativa antes",
    );
    const devolverParaEspera = () => aplicar((a) => solicitarIntegracao(a, { demanda_id }, FABRIQUINHA, contexto()));
    let leitura;
    try {
      leitura = await lerPR(projeto, String(pr.numero));
    } catch (erro) {
      devolverParaEspera(); // a leitura que falha não é decisão do humano: o próximo ciclo relê
      throw erro;
    }
    if (leitura.estado === "fechado") {
      return falhar(
        "integracao",
        falhaQueExigeOAuditor(`o PR final ${pr.url} foi fechado sem merge: reabra-o e integre-o na plataforma`),
      );
    }
    if (leitura.estado !== "mergeado") return devolverParaEspera();
    const sha = existe(
      leitura.mergeSha,
      `a hospedagem não informou o merge do PR ${pr.url}`,
      "confira o PR na plataforma",
    );
    const pendentes = await pendenciasDeLimpeza(raiz, projeto, ag);
    aplicar((a) =>
      registrarIntegracao(
        a,
        { demanda_id, confirmada: true, sha, limpeza_pendente: pendentes },
        FABRIQUINHA,
        contexto(),
      ),
    );
    return limpar();
  };

  if (ag.encerramento?.integracao !== undefined) return limpar();
  if (ag.encerramento?.aguardando_merge_humano) return aguardarMergeHumano();

  let publicado: Awaited<ReturnType<typeof publicarFinal>>;
  try {
    const ciclo = cicloDoEspaco(espacoDaDemanda(projeto, demanda_id, raiz), projeto, { raiz, log });
    await varrerBase(banco, projeto.nome).catch(ciclo.anotarFalhaDaVarredura);
    publicado = await publicarFinal(banco, ag, projeto, projeto.branch_base, raiz);
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
        contexto(),
      ),
    );
  } catch (erro) {
    aplicar((a) => registrarFalhaTicket(a, { ticket_id: ticket.ticket_id, falha: falhaDoErro(erro) }, contexto()));
    throw erro;
  }

  try {
    const problemas = await exigidaPelaEtapa(
      "encerrar_demanda",
      new ConferenciaDoPR(projeto, publicado.id, log, deps.verificacao),
    ).conferir();
    if (problemas.conflito) {
      return aplicar((a) => registrarConflitoEncerramento(a, { demanda_id }, FABRIQUINHA, contexto()));
    }
    if (problemas.checksFalhos.length > 0) {
      const falhos = problemas.checksFalhos.map((c) => [c.nome, c.url].filter(Boolean).join(" "));
      return falhar(
        "check_final",
        falhaQueExigeOAuditor(`check final falho no PR ${publicado.url}: ${falhos.join(", ")}`),
      );
    }
  } catch (erro) {
    return falhar("check_final", falhaDoErro(erro));
  }

  aplicar((a) => solicitarIntegracao(a, { demanda_id }, FABRIQUINHA, contexto()));
  return aguardarMergeHumano();
}

/** Publica o PR da branch da demanda para a base, reaproveitando o do progresso ou o marcado; só commits de ticket sobem. */
function publicarFinal(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  projeto: Pick<Projeto, "nome" | "raiz_git" | "hospedagem">,
  base: string,
  raiz: string,
) {
  const { demanda } = ag;
  const prFinal = prDaDemanda(ag);
  const registrados = new Set(ag.tickets.map((t) => commitDoTicketDemanda(banco, demanda.id, t.ticket_id)?.sha));
  const conferirCommits = async (head: string) => {
    // Os commits da base já estão no remoto; a ponta dele vem fresca para a comparação.
    await exigirGit(projeto.raiz_git, "fetch", "origin", base);
    const novos = await exigirGit(projeto.raiz_git, "rev-list", "--no-merges", `refs/remotes/origin/${base}..${head}`);
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
      conhecidos: prFinal ? [String(prFinal.numero)] : [],
      marca: marcaDoPRFinal(demanda.id),
    },
    conferirCommits,
  );
}
