// Sessão de ajustes do PR reprovado com banco real, git real (origin bare) e pi falso (CA-12 a CA-23 e CA-25 da I-229).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso } from "../../apoio-testes/pi_falso.ts";
import { setTimeout as dormir } from "node:timers/promises";
import { AUDITOR, type Ator } from "../nucleo/ator.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { ErroDeEscopo } from "../nucleo/erros.ts";
import { GATES } from "../nucleo/gate.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { registrarCorrecoesSessao } from "../nucleo/transicoes_rodada.ts";
import { registrarProjeto } from "./projeto/cadastro.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { criarRepositorioDeTeste, commitarArquivo, rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { conferirPromptComFoto } from "./fotos_retorno/conferir_foto.ts";
import { condutor } from "./trabalho/condutor.ts";
import { decidirGate } from "./gates/decidir_gate.ts";
import { abrirSessaoDeAjustes, concluirSessaoAjustes, guardarMarcoDaSessao } from "./sessao_ajustes.ts";
import { enviarDemanda } from "./sessoes_demanda.ts";
import { AmbienteHostLocal } from "../infra/ambiente/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-ajustes-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const DEMANDA = "I-206";
const REF = { demanda_id: DEMANDA, rodada_id: 2 };
const BRANCH_DEMANDA = "fabriquinha/I-206";
const BRANCH_RODADA = "fabriquinha/I-206-2";
const MOTIVO = "Falta teste do fluxo de erro";
const URL_PR = "https://github.com/org/loja/pull/1";

/** Demanda I-206 com a rodada 2 no gate do PR (ticket 8) e as duas worktrees prontas. */
async function cenario(shell = "") {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  const ticket = (ticket_id: number, etapa: string, status: string) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    rodada_id: 2,
  });
  await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, DEMANDA, c.log);
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, REF, c.log);
  const head = commitarArquivo(rodada, "a.txt", "a\n");
  const demanda = join(c.raiz, "worktrees", "loja", DEMANDA, "demanda");
  gravarAgregadoPronto(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "em_execucao",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: BRANCH_DEMANDA,
    },
    rodadas: [
      {
        ...REF,
        titulo: "r2",
        estado: "gate_pr",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: BRANCH_RODADA,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido"),
      ticket(7, "encerrar_rodada", "concluido"),
      ticket(8, "encerrar_rodada", "em_execucao"),
    ],
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [
      {
        demanda_id: DEMANDA,
        ticket_id: 8,
        tipo: "pr_aberto",
        autor: { tipo: "fabriquinha" },
        dados: { id: "1", url: URL_PR, branch: BRANCH_RODADA, head },
        em,
      },
    ],
    pull_requests: [{ rodada_id: 2, numero: 1, url: URL_PR, head, estado: "aberto", atualizado_em: em }],
  } as unknown as AgregadoDemanda);
  const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
  const piFalso = instalarPiFalso(c.dir).roteirizar([
    { shell: shell.replaceAll("{id}", id.join(" ")).replaceAll("{demanda}", demanda) },
  ]);
  return {
    c,
    banco,
    head,
    sha: (branch: string) => rodarGit(c.repo, "rev-parse", branch),
    sujo: () => existsSync(join(rodada, "sujo.txt")),
    ag: () => carregarDemanda(banco, DEMANDA),
    prompts: () => piFalso.prompts(),
    marco: () => join(c.raiz, "execucoes", "ajustes-I-206.R2.json"),
  };
}

const ENDERECO = Endereco.daRodada(DEMANDA, 2);

/** Reprova o PR da rodada pelo gate, que abre a sessão de ajustes com o limite de tempo da configuração. */
const reprovarPRRodada = (banco: DatabaseSync, motivo: string, ator: Ator = AUDITOR) =>
  decidirGate(banco, "gate_pr", ENDERECO, { resultado: "reprovado", motivo }, ator);

