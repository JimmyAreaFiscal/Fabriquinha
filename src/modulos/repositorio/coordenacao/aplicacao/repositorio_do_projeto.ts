// O Repositório do projeto (MELHORIAS §10): a única interface do módulo. Confere o remoto, prepara, atualiza e limpa os
// Espaços de Trabalho no Ambiente que a gestão de Ambientes aloca a cada um, commita os tickets, publica, lê e integra os
// PRs e informa o histórico da base. A fila git por projeto, o git do Ambiente e a varredura dos commits humanos ficam
// aqui dentro; a varredura diária a montagem liga, e `parar` desliga.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, existe, mensagem } from "../../../../shared/nucleo/erros.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { LIMITE_COMANDO_MS } from "../../../../shared/nucleo/primitivos.ts";
import type { Ambiente, GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import {
  apagarCommitsDasDemandas,
  apagarVarreduraDoProjeto,
  type ArquivoCommit,
  arquivosDe,
  type Commit,
  commitarTicket,
  commitDoTicketDemanda,
  cursorDaBase,
  type MetricasDoRepositorio,
  metricasDosCommits,
  type PedidoDasMetricasDoRepositorio,
  type PedidoDeCommit,
  varrerBasesVencidas,
  varrerCommitsHumanos,
} from "../../commits/publico.ts";
import {
  descartarAlteracoes,
  espacoDaDemanda,
  type EspacoDeTrabalho,
  ocupanteDoDono,
  pendenciasDeLimpeza,
  removerWorktrees,
  type ResultadoAtualizacao,
  sobrasDaDemanda,
} from "../../espaco_de_trabalho/publico.ts";
import { exigirGit, exigirGitNoAmbiente, type Hospedagem, type ProjetoDoRepositorio } from "../../git/publico.ts";
import { type Heatmap, heatmapDo } from "../../historico/publico.ts";
import {
  conferirProjeto,
  type LeituraDoPR,
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
  /** Os tickets cujos commits registrados sobem no PR: só eles. */
  tickets: readonly number[];
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

/** O Espaço pronto para o trabalho: a pasta da worktree e o Ambiente em que ela roda. */
interface EspacoPreparado {
  pasta: string;
  ambiente: Ambiente;
  /** Só com `atualizarComBase`: o que a incorporação da ponta da demanda deu. */
  atualizacao?: ResultadoAtualizacao;
}

/** Como esperar a hospedagem decidir o conflito e os checks do PR. */
interface EsperaDosChecks {
  log: string;
  opcoes?: OpcoesVerificacao;
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
  /**
   * Varre agora os commits humanos da base: no projeto recém-cadastrado, fixa o cursor inicial. Fica fora de `conferir`
   * porque o cursor tem chave estrangeira no projeto, que só existe depois da gravação do cadastro.
   */
  varrerBase(projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">): Promise<void>;
  /** O último commit da base que a varredura viu, se ela já rodou: a tela SDLC o mostra. */
  cursorDaBase(projeto: string): string | undefined;
  /**
   * Garante a worktree do Espaço no Ambiente que a gestão aloca a ele e devolve a pasta e o Ambiente; quando buscou a
   * base, varre os commits humanos (a falha só vai ao `log`). Com `atualizarComBase`, em vez de garantir, incorpora no
   * Espaço da rodada a ponta da demanda (o conflito volta em `atualizacao`): a rodada só se atualiza no encerramento.
   */
  prepararEspaco(
    projeto: ProjetoDoEspaco,
    espaco: EspacoDeTrabalho,
    log: string,
    opcoes?: { atualizarComBase: true },
  ): Promise<EspacoPreparado>;
  /**
   * Roda o git na pasta do Espaço, no Ambiente dele, e devolve a saída; o que falha lança `ErroDeRegra`. É o git do
   * Ambiente, que fica aqui dentro: as leituras da worktree (aula, Sonar, marco da sessão de ajustes, a marca do commit).
   */
  gitNoEspaco(espaco: EspacoDeTrabalho, ...argumentos: string[]): Promise<string>;
  /** Volta a branch do Espaço ao `sha` e descarta o que ficou na worktree, na fila da pasta, sem commitar. */
  voltarEspaco(espaco: EspacoDeTrabalho, sha: string, log: string): Promise<void>;
  /** Commita o ticket no Espaço (idempotente pela marca), grava o commit e os commits posteriores e o devolve. */
  commitar(
    projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">,
    espaco: EspacoDeTrabalho,
    pedido: PedidoDeCommit,
    limiteMs?: number,
  ): Promise<Commit>;
  /** O que o Espaço da rodada mudou contra a branch da demanda, lido no clone (o diff da revisão da rodada). */
  alteracoesDoEspaco(
    projeto: Pick<ProjetoDoRepositorio, "raiz_git">,
    espaco: EspacoDeTrabalho,
  ): Promise<AlteracoesDoEspaco>;
  /**
   * Varre os commits humanos (a falha só vai ao `log`) e publica o PR do Espaço para a base dele; o da rodada empurra a
   * base também. Só os commits que os `tickets` registraram sobem.
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
  ): Promise<LeituraDoPR>;
  /** Com a `espera`: espera a hospedagem decidir o conflito e os checks do PR `numero` e devolve os problemas. */
  situacaoDoPR(
    projeto: Pick<ProjetoDoRepositorio, "raiz_git" | "hospedagem">,
    numero: string,
    espera: EsperaDosChecks,
  ): Promise<ProblemasDoPR>;
  /** Integra o PR da rodada na hospedagem e avança a branch local da demanda; o PR final, só o humano integra. */
  integrarPR(projeto: ProjetoDoEspaco, espaco: EspacoDeTrabalho, log: string): Promise<void>;
  /**
   * O que a demanda ainda deixa no disco e no git: as worktrees e as branches dela e das rodadas. O encerramento a guarda
   * quando o PR final é integrado, antes de limpar: a posse some com a branch local, e a remota que falhou só a lista
   * reconhece na repetição.
   */
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
  /** As métricas do Repositório das `demandas` no período, lidas em lote; quem agrupa por Etapa, mês ou demanda é quem pede. */
  metricas(pedido: PedidoDasMetricasDoRepositorio): MetricasDoRepositorio;
  /**
   * Na remoção do projeto, na unidade de trabalho dela: apaga os commits das `demandas` e o cursor da varredura do
   * projeto, e devolve a remoção das worktrees dele, para depois do commit da unidade (cada falha vira um aviso).
   */
  esquecer(
    projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">,
    demandas: readonly string[],
  ): () => Promise<string[]>;
  /** Desliga a varredura diária e espera a que estiver em andamento. */
  parar(): Promise<void>;
}

/** A varredura diária dos commits humanos: os projetos cadastrados e a cadência do agendador, lida a cada batida. */
interface VarreduraDiaria {
  projetos: () => readonly Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">[];
  /** O intervalo do agendador, em minutos, e se ele está ligado; o que lança vale como desligado (o agendador já o loga). */
  cadencia: () => { intervaloMin: number; agendadorAtivo: boolean };
  relogio?: Relogio;
  registrarErro: (erro: unknown) => void;
}

interface MontagemDoRepositorio {
  banco: DatabaseSync;
  /** Quem aloca, dá e limpa o Ambiente de cada Espaço; sem ela, as operações no Espaço recusam. */
  ambientes?: GestaoDeAmbientes;
  /** Só o serviço liga: a cada intervalo do agendador ligado, varre os projetos sem varredura há 24 horas. */
  varredura?: VarreduraDiaria;
}

/**
 * A varredura que a montagem liga: a batida é de minuto em minuto e varre a cada `intervaloMin` batidas, no ritmo do
 * agendador, no máximo uma varredura por vez. Desligado, o contador continua: ligado depois do intervalo, a varredura
 * vem na batida seguinte.
 */
function ligarVarreduraDiaria(banco: DatabaseSync, varredura: VarreduraDiaria): () => Promise<void> {
  const { projetos, cadencia, relogio = relogioDoSistema, registrarErro } = varredura;
  let emAndamento: Promise<void> | undefined;
  let minutos = 0;
  const batida = setInterval(() => {
    let lida: { intervaloMin: number; agendadorAtivo: boolean };
    try {
      lida = cadencia();
    } catch {
      return;
    }
    if (++minutos < lida.intervaloMin || !lida.agendadorAtivo) return;
    minutos = 0;
    emAndamento ??= varrerBasesVencidas(banco, projetos, relogio, registrarErro)
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
export function montarRepositorio({ banco, ambientes, varredura }: MontagemDoRepositorio): RepositorioDoProjeto {
  const raiz = raizDo(banco);
  const pararVarredura = varredura ? ligarVarreduraDiaria(banco, varredura) : () => Promise.resolve();
  const gestao = (): GestaoDeAmbientes =>
    existe(ambientes, "o Repositório não tem a gestão de Ambientes", "monte-o com a gestão da composição");
  /** Onde roda o trabalho do Espaço: o Ambiente que a gestão alocou a ele ou, sem alocação, o do serviço. */
  const ambienteDoEspaco = (espaco: EspacoDeTrabalho): Ambiente => gestao().ambienteDo(ocupanteDoDono(espaco.dono));
  const ciclo = (projeto: ProjetoDoEspaco, espaco: EspacoDeTrabalho, log: string) =>
    cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoEspaco(espaco), gestao());
  const varrerAnotandoAFalha = (projeto: ProjetoDoRepositorio, log: string) =>
    varrerCommitsHumanos(banco, projeto).catch((erro: unknown) => {
      anotar(log, `varrerCommitsHumanos falhou: ${mensagem(erro)}`);
    });

  return {
    conferir: (projeto) => conferirProjeto(projeto),
    varrerBase: (projeto) => varrerCommitsHumanos(banco, projeto),
    cursorDaBase: (projeto) => cursorDaBase(banco, projeto),
    async prepararEspaco(projeto, espaco, log, opcoes) {
      const cicloDoEspacoPreparado = ciclo(projeto, espaco, log);
      if (opcoes?.atualizarComBase) {
        const atualizacao = await cicloDoEspacoPreparado.atualizarComBase();
        return { pasta: espaco.pasta, ambiente: cicloDoEspacoPreparado.ambiente, atualizacao };
      }
      const { pasta, buscouBase } = await cicloDoEspacoPreparado.criar();
      if (buscouBase) await varrerAnotandoAFalha(projeto, log);
      return { pasta, ambiente: cicloDoEspacoPreparado.ambiente };
    },
    gitNoEspaco: (espaco, ...argumentos) => exigirGitNoAmbiente(ambienteDoEspaco(espaco), espaco.pasta, ...argumentos),
    async voltarEspaco(espaco, sha, log) {
      const ambiente = ambienteDoEspaco(espaco);
      await exigirGitNoAmbiente(ambiente, espaco.pasta, "update-ref", `refs/heads/${espaco.branch}`, sha);
      await descartarAlteracoes(ambiente, espaco.pasta, log);
    },
    commitar: (projeto, espaco, pedido, limiteMs = LIMITE_COMANDO_MS) =>
      commitarTicket(banco, ambienteDoEspaco(espaco), espaco.pasta, projeto, pedido, limiteMs),
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
      const commitsRegistrados = new Set(
        pedido.tickets.map((ticket) => commitDoTicketDemanda(banco, espaco.dono.demanda_id, ticket)?.sha),
      );
      const basePublicada = `refs/remotes/origin/${projeto.branch_base}`;
      const conferirCommits = async (head: string) => {
        // Commit que já está na base publicada veio de trazer a base para o Espaço (merge), não de um agente: não é órfão.
        await exigirGit(projeto.raiz_git, "fetch", "origin", `+refs/heads/${projeto.branch_base}:${basePublicada}`);
        const jaNaBase = [`^${basePublicada}`, ...(daRodada ? [`^refs/heads/${espaco.base}`] : [])];
        const novos = await exigirGit(projeto.raiz_git, "rev-list", "--no-merges", head, ...jaNaBase);
        const orfao = novos.split("\n").find((sha) => sha !== "" && !commitsRegistrados.has(sha));
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
    situacaoDoPR: ((projeto, numero, relogioOuEspera?: Relogio | EsperaDosChecks) =>
      relogioOuEspera !== undefined && "log" in relogioOuEspera
        ? verificarPR(projeto, numero, relogioOuEspera.log, relogioOuEspera.opcoes)
        : lerPR(projeto, numero, relogioOuEspera)) as RepositorioDoProjeto["situacaoDoPR"],
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
    metricas: (pedido) => metricasDosCommits(banco, pedido),
    esquecer(projeto, demandas) {
      apagarCommitsDasDemandas(banco, demandas);
      apagarVarreduraDoProjeto(banco, projeto.nome);
      return () => removerWorktrees(raiz, projeto);
    },
    parar: pararVarredura,
  };
}
