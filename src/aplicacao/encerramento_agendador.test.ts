// Encerramento final pelo agendador (CA-15 e CA-16): git real e hospedagem falsa; só o `cicloDoDespacho` conduz as
// etapas, e o merge do PR final é do humano, que o teste faz na plataforma falsa. O agente do `resolver_conflito` é o pi falso: escreve na worktree da demanda, e a condução fecha o ticket com verificações que passaram.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { gravarCommitDemanda } from "../armazenamento/commits_demanda.ts";
import { registrarProjeto } from "./projeto/cadastro.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { configuracao } from "../armazenamento/servico.ts";
import { hospedagemFalsa } from "../../apoio-testes/hospedagem_falsa.ts";
import { instalarPiFalso } from "../../apoio-testes/pi_falso.ts";
import { verificacaoDeTeste } from "../../apoio-testes/verificacoes_de_teste.ts";
import { criarRepositorioDeTeste, commitarArquivo } from "../../apoio-testes/repositorio_de_teste.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import type { RegistroDaVerificacao } from "./evidencias/verificacoes.ts";
import { cicloDoDespacho, type DepsDespacho } from "./despacho.ts";
import { AmbienteHostLocal } from "../infra/ambiente/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-encerramento-agendador-")));
process.env.GH_TOKEN = "token-do-servico";
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;
const piFalso = instalarPiFalso(temporario);
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

/** Demanda em encerramento (revisão integral aceita), com a rodada concluída e o `encerrar_demanda` aberto. */
async function cenario() {
  const c = criarRepositorioDeTeste([], "develop");
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "develop",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  banco.prepare("UPDATE configuracao SET limite_paralelismo = 3").run();
  const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
    demanda_id: D,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    ...extra,
  });
  gravarAgregadoPronto(banco, {
    demanda: {
      id: D,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "encerrar_demanda",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: BRANCH,
    },
    rodadas: [
      {
        demanda_id: D,
        rodada_id: 1,
        titulo: "r1",
        estado: "concluida",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: `${BRANCH}-1`,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido", { titulo: "Primeiro", rodada_id: 1 }),
      ticket(8, "encerrar_demanda", "aberto"),
    ],
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
  const demanda = await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, D, c.log);
  await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, { demanda_id: D, rodada_id: 1 }, c.log);
  const sha = commitarArquivo(demanda, "a.txt", "a\n");
  gravarCommitDemanda(banco, D, 3, { sha, mensagem: "feat: a [I-206/T-3]", em, arquivos: [] });

  const verificacaoQuePassa = (tipo: RegistroDaVerificacao["tipo"]) => verificacaoDeTeste(tipo, true, undefined, []);
  piFalso.roteirizar([{ escreve: { "resolvido.txt": "base incorporada\n" } }]);
  const deps: DepsDespacho = {
    implementacao: {
      coletarVerificacoes: () =>
        Promise.resolve((["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const).map(verificacaoQuePassa)),
    },
    verificacao: { intervaloMs: 1, carenciaMs: 0 },
  };
  const config = configuracao(banco);
  return {
    banco,
    /** Um ciclo do agendador, esperado até o fim das etapas que ele despachou. */
    ciclo: () => Promise.all(cicloDoDespacho(banco, config, deps)),
    ag: () => carregarDemanda(banco, D),
    /** O humano aprova e integra o PR final na plataforma. */
    integrarComoHumano: () => execFileSync("gh", ["pr", "merge", "1", "--merge"], { cwd: c.repo, stdio: "pipe" }),
  };
}

test("CA-15: a revisão integral aceita vai a concluida pelo ciclo depois do merge humano, sem decisão no gate", async () => {
  const c = await cenario();
  await c.ciclo();
  assert.equal(c.ag().encerramento?.aguardando_merge_humano, true);
  assert.equal(c.ag().demanda.estado, "encerrar_demanda");
  c.integrarComoHumano();
  await c.ciclo();
  const ag = c.ag();
  assert.equal(ag.demanda.estado, "concluida");
  assert.equal(ag.tickets.find((t) => t.etapa === "encerrar_demanda")?.estado, "concluido");
  assert.deepEqual(ag.decisoes, []);
  assert.equal(hospedagem.prs().length, 1);
});

test("CA-16: conflito com a base cria o resolver_conflito; concluído, o ciclo tenta o encerramento de novo e conclui", async () => {
  const c = await cenario();
  hospedagem.abrirPr({
    head: BRANCH,
    base: "develop",
    titulo: "x",
    corpo: "<!-- fabriquinha I-206 -->",
    estado: "aberto",
    conflito: true,
  });
  await c.ciclo();
  const resolver = c.ag().tickets.find((t) => t.etapa === "resolver_conflito");
  assert.equal(resolver?.estado, "aberto");
  assert.equal(c.ag().demanda.estado, "encerrar_demanda");

  await c.ciclo();
  assert.equal(c.ag().tickets.find((t) => t.etapa === "resolver_conflito")?.estado, "concluido");
  assert.equal(c.ag().demanda.estado, "encerrar_demanda");

  hospedagem.mudar(1, { conflito: false });
  await c.ciclo();
  c.integrarComoHumano();
  await c.ciclo();
  const ag = c.ag();
  assert.equal(ag.demanda.estado, "concluida");
  assert.deepEqual(ag.decisoes, []);
  assert.equal(hospedagem.prs().length, 1);
  assert.equal(
    ag.tickets.some((t) => t.etapa === "revisar_demanda" || t.etapa === "encerrar_rodada"),
    false,
  );
});
