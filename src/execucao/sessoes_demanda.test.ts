// Leitura das sessões dos tickets da demanda no chat (I-239, CA-1 a CA-7, CA-13 e CA-14) com banco real; o fluxo ao vivo
// e o diálogo vêm do pi falso do e2e.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import type { ExecucaoSessao, Sessao } from "../dominio/sessoes.ts";
import { encontrado } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../persistencia/sessoes.ts";
import { cenarioDemanda } from "../repositorio/worktree-cenarios.ts";
import { interromperExecucaoDemanda, iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { avisar, situacao } from "./gerente.ts";
import {
  abortarDemanda,
  abrirChatDemanda,
  cabecalhoDaDemanda,
  calcular,
  type Carregada,
  enviarDemanda,
  exportarHistoricoDemanda,
  responderDialogoDemanda,
} from "./sessoes_demanda.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-sessoes-demanda-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
process.env.FABRIQUINHA_PI = resolve(import.meta.dirname, "../../e2e/pi-falso.ts");
delete process.env.FABRIQUINHA_PORTA;

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const ticket = (demanda_id: string, ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  status,
  status_alterado_em: em,
  devolucoes: 0,
  ...extra,
});

const demanda = (id: string, fase: string, descricao: string, tickets: object[]): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `demanda ${id}`,
      tipo: "funcionalidade",
      descricao,
      fase,
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: id,
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    tickets,
    rodadas: [
      {
        demanda_id: id,
        rodada_id: 1,
        titulo: "r1",
        fase: "desenvolvimento",
        e2e: false,
        branch: `fabriquinha/${id}-1`,
      },
    ],
    decisoes: [],
    evidencias: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
  }) as unknown as AgregadoDemanda;

const mensagem = (role: string, texto: string, extra: object = {}) => ({
  type: "message",
  message: { role, content: [{ type: "text", text: texto }], ...extra },
});

/**
 * Banco com o projeto `loja` e a I-300 em planejamento: T1 planejar (interativo), T2 e T3 de rodada (autônomos, T3
 * falhou), T4 concluído e T5 autônomo parado; a I-301 está no gate do plano. Cada sessão é `s<ticket>`.
 */
function cenario() {
  const c = cenarioDemanda();
  const banco = abrir(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('loja', ?, 'integracao', 'github', '["t"]', 'k', '[{"nome":"f"}]')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: "true" }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  criarDemanda(
    banco,
    demanda("I-300", "planejamento", "d", [
      ticket("I-300", 1, "planejar", "em_execucao"),
      ticket("I-300", 2, "implementar", "em_execucao", { rodada_id: 1, titulo: "implementa" }),
      ticket("I-300", 3, "implementar", "falhou", { rodada_id: 1, motivo_falha: "testes reprovaram" }),
      ticket("I-300", 4, "implementar", "concluido", { rodada_id: 1 }),
      ticket("I-300", 5, "implementar", "em_execucao", { rodada_id: 1 }),
    ]),
  );
  criarDemanda(banco, demanda("I-301", "aprovacao_planejamento", "d", [ticket("I-301", 1, "planejar", "em_execucao")]));
  const semear = (
    demanda_id: string,
    ticket_id: number,
    modo: Sessao["modo"],
    execucao: Partial<ExecucaoSessao> | null,
  ) => {
    const id = `s${String(ticket_id)}`;
    comSessoesDoTicket(banco, { demanda_id, ticket_id }, (e) => ({
      ...e,
      sessoes: [{ demanda_id, ticket_id, id: demanda_id === "I-301" ? "s301" : id, modo, conversa_referencia: id }],
      execucoes: execucao
        ? [
            {
              id: `e-${id}-${demanda_id}`,
              sessao_id: demanda_id === "I-301" ? "s301" : id,
              inicio: em,
              falha: false,
              ...execucao,
            },
          ]
        : [],
    }));
  };
  semear("I-300", 1, "interativo", { fim: "2026-01-01T01:00:00.000Z" });
  semear("I-300", 2, "autonomo", { fim: null, modelo_provedor: "anthropic", modelo_nome: "claude-teste" });
  semear("I-300", 3, "autonomo", { fim: "2026-01-01T02:00:00.000Z", falha: true });
  semear("I-300", 4, "autonomo", { fim: "2026-01-01T03:00:00.000Z" });
  semear("I-300", 5, "autonomo", { fim: "2026-01-01T04:00:00.000Z" });
  semear("I-301", 1, "interativo", { fim: "2026-01-01T05:00:00.000Z" });
  return { c, banco };
}

