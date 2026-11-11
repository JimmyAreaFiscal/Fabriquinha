// Preparo do estresse das rotas POST e DELETE: cada função cria, no banco da raiz temporária do ambiente, um registro só
// para uma chamada, já no estado que a rota exige (CA-2). Roda antes de medir, então o custo fica fora do tempo medido; o
// grupo prepara as chamadas de uma ação de uma vez e só então dispara. O pi é o falso do ambiente ($FABRIQUINHA_PI)
// e o `gh` é o de `integracao/falsos.ts`, com o estado de cada PR no arquivo dele.
// Não usa `integracao/apoio.ts`: ele registra hooks do node:test e mexe no process.env ao ser importado.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgregadoDemanda } from "../../src/sdlc/nucleo/demanda/agregado_demanda.ts";
import { registrarCorrecoesSessao } from "../../src/sdlc/nucleo/transicoes/transicoes_rodada.ts";
import { criarAvaliacao } from "../../src/qualidade/armazenamento/avaliacoes.ts";
import { abrir } from "../../src/compartilhado/armazenamento/banco.ts";
import { comDemanda } from "../../src/sdlc/armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { importarAchados } from "../../src/qualidade/armazenamento/avaliacoes.ts";
import { registrarProjeto } from "../../src/projeto/aplicacao/cadastro.ts";
import { criarTarefa, criarUsuarioSimulado } from "../../src/qualidade/armazenamento/simulacao.ts";
import { comTrabalhosDoTicket } from "../../src/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import {
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "../../src/repositorio/infra/worktree/worktree-demanda.ts";
import { exigirGit } from "../../src/repositorio/infra/worktree/worktree.ts";
import { ghFalso } from "../../integracao/falsos.ts";
import type { Ambiente } from "../instancia_descartavel.ts";
import { AmbienteHostLocal } from "../../src/sandbox/infra/host_local/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();

const em = "2026-10-11T12:00:00.000Z";
const CRITERIOS = ["CA-1", "CA-2"];

/** O que uma rodada com PR deixa para a rota: o endereço `I-n.R1` e o número do PR na hospedagem falsa. */
export interface RodadaComPR {
  demanda: string;
  rodada: string;
  pr: number;
}

/** Os preparos de uma chamada cada; todos devolvem os ids que o caminho e o corpo da rota usam. */
export interface Preparo {
  /** O projeto onde os preparos nascem: git real, remoto bare local e configuração do SDLC. */
  projeto: string;
  /** Em `gate_demanda`: decisão da demanda e cancelar. */
  demandaEnviada(): string;
  /** Em `concluida`: arquivar. */
  demandaConcluida(): string;
  /** Em `gate_planejamento`, com o plano submetido: decisão do planejamento. */
  planejamentoPronto(): string;
  /** Em `gate_pr`, com as branches no origin, as worktrees e o PR aberto: decisão do PR. */
  rodadaComPR(): Promise<RodadaComPR>;
  /** Na sessão de ajustes (rodada em `sessao`, sem pi vivo): com `corrigida`, concluir. */
  rodadaEmAjustes(corrigida?: boolean): Promise<string>;
  /** Ticket `implementar` em `falhou`, endereço `I-n.T1`, sem worktree (reabrir só muda o ticket): reabrir. */
  ticketFalho(): Promise<string>;
  /** Ticket `implementar` `aberto` de uma demanda em execução, com as worktrees prontas, `I-n.T1`: executar. */
  ticketAberto(): Promise<string>;
  /**
   * Sessão interativa parada (conversa): mensagem, com a rodada pronta para o pi falso. Sem `comWorktree`, para as rotas
   * que não chegam ao git (diálogo e avaliação): as worktrees de cada chamada eram o grosso do tempo do estresse.
   */
  sessaoParada(comWorktree?: boolean): Promise<string>;
  /** Sessão com a execução aberta e sem pi vivo, sem worktree (abortar não chega ao git): abortar. */
  sessaoRodando(): Promise<string>;
  /** Um projeto próprio, para remover ou editar. */
  projetoProprio(): Promise<string>;
  /** Um repositório git novo (com remoto), para cadastrar um projeto. */
  repositorioNovo(): Promise<string>;
  /** Um Usuário Simulado sem anexos, do projeto principal. */
  usuarioSimulado(): number;
  /** Uma Tarefa com um usuário, do projeto principal (que tem o link do produto, então o Executar a aceita). */
  tarefa(): number;
  /** Uma avaliação em disco, sem pi vivo; com `achado`, com o achado 1 por encaminhar. */
  avaliacao(achado?: boolean): string;
  fechar(): void;
}

