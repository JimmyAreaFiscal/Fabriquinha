// O Repositório do projeto (MELHORIAS §10): a única interface do módulo. Confere o remoto, prepara, atualiza e limpa os
// Espaços de Trabalho, commita os tickets, publica, lê e integra os PRs e informa o histórico da base. A fila git por
// projeto, o git do Ambiente e a varredura dos commits humanos ficam aqui dentro; a varredura diária a montagem liga, e
// `parar` desliga.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, mensagem } from "../../../../shared/nucleo/erros.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { LIMITE_COMANDO_MS } from "../../../../shared/nucleo/primitivos.ts";
import {
  acharCommitComMarca,
  apagarCommitsDasDemandas,
  apagarVarreduraDoProjeto,
  type ArquivoCommit,
  arquivosDe,
  type Commit,
  commitarTicket,
  commitDoTicketDemanda,
  cursorDaBase,
  type PedidoDeCommit,
  varrerBasesVencidas,
  varrerCommitsHumanos,
} from "../../commits/publico.ts";
import {
  ambienteDoEspaco,
  descartarAlteracoes,
  espacoDaDemanda,
  type EspacoDeTrabalho,
  pendenciasDeLimpeza,
  removerWorktrees,
  type ResultadoAtualizacao,
  sobrasDaDemanda,
} from "../../espaco_de_trabalho/publico.ts";
import { exigirGit, exigirGitNoAmbiente, type Hospedagem, type ProjetoDoRepositorio } from "../../git/publico.ts";
import { type Heatmap, heatmapDo } from "../../historico/publico.ts";
import {
  conferirProjeto,
  lerPR,
  type OpcoesVerificacao,
  type ProblemasDoPR,
  publicarPRDe,
  verificarPR,
} from "../../hospedagem/publico.ts";
import { cicloDoEspaco } from "./ciclo_do_espaco.ts";

/** O Projeto como o Espaço o lê: o repositório e, se houver, a imagem do Ambiente que o conjunto aloca ao Espaço. */
type ProjetoDoEspaco = ProjetoDoRepositorio & { imagem_do_ambiente?: string };

/** O que o PR leva: título e corpo já no limite da hospedagem, os PRs já registrados e a marca que adota o perdido. */
interface PedidoDePR {
  titulo: string;
  corpo: string;
  /** Os ids dos PRs que a Fabriquinha já registrou para o Espaço, em ordem. */
  conhecidos: readonly string[];
  marca: string;
  /** Os commits que tickets registraram: só eles sobem no PR. */
  commitsRegistrados: ReadonlySet<string | undefined>;
  /** A recusa do commit da branch que nenhum ticket registrou (um agente commitou fora do desenvolvimento). */
  recusarCommitOrfao(sha: string): ErroDeRegra;
}

/** O PR publicado: o id na hospedagem, a URL, a branch e o commit que subiu. */
interface PRPublicado {
  id: string;
  url: string;
  branch: string;
  head: string;
}

/** O que a limpeza do Espaço fez: o removido, o que falhou (para repetir) e o removido que ainda sobrou no disco ou no git. */
interface LimpezaDoEspaco {
  removidos: string[];
  pendentes: string[];
  sobras: string[];
}

/** O que o Espaço da rodada mudou desde o ancestral comum com a base dele (a branch da demanda). */
interface AlteracoesDoEspaco {
  base: string;
  head: string;
  arquivos: ArquivoCommit[];
}

