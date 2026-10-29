// Encerramento final pelo agendador (CA-15 e CA-16): git real e hospedagem falsa; só o `despacharDemandas` conduz as
// etapas. O agente do `resolver_conflito` é falso: escreve na worktree da demanda e fecha pelo `fecharTicketDemanda`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { criarSessao, encerrarExecucao, iniciarExecucao } from "../dominio/sessoes.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommitDemanda } from "../persistencia/commits_demanda.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { alterarLimiteParalelismo, configuracao } from "../persistencia/servico.ts";
import { comSessoesDoTicket } from "../persistencia/sessoes.ts";
import { hospedagemFalsa } from "../repositorio/hospedagem-falsa.test.ts";
import { cenarioDemanda, commitarCenario } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import type { Verificacao } from "../evidencias/verificacoes.ts";
import { despacharDemandas, type DepsDespacho } from "./despacho_demanda.ts";
import { fecharTicketDemanda } from "./fechamento_ticket.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-encerramento-agendador-")));
process.env.GH_TOKEN = "token-do-servico";
const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const D = "I-206";
const BRANCH = "fabriquinha/I-206";

/** Demanda em encerramento (revisão integral aprovada), com a rodada concluída e o `encerrar_demanda` aberto. */
async function cenario() {
  const c = cenarioDemanda([], "develop");
  const banco = abrir(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', ?, 'develop', 'github', 'k')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "develop",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  alterarLimiteParalelismo(banco, 3);
  const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
    demanda_id: D,
    ticket_id,
    etapa,
    status,
    status_alterado_em: em,
    devolucoes: 0,
    ...extra,
  });
  criarDemanda(banco, {
    demanda: {
      id: D,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "encerramento",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: BRANCH,
    },
    rodadas: [{ demanda_id: D, rodada_id: 1, titulo: "r1", fase: "concluida", e2e: false, branch: `${BRANCH}-1` }],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido", { titulo: "Primeiro", rodada_id: 1 }),
      ticket(8, "encerrar_demanda", "aberto"),
    ],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
  const demanda = await garantirWorktreeDemanda(c.raiz, c.projeto, D, c.log, () => Promise.resolve());
  await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: D, rodada_id: 1 }, c.log);
  const sha = commitarCenario(demanda, "a.txt", "a\n");
  gravarCommitDemanda(banco, D, 3, { sha, mensagem: "feat: a [I-206/T-3]", em, arquivos: [] });

  const aprovada = (tipo: Verificacao["tipo"]): Verificacao => ({
    tipo,
    aprovada: true,
    falhas: [],
    dados: {},
    logs: [],
  });
  /** Agente falso: escreve na worktree da demanda, encerra a execução e fecha o ticket com verificações aprovadas. */
  const iniciarExecucaoFalsa: NonNullable<DepsDespacho["iniciarExecucao"]> = (b, ref) => {
    const id = randomUUID();
    const sessao = { ...ref, id: randomUUID(), modo: "autonomo" as const, conversa_referencia: "c" };
    comSessoesDoTicket(b, ref, (estado) => {
      const sessoes = criarSessao(estado.sessoes, sessao);
      return {
        ...estado,
        sessoes,
        execucoes: iniciarExecucao(sessoes, estado.execucoes, { id, sessao_id: sessao.id, inicio: em, falha: false }),
      };
    });
    writeFileSync(join(demanda, "resolvido.txt"), "base incorporada\n");
    const fim = (async () => {
      comSessoesDoTicket(b, ref, (estado) => ({
        ...estado,
        execucoes: encerrarExecucao(estado.execucoes, id, em, false),
      }));
      await fecharTicketDemanda(
        b,
        ref,
        { execucao: id },
        {
          coletarVerificacoes: () =>
            Promise.resolve((["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const).map(aprovada)),
        },
      );
    })();
    return { id, fim };
  };
  const deps: DepsDespacho = {
    iniciarExecucao: iniciarExecucaoFalsa,
    verificacao: { intervaloMs: 1, carenciaMs: 0 },
  };
  const config = configuracao(banco);
  return {
    banco,
    /** Um ciclo do agendador, esperado até o fim das etapas que ele despachou. */
    ciclo: () => Promise.all(despacharDemandas(banco, config, deps)),
    ag: () => carregarDemanda(banco, D),
  };
}

test("CA-15: a revisão integral aprovada vai a concluida só pelo ciclo, sem decisão humana", async () => {
  const c = await cenario();
  await c.ciclo();
  const ag = c.ag();
  assert.equal(ag.demanda.fase, "concluida");
  assert.equal(ag.tickets.find((t) => t.etapa === "encerrar_demanda")?.status, "concluido");
  assert.deepEqual(ag.decisoes, []);
  assert.equal(hospedagem.prs().length, 1);
});

test("CA-16: conflito com a base cria o resolver_conflito; concluído, o ciclo tenta o encerramento de novo e conclui", async () => {
  const c = await cenario();
  hospedagem.abrir({
    head: BRANCH,
    base: "develop",
    titulo: "x",
    corpo: "<!-- fabriquinha I-206 -->",
    estado: "aberto",
    conflito: true,
  });
  await c.ciclo();
  const resolver = c.ag().tickets.find((t) => t.etapa === "resolver_conflito");
  assert.equal(resolver?.status, "aberto");
  assert.equal(c.ag().demanda.fase, "encerramento");

  await c.ciclo();
  assert.equal(c.ag().tickets.find((t) => t.etapa === "resolver_conflito")?.status, "concluido");
  assert.equal(c.ag().demanda.fase, "encerramento");

  hospedagem.mudar(1, { conflito: false });
  await c.ciclo();
  const ag = c.ag();
  assert.equal(ag.demanda.fase, "concluida");
  assert.deepEqual(ag.decisoes, []);
  assert.equal(hospedagem.prs().length, 1);
  assert.equal(
    ag.tickets.some((t) => t.etapa === "revisar_demanda" || t.etapa === "encerrar_rodada"),
    false,
  );
});