test("CA-2 a CA-6: o estado e o cabeçalho de cada sessão, com os endereços públicos", () => {
  const { banco } = cenario();
  const ler = (id: string) => {
    const cab = cabecalhoDaDemanda(banco, id);
    assert.ok(cab);
    return cab;
  };

  const planejar = ler("s1");
  assert.equal(planejar.origem, "demanda");
  assert.deepEqual(
    [planejar.demanda, planejar.rodada, planejar.ticket, planejar.etapa],
    ["I-300", undefined, "I-300.T1", "planejar"],
  );
  assert.deepEqual(
    [planejar.sessao.estado, planejar.sessao.motivo, planejar.sessao.desde, planejar.sessao.modelo],
    ["aguardando_humano", "conversa", "2026-01-01T01:00:00.000Z", undefined],
  );
  assert.equal(planejar.sessao.execucao, "e-s1-I-300");
  assert.equal(planejar.erro, undefined);

  const rodando = ler("s2");
  assert.deepEqual([rodando.demanda, rodando.rodada, rodando.ticket], ["I-300", "I-300.R1", "I-300.T2"]);
  assert.deepEqual(
    [rodando.sessao.estado, rodando.sessao.motivo, rodando.sessao.desde, rodando.sessao.modelo],
    ["rodando", undefined, em, { provedor: "anthropic", modelo: "claude-teste" }],
  );
  assert.deepEqual(
    rodando.execucoes.map((e) => e.id),
    ["e-s2-I-300"],
  );

  const falha = ler("s3");
  assert.deepEqual(
    [falha.sessao.estado, falha.sessao.motivo, falha.erro],
    ["aguardando_humano", "falha", "testes reprovaram"],
  );

  assert.equal(ler("s4").sessao.estado, "terminada");
  assert.deepEqual([ler("s5").sessao.estado, ler("s5").sessao.motivo], ["rodando", undefined]);
  assert.deepEqual([ler("s301").sessao.estado, ler("s301").sessao.motivo], ["aguardando_humano", "gate_demanda"]);
});

test("o diálogo pendente e o pi ocioso decidem o estado antes do ticket", () => {
  const { banco } = cenario();
  const carregada = (id: string): Carregada => {
    const ref = banco.prepare("SELECT demanda_id, ticket_id FROM sessao WHERE id = ?").get(id) as {
      demanda_id: string;
      ticket_id: number;
    };
    const ag = carregarDemanda(banco, ref.demanda_id);
    const { sessoes, execucoes } = carregarSessoesDoTicket(banco, ref);
    return {
      ag,
      ticket: encontrado(
        ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
        "sem ticket",
        "x",
      ),
      sessao: encontrado(sessoes[0], "sem sessão", "x"),
      execucoes,
    };
  };
  const viva = { execucao: "e", ocupado: true, desde: "2026-02-01T00:00:00.000Z", dialogos: [] };
  const dialogo = { type: "extension_ui_request", id: "d", em: "2026-02-02T00:00:00.000Z" };

  assert.deepEqual(calcular(carregada("s2"), { ...viva, dialogos: [dialogo] }), [
    "aguardando_humano",
    "dialogo",
    dialogo.em,
  ]);
  assert.deepEqual(calcular(carregada("s2"), viva), ["rodando", undefined, viva.desde]);
  // Interativa com a execução aberta e o pi esperando a próxima mensagem: conversa, não rodando.
  const aberta = carregada("s1");
  aberta.execucoes = aberta.execucoes.map((e) => ({ ...e, fim: null }));
  assert.deepEqual(calcular(aberta, { ...viva, ocupado: false }), ["aguardando_humano", "conversa", viva.desde]);
});