export interface RepositorioDoProjeto {
  /** Confere o clone e o remoto do projeto a cadastrar e devolve a hospedagem dele; o que falha lança. */
  conferir(
    projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">,
  ): Promise<{ hospedagem: Hospedagem }>;
  /** Varre agora os commits humanos da base: no projeto recém-cadastrado, fixa o cursor inicial. */
  varrerBase(projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">): Promise<void>;
  /** O último commit da base que a varredura viu, se ela já rodou. */
  cursorDaBase(projeto: string): string | undefined;
  /**
   * Garante a worktree do Espaço no Ambiente que o conjunto aloca a ele e devolve a pasta; quando buscou a base, varre os
   * commits humanos (a falha só vai ao `log`).
   */
  prepararEspaco(projeto: ProjetoDoEspaco, espaco: EspacoDeTrabalho, log: string): Promise<string>;
  /** Incorpora no Espaço da rodada a ponta da demanda; o conflito volta no resultado. */
  atualizarComBase(projeto: ProjetoDoEspaco, espaco: EspacoDeTrabalho, log: string): Promise<ResultadoAtualizacao>;
  /** Roda o git na pasta do Espaço, no Ambiente dele, e devolve a saída; o que falha lança `ErroDeRegra`. */
  gitNoEspaco(espaco: EspacoDeTrabalho, ...argumentos: string[]): Promise<string>;
  /** Volta a branch do Espaço ao `sha` e descarta o que ficou na worktree, sem commitar. */
  voltarEspaco(espaco: EspacoDeTrabalho, sha: string, log: string): Promise<void>;
  /** O commit da worktree do Espaço cuja mensagem tem a `marca`, se houver. */
  commitComMarca(espaco: EspacoDeTrabalho, marca: string): Promise<Commit | undefined>;
  /** Commita o ticket no Espaço (idempotente pela marca), grava o commit e os commits posteriores e o devolve. */
  commitar(
    projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">,
    espaco: EspacoDeTrabalho,
    pedido: PedidoDeCommit,
    limiteMs?: number,
  ): Promise<Commit>;
  /** O commit que o ticket registrou, com os arquivos. */
  commitDoTicket(demandaId: string, ticketId: number): Commit | undefined;
  /** O que o Espaço da rodada mudou contra a branch da demanda, lido no clone. */
  alteracoesDoEspaco(
    projeto: Pick<ProjetoDoRepositorio, "raiz_git">,
    espaco: EspacoDeTrabalho,
  ): Promise<AlteracoesDoEspaco>;
  /**
   * Varre os commits humanos (a falha só vai ao `log`) e publica o PR do Espaço para a base dele; o da rodada empurra a
   * base também. Só os commits registrados sobem.
   */
  publicarPR(
    projeto: ProjetoDoRepositorio,
    espaco: EspacoDeTrabalho,
    pedido: PedidoDePR,
    log: string,
  ): Promise<PRPublicado>;
  /** O estado do PR `numero`, lido agora na hospedagem. */
  situacaoDoPR(
    projeto: Pick<ProjetoDoRepositorio, "raiz_git" | "hospedagem">,
    numero: string,
    relogio?: Relogio,
  ): ReturnType<typeof lerPR>;
  /** Espera a hospedagem decidir o conflito e os checks do PR `numero` e devolve os problemas. */
  problemasDoPR(
    projeto: Pick<ProjetoDoRepositorio, "raiz_git" | "hospedagem">,
    numero: string,
    log: string,
    opcoes?: OpcoesVerificacao,
  ): Promise<ProblemasDoPR>;
  /** Integra o PR da rodada na hospedagem e avança a branch local da demanda; o PR final, só o humano integra. */
  integrarPR(projeto: ProjetoDoEspaco, espaco: EspacoDeTrabalho, log: string): Promise<void>;
  /** O que a demanda ainda deixa no disco e no git: as worktrees e as branches dela e das rodadas. */
  pendenciasDeLimpeza(
    projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">,
    demanda: { demanda: { id: string }; rodadas: readonly { rodada_id: number }[] },
  ): Promise<string[]>;
  /** Remove as `pendentes` (ou o que o Espaço ainda deixa) e devolve o Ambiente ao conjunto quando nada fica. */
  limparEspaco(
    projeto: ProjetoDoEspaco,
    espaco: EspacoDeTrabalho,
    log: string,
    pendentes?: readonly string[],
  ): Promise<LimpezaDoEspaco>;
  /** As alterações da base publicada nos 12 meses até `agora`, por arquivo. */
  heatmap(projeto: Pick<ProjetoDoRepositorio, "raiz_git" | "branch_base">, agora: Instante): Promise<Heatmap>;
  /** Na remoção do projeto, na unidade de trabalho dela: os commits das `demandas` e o cursor da varredura do projeto. */
  esquecer(projeto: string, demandas: readonly string[]): void;
  /** Depois da remoção do projeto: apaga as worktrees dele; cada falha vira um aviso. */
  apagarEspacosDoProjeto(projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">): Promise<string[]>;
  /** Desliga a varredura diária e espera a que estiver em andamento. */
  parar(): Promise<void>;
}

/** A varredura diária dos commits humanos: os projetos cadastrados e se o agendador está ligado agora. */
interface VarreduraDiaria {
  projetos: () => readonly Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">[];
  ligada: () => boolean;
  relogio?: Relogio;
  registrarErro: (erro: unknown) => void;
}

interface MontagemDoRepositorio {
  banco: DatabaseSync;
  /** Só o serviço liga: a batida de minuto em minuto varre, com o agendador ligado, os projetos sem varredura há 24 horas. */
  varredura?: VarreduraDiaria;
}

/** A varredura que a montagem liga: uma batida por minuto, no máximo uma varredura por vez. */
function ligarVarreduraDiaria(banco: DatabaseSync, varredura: VarreduraDiaria): () => Promise<void> {
  const { projetos, ligada, relogio = relogioDoSistema, registrarErro } = varredura;
  let emAndamento: Promise<void> | undefined;
  const batida = setInterval(() => {
    if (emAndamento || !ligada()) return;
    emAndamento = varrerBasesVencidas(banco, projetos, relogio, registrarErro)
      .catch(registrarErro)
      .finally(() => {
        emAndamento = undefined;
      });
  }, 60_000);
  return async () => {
    clearInterval(batida);
    await emAndamento;
  };
}

/** Monta o Repositório sobre o `banco`; sem `varredura`, nada roda em segundo plano e montar não custa. */
export function montarRepositorio({ banco, varredura }: MontagemDoRepositorio): RepositorioDoProjeto {
  const raiz = raizDo(banco);
  const pararVarredura = varredura ? ligarVarreduraDiaria(banco, varredura) : () => Promise.resolve();
  const ciclo = (projeto: ProjetoDoEspaco, espaco: EspacoDeTrabalho, log: string) =>
    cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoEspaco(espaco));
  const varrerAnotandoAFalha = (projeto: ProjetoDoRepositorio, log: string) =>
    varrerCommitsHumanos(banco, projeto).catch((erro: unknown) => {
      anotar(log, `varrerCommitsHumanos falhou: ${mensagem(erro)}`);
    });

  return {
    conferir: (projeto) => conferirProjeto(projeto),
    varrerBase: (projeto) => varrerCommitsHumanos(banco, projeto),
    cursorDaBase: (projeto) => cursorDaBase(banco, projeto),
    async prepararEspaco(projeto, espaco, log) {
      const { pasta, buscouBase } = await ciclo(projeto, espaco, log).criar();
      if (buscouBase) await varrerAnotandoAFalha(projeto, log);
      return pasta;
    },
    atualizarComBase: (projeto, espaco, log) => ciclo(projeto, espaco, log).atualizarComBase(),
    gitNoEspaco: (espaco, ...argumentos) => exigirGitNoAmbiente(ambienteDoEspaco(espaco), espaco.pasta, ...argumentos),
    async voltarEspaco(espaco, sha, log) {
      const ambiente = ambienteDoEspaco(espaco);
      await exigirGitNoAmbiente(ambiente, espaco.pasta, "update-ref", `refs/heads/${espaco.branch}`, sha);
      await descartarAlteracoes(ambiente, espaco.pasta, log);
    },
    commitComMarca: (espaco, marca) => acharCommitComMarca(ambienteDoEspaco(espaco), espaco.pasta, marca),
    commitar: (projeto, espaco, pedido, limiteMs = LIMITE_COMANDO_MS) =>
      commitarTicket(banco, ambienteDoEspaco(espaco), espaco.pasta, projeto, pedido, limiteMs),
    commitDoTicket: (demandaId, ticketId) => commitDoTicketDemanda(banco, demandaId, ticketId),
    async alteracoesDoEspaco(projeto, espaco) {
      const ponta = async (branch: string) =>
        (await exigirGit(projeto.raiz_git, "rev-parse", `refs/heads/${branch}`)).trim();
      // `base...head` é o diff desde o ancestral comum: o que o Espaço fez, mesmo se a base avançou depois.
      const base = await ponta(espaco.base);
      const head = await ponta(espaco.branch);
      const diff = (formato: string) => exigirGit(projeto.raiz_git, "diff", "-z", "-M", formato, `${base}...${head}`);
      return { base, head, arquivos: arquivosDe(await diff("--name-status"), await diff("--numstat")) };
    },
    async publicarPR(projeto, espaco, pedido, log) {
      const daRodada = espaco.dono.rodada_id !== undefined;
      const basePublicada = `refs/remotes/origin/${projeto.branch_base}`;
      const conferirCommits = async (head: string) => {
        // Commit que já está na base publicada veio de trazer a base para o Espaço (merge), não de um agente: não é órfão.
        await exigirGit(projeto.raiz_git, "fetch", "origin", `+refs/heads/${projeto.branch_base}:${basePublicada}`);
        const jaNaBase = [`^${basePublicada}`, ...(daRodada ? [`^refs/heads/${espaco.base}`] : [])];
        const novos = await exigirGit(projeto.raiz_git, "rev-list", "--no-merges", head, ...jaNaBase);
        const orfao = novos.split("\n").find((sha) => sha !== "" && !pedido.commitsRegistrados.has(sha));
        if (orfao !== undefined) throw pedido.recusarCommitOrfao(orfao);
      };
      await varrerAnotandoAFalha(projeto, log);
      return publicarPRDe(
        raiz,
        projeto,
        { branch: espaco.branch, base: espaco.base, publicarBase: daRodada },
        { titulo: pedido.titulo, corpo: pedido.corpo, conhecidos: pedido.conhecidos, marca: pedido.marca },
        conferirCommits,
      );
    },
    situacaoDoPR: (projeto, numero, relogio) => lerPR(projeto, numero, relogio),
    problemasDoPR: (projeto, numero, log, opcoes) => verificarPR(projeto, numero, log, opcoes),
    integrarPR: (projeto, espaco, log) => ciclo(projeto, espaco, log).integrar(),
    pendenciasDeLimpeza: (projeto, demanda) =>
      pendenciasDeLimpeza(ambienteDoEspaco(espacoDaDemanda(projeto, demanda.demanda.id, raiz)), raiz, projeto, demanda),
    async limparEspaco(projeto, espaco, log, pendentes) {
      const cicloDoEspacoLimpo = ciclo(projeto, espaco, log);
      const feito = await cicloDoEspacoLimpo.limpar(pendentes);
      const sobras = await sobrasDaDemanda(cicloDoEspacoLimpo.ambiente, projeto, feito.removidos);
      return { ...feito, sobras };
    },
    heatmap: (projeto, agora) => heatmapDo(projeto, agora),
    esquecer(projeto, demandas) {
      apagarCommitsDasDemandas(banco, demandas);
      apagarVarreduraDoProjeto(banco, projeto);
    },
    apagarEspacosDoProjeto: (projeto) => removerWorktrees(raiz, projeto),
    parar: pararVarredura,
  };
}