/** O mesmo caminho de efeitos do gate, com um limite curto para o pi terminar logo e o `fim` poder ser esperado. */
async function reprovarPRRodadaComLimiteCurto(banco: DatabaseSync, motivo: string) {
  await guardarMarcoDaSessao(banco, REF, carregarDemanda(banco, DEMANDA));
  const reprovada = comDemanda(banco, DEMANDA, (a) =>
    GATES.gate_pr.decidir(a, ENDERECO, { resultado: "reprovado", motivo }, AUDITOR, { agora: em }),
  );
  return abrirSessaoDeAjustes(banco, REF, reprovada, motivo, { limiteMin: 0.02 });
}

async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condicao(); i++) await dormir(20);
  assert.ok(condicao(), "a condição não se cumpriu a tempo");
}

test("CA-12, CA-14, CA-15, CA-23 e CA-25: reprovar registra a recusa, abre a sessão e leva o motivo, a URL e os endereços públicos", async () => {
  const { ag, prompts, banco } = await cenario();

  const { sessao } = await reprovarPRRodada(banco, MOTIVO);

  assert.ok(sessao);
  const depois = ag();
  assert.deepEqual(
    depois.decisoes.map((d) => [d.resultado, d.motivo, d.nota]),
    [["reprovado", MOTIVO, undefined]],
  );
  assert.equal(depois.rodadas[0]?.estado, "ajustar_resultado");
  assert.deepEqual(
    depois.tickets.filter((t) => t.etapa === "ajustar_resultado").map((t) => t.ticket_id),
    [9],
  );
  await ate(() => prompts().length === 1);
  const mensagem = prompts()[0]?.prompt ?? "";
  for (const esperado of [MOTIVO, URL_PR, "I-206.R2", "I-206.T9"]) assert.match(mensagem, new RegExp(esperado));
  assert.doesNotMatch(mensagem, /\bT-\d/);
  await concluirComCorrecao(banco, ag);
});

test("foto do retorno ao agente nos ajustes: reprovação do PR da rodada", async () => {
  const { c, ag, prompts, banco } = await cenario();
  await reprovarPRRodada(banco, MOTIVO);
  await ate(() => prompts().length === 1);
  conferirPromptComFoto(prompts()[0]?.prompt ?? "", c.raiz, "ajustes_reprovacao");
  await concluirComCorrecao(banco, ag);
});

/** Registra a correção como o agente da sessão (ticket 9) e conclui como Auditor. */
async function concluirComCorrecao(banco: DatabaseSync, ag: () => AgregadoDemanda) {
  comDemanda(banco, DEMANDA, (a) =>
    registrarCorrecoesSessao(
      a,
      {
        ...REF,
        ticket_id: 9,
        correcoes: [{ demanda_id: DEMANDA, rodada_id: 2, ticket_id: 1, titulo: "Corrigir", descricao: "Corrigir" }],
      },
      { tipo: "agente", trabalho_id: "1" },
      { agora: em },
    ),
  );
  assert.ok(ag().tickets.some((t) => t.etapa === "implementar" && t.estado === "aberto"));
  return concluirSessaoAjustes(banco, REF, AUDITOR);
}

test("CA-13: reprovar sem motivo, como agente ou fora do gate é reprovado sem gravar o marco nem abrir a sessão", async () => {
  const { ag, banco, marco, prompts } = await cenario();

  await assert.rejects(reprovarPRRodada(banco, ""), /informe o motivo da reprovação/);
  await assert.rejects(reprovarPRRodada(banco, MOTIVO, { tipo: "agente", trabalho_id: "1" }), ErroDeEscopo);
  assert.equal(ag().rodadas[0]?.estado, "gate_pr");
  assert.equal(existsSync(marco()), false);

  // A recusa do domínio (aqui, a rodada fora do gate) vem do ensaio, antes do marco.
  comDemanda(banco, DEMANDA, (a) => ({
    ...a,
    rodadas: a.rodadas.map((r) => ({ ...r, estado: "implementar" as const })),
  }));
  await assert.rejects(reprovarPRRodada(banco, MOTIVO));
  assert.equal(existsSync(marco()), false);
  assert.deepEqual(ag().decisoes, []);
  assert.deepEqual(prompts(), []);
});