/** Instala o `gh` falso na frente do PATH do serviço e abre o banco da raiz do ambiente. */
export async function criarPreparo(amb: Ambiente): Promise<Preparo> {
  const banco = abrir(amb.raiz);
  const log = join(amb.raiz, "execucoes", "preparo.log");
  mkdirSync(join(amb.raiz, "execucoes"), { recursive: true });
  let contador = 1000;
  const proximo = () => ++contador;

  const git = (dir: string, ...args: string[]) =>
    exigirGit(dir, "-c", "user.name=Estresse", "-c", "user.email=estresse@exemplo.com", ...args);

  // O serviço achou o `gh` da raiz (o do ambiente, que não responde nada) na frente do PATH: troca-o por um que escolhe
  // o estado pelo número do PR (`gh pr view|merge <n>`), para as aprovações simultâneas não disputarem um JSON só.
  const hospedagem = join(amb.raiz, "hospedagem");
  ghFalso(hospedagem);
  const wrapper = join(amb.raiz, "bin", "gh.novo");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexport FALSO_HOSPEDAGEM="${hospedagem}/pr-$3.json"\n` +
      `[ -f "$FALSO_HOSPEDAGEM" ] || export FALSO_HOSPEDAGEM="${hospedagem}/hospedagem.json"\n` +
      `exec "${hospedagem}/bin/gh" "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  renameSync(wrapper, join(amb.raiz, "bin", "gh"));
  let numeroDoPR = 0;
  const abrirPR = (head: string, base: string): number => {
    const id = ++numeroDoPR;
    writeFileSync(
      join(hospedagem, `pr-${String(id)}.json`),
      JSON.stringify({
        prs: [{ id, head, base, titulo: "t", corpo: "c", estado: "aberto" }],
        chamadas: [],
        falha: {},
        saida: {},
      }),
    );
    return id;
  };

  /** Um repositório git de verdade com o remoto num bare local e a `main` publicada. */
  async function repositorio(pasta: string) {
    const dir = join(amb.raiz, `${pasta}-${String(proximo())}`);
    mkdirSync(dir);
    const bare = join(dir, "origin.git");
    const repo = join(dir, "repo");
    mkdirSync(repo);
    await git(dir, "init", "-q", "--bare", bare);
    await git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "LEIAME"), "estresse\n");
    await git(repo, "add", "LEIAME");
    await git(repo, "commit", "-q", "-m", "início");
    await git(repo, "remote", "add", "origin", bare);
    await git(repo, "push", "-q", "origin", "main");
    return { repo, bare };
  }

  async function cadastrar(nome: string) {
    const { repo } = await repositorio(nome);
    return registrarProjeto(banco, {
      nome,
      branch_base: "main",
      chave_sonarqube: nome,
      raiz_git: repo,
      hospedagem: "github",
      etapas: [],
      verificacoes: {
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
    });
  }

  const principal = await cadastrar("estresse");
  // O Executar da Tarefa recusa o projeto sem o link do produto (F8): o pi falso não o abre.
  banco.prepare("UPDATE projeto SET link_produto = ? WHERE nome = ?").run("http://127.0.0.1:9", principal.nome);

  const ticket = (demanda_id: string, ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
    demanda_id,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    ...extra,
  });
  const rodada = (demanda_id: string, estado: string) => ({
    demanda_id,
    rodada_id: 1,
    titulo: "rodada 1",
    estado,
    estado_alterado_em: "2026-01-01T00:00:00.000Z",
    e2e: false,
    branch: `fabriquinha/${demanda_id}-1`,
  });

  const novoId = () => `I-${String(proximo())}`;

  /** Cria a demanda `estado` do projeto principal; `resto` traz tickets, rodadas, evidências... */
  function criar(estado: string, resto: object = {}, id = novoId()): string {
    gravarAgregadoPronto(banco, {
      demanda: {
        id,
        projeto: principal.nome,
        titulo: `Demanda ${id}`,
        tipo: "funcionalidade",
        descricao: "d",
        estado,
        estado_alterado_em: em,
        criada_por: { tipo: "externo", ferramenta: "claude", sessao: id },
        enviada: true,
        branch: `fabriquinha/${id}`,
      },
      tickets: [],
      decisoes: [],
      evidencias: [],
      rodadas: [],
      dependencias_rodada: [],
      criterios_citados: [],
      dependencias_ticket: [],
      caminhos_ticket: [],
      arquivos_previstos_rodada: [],
      arquivos_previstos_demanda: [],
      versoes_plano: [],
      tentativas: [],
      ...resto,
    } as unknown as AgregadoDemanda);
    return id;
  }

  /** As worktrees da demanda e da rodada 1, como o planejamento aprovado as deixa; devolve a da rodada. */
  async function worktrees(id: string): Promise<string> {
    await garantirWorktreeDemanda(ambiente, amb.raiz, principal, id, log);
    return garantirWorktreeRodada(ambiente, amb.raiz, principal, { demanda_id: id, rodada_id: 1 }, log);
  }

  /** Demanda em `em_execucao` com a rodada 1 no `estado`, as worktrees prontas (se `comWorktree`) e os tickets dados. */
  async function emExecucao(estado: string, tickets: object[], resto: object = {}, comWorktree = true) {
    const id = novoId();
    const dir = comWorktree ? await worktrees(id) : "";
    criar(
      "em_execucao",
      { rodadas: [rodada(id, estado)], tickets: tickets.map((t) => ({ ...t, demanda_id: id })), ...resto },
      id,
    );
    return { id, dir };
  }

  /** O ticket 1 `implementar` da rodada 1 com `status`, numa demanda em execução. */
  const comTicket = async (status: string, comWorktree = true) =>
    (await emExecucao("implementar", [ticket("", 1, "implementar", status, { rodada_id: 1 })], {}, comWorktree)).id;

  /** Uma sessão interativa do ticket `ticket_id` com a execução dada. */
  function abrirSessao(demanda_id: string, ticket_id: number, aberta: boolean): string {
    const sessao = `sd-${String(proximo())}`;
    comTrabalhosDoTicket(banco, { demanda_id, ticket_id }, (e) => ({
      ...e,
      sessoes: [{ demanda_id, ticket_id, id: sessao, modo: "interativo", conversa_referencia: sessao }],
      execucoes: [
        {
          id: `ed-${String(proximo())}`,
          trabalho_id: sessao,
          inicio: em,
          ...(aberta ? {} : { fim: em }),
          falha: false,
        },
      ],
    }));
    return sessao;
  }

  return {
    projeto: principal.nome,

    demandaEnviada() {
      const id = novoId();
      return criar("gate_demanda", { tickets: [ticket(id, 1, "entender_e_desenhar", "em_execucao")] }, id);
    },

    demandaConcluida: () => criar("concluida"),

    planejamentoPronto() {
      const id = novoId();
      const plano = {
        demanda_id: id,
        criterios: CRITERIOS,
        rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "r1", e2e: false, criterios: [CRITERIOS[0]], depende: [] }],
        tickets: [{ demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "t1", descricao: "d" }],
      };
      return criar(
        "gate_planejamento",
        {
          tickets: [ticket(id, 1, "planejar", "em_execucao")],
          evidencias: [
            {
              demanda_id: id,
              tipo: "criterios_aceite",
              dados: { criterios: CRITERIOS.map((c) => ({ id: c, dado: "d", quando: "q", entao: "e" })) },
              autor: { tipo: "externo", ferramenta: "claude", sessao: id },
              em,
            },
            { demanda_id: id, ticket_id: 1, tipo: "plano", dados: plano, autor: { tipo: "fabriquinha" }, em },
          ],
        },
        id,
      );
    },

    async rodadaComPR() {
      const id = novoId();
      const dir = await worktrees(id);
      // O commit da rodada vai ao origin junto com a branch da demanda: o merge do PR é entre as duas.
      await git(dir, "commit", "-q", "--allow-empty", "-m", "rodada 1");
      const head = (await git(dir, "rev-parse", "HEAD")).trim();
      await git(principal.raiz_git, "push", "-q", "origin", `fabriquinha/${id}`, `fabriquinha/${id}-1`);
      const pr = abrirPR(`fabriquinha/${id}-1`, `fabriquinha/${id}`);
      const url = `https://github.com/org/loja/pull/${String(pr)}`;
      criar(
        "em_execucao",
        {
          rodadas: [rodada(id, "gate_pr")],
          tickets: [
            ticket(id, 1, "implementar", "concluido", { rodada_id: 1 }),
            ticket(id, 2, "encerrar_rodada", "em_execucao", { rodada_id: 1 }),
          ],
          evidencias: [
            {
              demanda_id: id,
              ticket_id: 2,
              tipo: "pr_aberto",
              dados: { id: String(pr), url, branch: `fabriquinha/${id}-1`, head },
              autor: { tipo: "fabriquinha" },
              em,
            },
          ],
          pull_requests: [{ rodada_id: 1, numero: pr, url, head, estado: "aberto", atualizado_em: em }],
        },
        id,
      );
      return { demanda: id, rodada: `${id}.R1`, pr };
    },

    async rodadaEmAjustes(corrigida = false) {
      const { id, dir } = await emExecucao("ajustar_resultado", [
        ticket("", 1, "implementar", "concluido", { rodada_id: 1 }),
        ticket("", 2, "encerrar_rodada", "concluido", { rodada_id: 1 }),
        ticket("", 3, "ajustar_resultado", "em_execucao", { rodada_id: 1 }),
      ]);
      abrirSessao(id, 3, false);
      // O marco que a reprovação do PR grava: as duas pontas que a conclusão restaura.
      const marco = {
        rodada: { branch: `fabriquinha/${id}-1`, sha: (await git(dir, "rev-parse", "HEAD")).trim() },
        demanda: { branch: `fabriquinha/${id}`, sha: (await git(dir, "rev-parse", `fabriquinha/${id}`)).trim() },
      };
      writeFileSync(join(amb.raiz, "execucoes", `ajustes-${id}.R1.json`), JSON.stringify(marco));
      if (corrigida) {
        comDemanda(banco, id, (ag) =>
          registrarCorrecoesSessao(
            ag,
            {
              demanda_id: id,
              rodada_id: 1,
              ticket_id: 3,
              correcoes: [{ demanda_id: id, rodada_id: 1, ticket_id: 1, titulo: "Corrigir", descricao: "Corrigir" }],
            },
            { tipo: "agente", trabalho_id: "execucao-1" },
            { agora: em },
          ),
        );
      }
      return `${id}.R1`;
    },

    async ticketFalho() {
      const id = await comTicket("falhou", false);
      return `${id}.T1`;
    },

    async ticketAberto() {
      return `${await comTicket("aberto")}.T1`;
    },

    async sessaoParada(comWorktree = true) {
      const tickets = [ticket("", 1, "ajustar_resultado", "em_execucao", { rodada_id: 1 })];
      const { id } = await emExecucao("ajustar_resultado", tickets, {}, comWorktree);
      return abrirSessao(id, 1, false);
    },

    async sessaoRodando() {
      const tickets = [ticket("", 1, "ajustar_resultado", "em_execucao", { rodada_id: 1 })];
      const { id } = await emExecucao("ajustar_resultado", tickets, {}, false);
      return abrirSessao(id, 1, true);
    },

    projetoProprio: async () => (await cadastrar(`proprio-${String(proximo())}`)).nome,

    repositorioNovo: async () => (await repositorio("novo")).repo,

    usuarioSimulado: () =>
      criarUsuarioSimulado(banco, principal.nome, { nome: `u${String(proximo())}`, descricao: "d" }).id,

    tarefa() {
      const usuario = criarUsuarioSimulado(banco, principal.nome, { nome: `u${String(proximo())}`, descricao: "d" }).id;
      return criarTarefa(banco, principal.nome, { texto: "t", n: 1, usuarios: [usuario] }).id;
    },

    avaliacao(achado = false) {
      const id = randomUUID();
      criarAvaliacao(banco, {
        id,
        projeto: principal.nome,
        de: "2026-01-01",
        ate: "2026-12-31",
        pedido: "",
        criada_em: em,
        demandas: [],
      });
      if (achado) importarAchados(banco, id, [{ achado_id: 1, titulo: "t", descricao: "d", evidencia: "e" }]);
      const dir = join(amb.raiz, "avaliacoes", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "prompt.md"), "# Avaliação\n");
      return id;
    },

    fechar: () => {
      banco.close();
    },
  };
}