test("CA-7: sessão parada de demanda concluída, cancelada ou arquivada vale terminada, qualquer que seja o ticket", () => {
  const { banco } = cenario();
  const estadoDe = (id: string) => cabecalhoDaDemanda(banco, id)?.sessao.estado;
  for (const fase of ["concluida", "cancelada", "arquivada"]) {
    banco.prepare("UPDATE demanda SET fase = ? WHERE id = 'I-300'").run(fase);
    // Conversa de planejamento, ticket que falhou e autônoma parada: nenhuma espera mais o Auditor.
    assert.deepEqual(["s1", "s3", "s5"].map(estadoDe), ["terminada", "terminada", "terminada"], fase);
  }
  // A demanda aberta no gate do plano segue esperando o Auditor.
  assert.equal(estadoDe("s301"), "aguardando_humano");
});

test("CA-7 e CA-14: id que não é de sessão da demanda não dá nada", () => {
  const { banco } = cenario();
  assert.equal(cabecalhoDaDemanda(banco, "nao-existe"), undefined);
  assert.equal(abrirChatDemanda(banco, "nao-existe"), undefined);
  assert.equal(exportarHistoricoDemanda(banco, "nao-existe"), undefined);
});

/** Grava o JSONL da sessão `s1` (conversa de planejamento) e o prompt que a Fabriquinha montou na execução dela. */
function conversaDoPlanejamento(raiz: string): void {
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  mkdirSync(join(raiz, "execucoes", "E-e-s1-I-300"), { recursive: true });
  writeFileSync(join(raiz, "execucoes", "E-e-s1-I-300", "prompt.md"), "planeje a demanda");
  const linhas = [
    { type: "session", id: "s1" },
    mensagem("user", "planeje a demanda"),
    mensagem("assistant", "Qual a prioridade?", {
      provider: "anthropic",
      model: "claude-teste",
      content: [
        { type: "text", text: "Qual a prioridade?" },
        { type: "toolCall", name: "perguntar", arguments: { question: "Qual?" } },
      ],
    }),
    mensagem("user", "alta"),
  ];
  writeFileSync(
    join(raiz, "sessoes", "2026-01-01T00-00-00-000Z_s1.jsonl"),
    linhas.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

test("CA-1: a conversa do JSONL vem na ordem, com o prompt da Fabriquinha marcado, e o estado muda ao vivo", () => {
  const { banco, c } = cenario();
  assert.deepEqual(abrirChatDemanda(banco, "s1")?.conversa, []);
  conversaDoPlanejamento(c.raiz);

  const chat = abrirChatDemanda(banco, "s1");
  assert.ok(chat);
  assert.deepEqual(
    chat.conversa.map((e) => [e.type, e.fabriquinha]),
    [
      ["session", undefined],
      ["message", true],
      ["message", undefined],
      ["message", undefined],
    ],
  );
  const recebidos: Record<string, unknown>[] = [];
  const cancelar = chat.assinar((evento) => recebidos.push(evento));
  avisar("s1", join(c.raiz, "log"));
  cancelar();
  avisar("s1", join(c.raiz, "log"));
  assert.equal(recebidos.length, 1);
  assert.deepEqual(
    [recebidos[0]?.type, recebidos[0]?.ticket, (recebidos[0]?.sessao as { estado: string }).estado],
    ["estado", "I-300.T1", "aguardando_humano"],
  );
});

test("CA-13: o histórico em Markdown segue a ordem da conversa, com o nome do ticket", () => {
  const { banco, c } = cenario();
  conversaDoPlanejamento(c.raiz);
  // A retomada pela mensagem do Auditor: o prompt dela é o texto dele, que segue "Auditor" no histórico.
  comSessoesDoTicket(banco, { demanda_id: "I-300", ticket_id: 1 }, (e) => ({
    ...e,
    execucoes: [
      ...e.execucoes,
      { id: "e-retomada", sessao_id: "s1", inicio: em, fim: "2026-01-01T06:00:00.000Z", falha: false },
    ],
  }));
  mkdirSync(join(c.raiz, "execucoes", "E-e-retomada"), { recursive: true });
  writeFileSync(join(c.raiz, "execucoes", "E-e-retomada", "prompt.md"), "alta");

  const planejar = exportarHistoricoDemanda(banco, "s1");
  assert.equal(planejar?.nome, "historico-I-300.T1.md");
  const md = planejar.markdown;
  const ordem = ["## Fabriquinha", "## Agente", "**Chamada de `perguntar`**", "## Auditor"].map((t) => md.indexOf(t));
  assert.deepEqual(
    ordem,
    ordem.toSorted((a, b) => a - b),
  );
  assert.ok(ordem.every((i) => i > 0));
  assert.match(md, /^# Histórico da sessão I-300.T1 \(planejar\)/);
  assert.match(md, /- Modelo: anthropic\/claude-teste/);
  assert.match(md, /- Ticket: I-300.T1 — planejar/);
  assert.doesNotMatch(md, /- Rodada:/);
  assert.match(md, /- Fim: 2026-01-01T06:00:00.000Z/);
  assert.doesNotMatch(md, /## Fabriquinha\n\nalta/);

  const rodada = exportarHistoricoDemanda(banco, "s2");
  assert.equal(rodada?.nome, "historico-I-300.T2.md");
  assert.match(
    rodada.markdown,
    /- Rodada: I-300.R1\n- Ticket: I-300.T2 — implementa[\s\S]*- Modelo: —[\s\S]*- Fim: em andamento/,
  );
});

async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condicao(); i++) await dormir(20);
  assert.ok(condicao(), "a condição não se cumpriu a tempo");
}

test("CA-3 e CA-15: o planejamento com o pi falso pergunta, o chat mostra o diálogo e as mensagens ao vivo", async () => {
  const { banco } = cenario();
  criarDemanda(
    banco,
    demanda("I-302", "planejamento", "pergunte perguntar", [ticket("I-302", 1, "planejar", "em_execucao")]),
  );
  const ref = { demanda_id: "I-302", ticket_id: 1 };
  const { id, fim } = iniciarExecucaoDemanda(banco, ref, {
    limiteMin: 5,
    modo: "interativo",
    fechar: () => Promise.resolve(),
  });
  const sessao = String(carregarSessoesDoTicket(banco, ref).sessoes[0]?.id);
  const ao_vivo: Record<string, unknown>[] = [];
  const chat = abrirChatDemanda(banco, sessao);
  assert.equal(chat?.cabecalho.sessao.estado, "rodando");
  const cancelar = chat.assinar((e) => ao_vivo.push(e));

  await ate(() => situacao(sessao)?.dialogos.length === 1);
  const cab = cabecalhoDaDemanda(banco, sessao);
  assert.deepEqual(
    [cab?.sessao.estado, cab?.sessao.motivo, cab?.sessao.dialogos[0]?.type],
    ["aguardando_humano", "dialogo", "extension_ui_request"],
  );
  assert.equal(cab?.sessao.execucao, id);
  const fimDeMensagem = ao_vivo.filter((e) => e.type === "message_end");
  assert.ok(fimDeMensagem.some((e) => (e.message as { role: string }).role === "assistant"));
  assert.ok(
    fimDeMensagem.some((e) => e.fabriquinha === true),
    "o prompt da Fabriquinha chega marcado",
  );
  assert.ok(
    ao_vivo.some((e) => e.type === "tool_execution_start"),
    "os demais eventos passam como vieram",
  );

  cancelar();
  interromperExecucaoDemanda(banco, ref);
  await fim;
  const parada = cabecalhoDaDemanda(banco, sessao);
  assert.equal(parada?.sessao.estado, "aguardando_humano");
  assert.equal(parada.sessao.motivo, "conversa");
});

test("CA-8, CA-10, CA-11 e CA-12: responder o diálogo, enviar na conversa e abortar", async () => {
  const { banco } = cenario();
  criarDemanda(
    banco,
    demanda("I-303", "planejamento", "pergunte perguntar", [ticket("I-303", 1, "planejar", "em_execucao")]),
  );
  const ref = { demanda_id: "I-303", ticket_id: 1 };
  const { fim } = iniciarExecucaoDemanda(banco, ref, {
    limiteMin: 5,
    modo: "interativo",
    fechar: () => Promise.resolve(),
  });
  const sessao = String(carregarSessoesDoTicket(banco, ref).sessoes[0]?.id);

  await ate(() => situacao(sessao)?.dialogos.length === 1);
  assert.throws(
    () => enviarDemanda(banco, sessao, "oi", "prompt", 5),
    /aguardando_humano: dialogo e não recebe prompt/,
  );
  const dialogo = String(situacao(sessao)?.dialogos[0]?.id);
  assert.equal(responderDialogoDemanda(banco, sessao, dialogo, { value: "alta" }), true);
  await ate(() => situacao(sessao)?.dialogos.length === 0 && situacao(sessao)?.ocupado === false);

  // Conversa com o pi vivo ocioso: a mensagem vai ao mesmo pi, sem nova execução.
  assert.throws(() => enviarDemanda(banco, sessao, "oi", "steer", 5), /não recebe steer.*envie com prompt/);
  // O pi vivo recebe a mensagem sem nova execução e volta a perguntar; o aborto vai a ele.
  assert.equal(enviarDemanda(banco, sessao, "pergunte perguntar de novo", "prompt", 5), true);
  assert.equal(carregarSessoesDoTicket(banco, ref).execucoes.length, 1);
  await ate(() => situacao(sessao)?.dialogos.length === 1);
  assert.equal(abortarDemanda(banco, sessao), true);
  await ate(() => situacao(sessao)?.dialogos.length === 0 && situacao(sessao)?.ocupado === false);
  assert.notEqual(cabecalhoDaDemanda(banco, sessao)?.sessao.estado, "rodando");
  interromperExecucaoDemanda(banco, ref);
  await fim;

  // Sem pi e sem execução aberta: o prompt é a mensagem e a mesma sessão é retomada.
  assert.equal(enviarDemanda(banco, sessao, "retoma", "prompt", 5), true);
  const execucoes = carregarSessoesDoTicket(banco, ref).execucoes;
  assert.equal(execucoes.length, 2);
  assert.equal(execucoes.at(-1)?.sessao_id, sessao);
  await ate(() => situacao(sessao)?.ocupado === false);
  interromperExecucaoDemanda(banco, ref);
  await ate(() => carregarSessoesDoTicket(banco, ref).execucoes.at(-1)?.fim != null);
});

test("CA-12: abortar sem execução em andamento avisa; órfã é interrompida; outros estados recusam o envio", () => {
  const { banco } = cenario();
  assert.throws(() => abortarDemanda(banco, "s4"), /não há execução para abortar/);
  // Execução aberta sem pi (serviço reiniciado): interrompe e falha o ticket.
  assert.throws(() => enviarDemanda(banco, "s2", "x", "steer", 5), /não tem pi rodando/);
  assert.equal(abortarDemanda(banco, "s2"), true);
  assert.equal(cabecalhoDaDemanda(banco, "s2")?.sessao.motivo, "falha");
  assert.throws(() => enviarDemanda(banco, "s3", "x", "prompt", 5), /falha e não recebe prompt/);
  assert.throws(() => enviarDemanda(banco, "s4", "x", "prompt", 5), /terminada e não recebe prompt/);
  assert.throws(() => enviarDemanda(banco, "s301", "x", "prompt", 5), /gate_demanda/);
  assert.throws(() => responderDialogoDemanda(banco, "s4", "d", { value: "x" }), /não tem pi rodando/);
  for (const f of [
    () => enviarDemanda(banco, "nao-existe", "x", "prompt", 5),
    () => responderDialogoDemanda(banco, "nao-existe", "d", { value: "x" }),
    () => abortarDemanda(banco, "nao-existe"),
  ]) {
    assert.equal(f(), false);
  }
});