test("CA-17 e CA-18: o que o agente commita ou integra na conversa é desfeito ao fim da execução", async () => {
  const { c, banco, head, sha, sujo } = await cenario(
    `git {id} commit --allow-empty -qm indevido && echo x > sujo.txt && git -C {demanda} {id} commit --allow-empty -qm integrado`,
  );
  const demanda = sha(BRANCH_DEMANDA);

  const { fim } = await reprovarPRRodadaComLimiteCurto(banco, MOTIVO);
  await fim;

  assert.equal(sha(BRANCH_RODADA), head);
  assert.equal(sha(BRANCH_DEMANDA), demanda);
  assert.equal(sujo(), false);
  assert.ok(c.raiz);
});

test("CA-16: a mensagem do Auditor pelo chat vai ao pi vivo e a resposta fica na mesma conversa", async () => {
  const { banco, prompts, ag } = await cenario();
  await reprovarPRRodada(banco, MOTIVO);
  await ate(() => prompts().length === 1);
  const sessao = prompts()[0]?.sessao ?? "";
  await ate(() => condutor.situacao(sessao)?.ocupado === false);

  enviarDemanda(banco, sessao, "Cobre o erro de rede também", "prompt", 5);

  await ate(() => prompts().length === 2);
  assert.equal(prompts()[1]?.prompt, "Cobre o erro de rede também");
  assert.equal(prompts()[1]?.sessao, sessao);

  // CA-20 e CA-22: sem correção, ou pelo agente, a conclusão é reprovada e a sessão segue aberta.
  await assert.rejects(concluirSessaoAjustes(banco, REF, AUDITOR), /trabalho corretivo/);
  await assert.rejects(concluirSessaoAjustes(banco, REF, { tipo: "agente", trabalho_id: "1" }), ErroDeEscopo);
  assert.equal(ag().rodadas[0]?.estado, "ajustar_resultado");

  // CA-19 e CA-21: com a correção registrada, o Auditor conclui e a rodada volta ao desenvolvimento.
  await concluirComCorrecao(banco, ag);
  assert.equal(ag().rodadas[0]?.estado, "implementar");
  assert.equal(ag().tickets.find((t) => t.ticket_id === 9)?.estado, "concluido");
});

test("CA-17 e CA-18 na retomada: sem pi vivo, a mensagem pelo chat retoma a mesma sessão e o fim dela desfaz o que o agente fez", async () => {
  const { banco, prompts, ag, sha, head, sujo } = await cenario(
    `git {id} commit --allow-empty -qm indevido && echo x > sujo.txt && git -C {demanda} {id} commit --allow-empty -qm integrado`,
  );
  const demanda = sha(BRANCH_DEMANDA);
  const { fim } = await reprovarPRRodadaComLimiteCurto(banco, MOTIVO);
  await fim;
  const sessao = prompts()[0]?.sessao ?? "";

  enviarDemanda(banco, sessao, "Voltei", "prompt", 0.02);

  await ate(() => prompts().length === 2);
  assert.equal(prompts()[1]?.sessao, sessao);
  assert.equal(prompts()[1]?.prompt, "Voltei");
  // A restauração volta a rodada, a demanda e a worktree depois que o pi para.
  await ate(() => condutor.situacao(sessao) === undefined && sha(BRANCH_DEMANDA) === demanda && !sujo());
  assert.equal(sha(BRANCH_RODADA), head);
  assert.equal(ag().tickets.find((t) => t.ticket_id === 9)?.estado, "aberto");
  await concluirComCorrecao(banco, ag);
});

test("rodada sem PR publicado não reprova", async () => {
  const { banco, ag } = await cenario();
  banco.prepare("DELETE FROM pull_request").run();
  await assert.rejects(reprovarPRRodada(banco, MOTIVO), /não tem PR publicado/);
  assert.deepEqual(ag().decisoes, []);
});

test("o endereço da demanda não reprova o PR, que é da rodada", async () => {
  const { banco, marco } = await cenario();
  await assert.rejects(
    decidirGate(banco, "gate_pr", Endereco.daDemanda(DEMANDA), { resultado: "reprovado", motivo: MOTIVO }, AUDITOR),
    /não é de uma rodada/,
  );
  assert.equal(existsSync(marco()), false);
});
