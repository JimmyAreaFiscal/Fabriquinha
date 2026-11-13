// Leitura das sessões dos tickets da demanda no chat (I-239, CA-1 a CA-7, CA-13 e CA-14) com banco real; o fluxo ao vivo
// e o diálogo vêm do pi falso único.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco/banco_temporario.ts";
import { instalarPiFalso } from "../../../../apoio-testes/falsos/pi_falso.ts";
import { setTimeout as dormir } from "node:timers/promises";
import {
  Endereco,
  condutor,
  enviarDemanda,
  montarPromptDemanda,
  type AgregadoDemanda,
  carregarDemanda,
  interromperExecucaoDemanda,
  iniciarExecucaoDemanda,
  estadoEDesdeDaSessao,
  type SessaoDoTicket,
  abortarDemanda,
  responderDialogoDemanda,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import {
  type Execucao,
  type Sessao,
  carregarSessoesDoContexto,
  comSessoesDoContexto,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  emMarkdown,
} from "../../../modulos/sessoes/publico.ts";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import { registrarProjeto } from "../../../modulos/demandas/publico.ts";
import { gravarAgregadoPronto } from "../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { criarRepositorioDeTeste } from "../../../../apoio-testes/repositorio_de_teste.ts";
import { abrirChatDemanda, exportarHistoricoDemanda } from "./chat.ts";

/** O cabeçalho da sessão, como o chat o abre; `undefined` se o id não é de uma sessão da demanda. */
const cabecalhoDaSessao = (banco: DatabaseSync, id: string) => abrirChatDemanda(banco, id)?.cabecalho;

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-sessoes-demanda-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
instalarPiFalso(temporario).roteirizar([{ marcas: true }]);
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
  estado: status,
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});

const demanda = (id: string, estado: string, descricao: string, tickets: object[]): AgregadoDemanda =>
  ({
    demanda: {
      id,
      projeto: "loja",
      titulo: `demanda ${id}`,
      tipo: "funcionalidade",
      descricao,
      estado,
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: id },
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    tickets,
    tentativas:
      id === "I-300"
        ? [
            {
              ticket: Endereco.doTicket(id, 3),
              numero: 1,
              processo_id: "e-s3-I-300",
              inicio: em,
              fim: "2026-01-01T02:00:00.000Z",
              resultado: { tipo: "reprovacao", motivo: "testes reprovaram" },
            },
          ]
        : [],
    rodadas: [
      {
        demanda_id: id,
        rodada_id: 1,
        titulo: "r1",
        estado: "implementar",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
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
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
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
  gravarAgregadoPronto(
    banco,
    demanda("I-300", "planejar", "d", [
      ticket("I-300", 1, "planejar", "em_execucao"),
      ticket("I-300", 2, "implementar", "em_execucao", { rodada_id: 1, titulo: "implementa" }),
      ticket("I-300", 3, "implementar", "falhou", { rodada_id: 1 }),
      ticket("I-300", 4, "implementar", "concluido", { rodada_id: 1 }),
      ticket("I-300", 5, "implementar", "em_execucao", { rodada_id: 1 }),
    ]),
  );
  gravarAgregadoPronto(
    banco,
    demanda("I-301", "gate_planejamento", "d", [ticket("I-301", 1, "planejar", "em_execucao")]),
  );
  const semear = (demanda_id: string, ticket_id: number, modo: Sessao["modo"], execucao: Partial<Execucao> | null) => {
    const id = `s${String(ticket_id)}`;
    comSessoesDoContexto(banco, { demanda_id, ticket_id }, (e) => ({
      ...e,
      sessoes: [{ demanda_id, ticket_id, id: demanda_id === "I-301" ? "s301" : id, modo, conversa_referencia: id }],
      execucoes: execucao
        ? [
            {
              id: `e-${id}-${demanda_id}`,
              trabalho_id: demanda_id === "I-301" ? "s301" : id,
              inicio: em,
              falha: false,
              ...execucao,
            },
          ]
        : [],
    }));
  };
  semear("I-300", 1, "interativo", { fim: "2026-01-01T01:00:00.000Z" });
  semear("I-300", 2, "autonomo", {
    fim: null,
    configuracao_agente: { modelo: { provedor: "anthropic", nome: "claude-teste" } },
  });
  semear("I-300", 3, "autonomo", { fim: "2026-01-01T02:00:00.000Z", falha: true });
  semear("I-300", 4, "autonomo", { fim: "2026-01-01T03:00:00.000Z" });
  semear("I-300", 5, "autonomo", { fim: "2026-01-01T04:00:00.000Z" });
  semear("I-301", 1, "interativo", { fim: "2026-01-01T05:00:00.000Z" });
  return { c, banco };
}

test("CA-2 a CA-6: o estado e o cabeçalho de cada sessão, com os endereços públicos", () => {
  const { banco } = cenario();
  const ler = (id: string) => {
    const cab = cabecalhoDaSessao(banco, id);
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
    [planejar.sessao.estado, planejar.sessao.pendencia?.tipo, planejar.sessao.desde, planejar.sessao.modelo],
    ["aguardando_humano", "dialogo_do_agente", "2026-01-01T01:00:00.000Z", undefined],
  );
  assert.equal(planejar.sessao.execucao, "e-s1-I-300");
  assert.equal(planejar.erro, undefined);

  const rodando = ler("s2");
  assert.deepEqual([rodando.demanda, rodando.rodada, rodando.ticket], ["I-300", "I-300.R1", "I-300.T2"]);
  assert.deepEqual(
    [rodando.sessao.estado, rodando.sessao.pendencia, rodando.sessao.desde, rodando.sessao.modelo],
    ["rodando", undefined, em, { provedor: "anthropic", nome: "claude-teste" }],
  );
  assert.deepEqual(
    rodando.execucoes.map((e) => e.id),
    ["e-s2-I-300"],
  );

  const falha = ler("s3");
  assert.deepEqual(
    [falha.sessao.estado, falha.sessao.pendencia?.tipo, falha.erro],
    ["aguardando_humano", "item_bloqueado", "testes reprovaram"],
  );

  assert.equal(ler("s4").sessao.estado, "terminada");
  assert.deepEqual([ler("s5").sessao.estado, ler("s5").sessao.pendencia], ["rodando", undefined]);
  assert.deepEqual(
    [ler("s301").sessao.estado, ler("s301").sessao.pendencia?.tipo],
    ["aguardando_humano", "gate_humano"],
  );
});

test("o diálogo pendente e o pi ocioso decidem o estado antes do ticket", () => {
  const { banco } = cenario();
  const carregada = (id: string): SessaoDoTicket => {
    const ref = banco.prepare("SELECT demanda_id, ticket_id FROM trabalho_agentico WHERE id = ?").get(id) as {
      demanda_id: string;
      ticket_id: number;
    };
    const ag = carregarDemanda(banco, ref.demanda_id);
    const { sessoes, execucoes } = carregarSessoesDoContexto(banco, ref);
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
  const dialogo = { type: "extension_ui_request" as const, id: "d", method: "select", em: "2026-02-02T00:00:00.000Z" };

  assert.deepEqual(estadoEDesdeDaSessao(carregada("s2"), { ...viva, dialogos: [dialogo] }), [
    "aguardando_humano",
    dialogo.em,
  ]);
  assert.deepEqual(estadoEDesdeDaSessao(carregada("s2"), viva), ["rodando", viva.desde]);
  // Interativa com a execução aberta e o pi esperando a próxima mensagem: conversa, não rodando.
  const aberta = carregada("s1");
  aberta.execucoes = aberta.execucoes.map((e) => ({ ...e, fim: null }));
  assert.deepEqual(estadoEDesdeDaSessao(aberta, { ...viva, ocupado: false }), ["aguardando_humano", viva.desde]);
});

test("I-275: o gate do planejamento é a Pendência do planejamento, não a do gate da demanda", () => {
  const { banco } = cenario();
  const { sessao, pendencias } = encontrado(abrirChatDemanda(banco, "s301"), "sem chat", "x").cabecalho;
  assert.deepEqual(
    [sessao.pendencia?.tipo, sessao.pendencia?.item, sessao.pendencia?.motivo],
    ["gate_humano", "I-301", "Aprovação do planejamento aguarda decisão"],
  );
  assert.deepEqual(
    pendencias.map((p) => [p.tipo, p.item]),
    [["gate_humano", "I-301"]],
  );
});

test("o cabeçalho leva as Pendências da demanda inteira: o ticket bloqueado e a conversa", () => {
  const { banco } = cenario();
  const { pendencias } = encontrado(abrirChatDemanda(banco, "s1"), "sem chat", "x").cabecalho;
  assert.deepEqual(
    pendencias.map((p) => [p.tipo, p.item]),
    [
      ["item_bloqueado", "I-300.T3"],
      ["dialogo_do_agente", "I-300.T1"],
    ],
  );
});

test("CA-7: sessão parada de demanda concluída, cancelada ou arquivada vale terminada, qualquer que seja o ticket", () => {
  const { banco } = cenario();
  const estadoDe = (id: string) => cabecalhoDaSessao(banco, id)?.sessao.estado;
  for (const estado of ["concluida", "cancelada", "arquivada"]) {
    banco.prepare("UPDATE processo_demanda SET estado = ? WHERE demanda_id = 'I-300'").run(estado);
    // Conversa de planejamento, ticket que falhou e autônoma parada: nenhuma espera mais o Auditor.
    assert.deepEqual(["s1", "s3", "s5"].map(estadoDe), ["terminada", "terminada", "terminada"], estado);
  }
  // A demanda aberta no gate do plano segue esperando o Auditor.
  assert.equal(estadoDe("s301"), "aguardando_humano");
});

test("CA-7 e CA-14: id que não é de sessão da demanda não dá nada", () => {
  const { banco } = cenario();
  assert.equal(cabecalhoDaSessao(banco, "nao-existe"), undefined);
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
  const cancelar = chat.assinar((evento) => recebidos.push({ ...evento }));
  condutor.avisar("s1", join(c.raiz, "log"));
  cancelar();
  condutor.avisar("s1", join(c.raiz, "log"));
  assert.equal(recebidos.length, 1);
  assert.deepEqual(
    [recebidos[0]?.type, recebidos[0]?.ticket, (recebidos[0]?.sessao as { estado: string }).estado],
    ["estado", "I-300.T1", "aguardando_humano"],
  );
});

test("I-266.T7: a resposta de `perguntar` que o Auditor automático deu é do Agente da execução; a do humano, do Auditor", () => {
  const { banco, c } = cenario();
  conversaDoPlanejamento(c.raiz);
  const agente = { tipo: "agente", trabalho_id: "e-s1-I-300" };
  const registro = { ator: agente, chamada: "auto", pergunta: "Corrijo o Sonar?", resposta: "Sim", justificativa: "j" };
  writeFileSync(
    join(c.raiz, "execucoes", "E-e-s1-I-300", "log"),
    `2026-01-01T00:00:00.000Z pi\n2026-01-01T00:00:01.000Z ${PREFIXO_DA_RESPOSTA_AUTOMATICA}${JSON.stringify(registro)}\n`,
  );
  const resposta = (toolCallId: string) =>
    mensagem("toolResult", "User answered: Sim", { toolCallId, toolName: "perguntar" });
  writeFileSync(
    join(c.raiz, "sessoes", "2026-01-01T00-00-00-000Z_s1.jsonl"),
    [resposta("auto"), resposta("humana"), mensagem("toolResult", "ok", { toolName: "bash" })]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  assert.deepEqual(
    abrirChatDemanda(banco, "s1")?.conversa.map((e) => e.ator),
    [agente, { tipo: "auditor" }, undefined],
  );
});

test("I-266.T29: as linhas livres do condutor que citam o prefixo da resposta automática não quebram o chat", () => {
  const { banco, c } = cenario();
  conversaDoPlanejamento(c.raiz);
  const agente = { tipo: "agente", trabalho_id: "e-s1-I-300" };
  const pergunta = `Mudo a ${PREFIXO_DA_RESPOSTA_AUTOMATICA}do condutor?`;
  const registro = { ator: agente, chamada: "auto", pergunta, resposta: "Sim", justificativa: "j" };
  const semAtor = { ator: { tipo: "invalido" }, chamada: "humana", pergunta, resposta: "Não", justificativa: "j" };
  const em = "2026-01-01T00:00:00.000Z";
  writeFileSync(
    join(c.raiz, "execucoes", "E-e-s1-I-300", "log"),
    [
      `${em} Auditor automático escalou ao Auditor: ${pergunta}`,
      `${em} Auditor automático respondeu "Sim" a "${pergunta}": j`,
      `${em} ${PREFIXO_DA_RESPOSTA_AUTOMATICA}${JSON.stringify(registro)}`,
      `${em} ${PREFIXO_DA_RESPOSTA_AUTOMATICA}${JSON.stringify(semAtor)}`,
    ].join("\n") + "\n",
  );
  const resposta = (toolCallId: string) =>
    mensagem("toolResult", "User answered: Sim", { toolCallId, toolName: "perguntar" });
  writeFileSync(
    join(c.raiz, "sessoes", "2026-01-01T00-00-00-000Z_s1.jsonl"),
    [resposta("auto"), resposta("humana")].map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  assert.deepEqual(
    abrirChatDemanda(banco, "s1")?.conversa.map((e) => e.ator),
    [agente, { tipo: "auditor" }],
  );
});

test("CA-13: o histórico em Markdown segue a ordem da conversa, com o nome do ticket", () => {
  const { banco, c } = cenario();
  conversaDoPlanejamento(c.raiz);
  // A retomada pela mensagem do Auditor: o prompt dela é o texto dele, que segue "Auditor" no histórico.
  comSessoesDoContexto(banco, { demanda_id: "I-300", ticket_id: 1 }, (e) => ({
    ...e,
    execucoes: [
      ...e.execucoes,
      { id: "e-retomada", trabalho_id: "s1", inicio: em, fim: "2026-01-01T06:00:00.000Z", falha: false },
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
  gravarAgregadoPronto(
    banco,
    demanda("I-302", "planejar", "pergunte perguntar", [ticket("I-302", 1, "planejar", "em_execucao")]),
  );
  const ref = { demanda_id: "I-302", ticket_id: 1 };
  const { id, fim } = iniciarExecucaoDemanda(banco, ref, {
    montarPrompt: montarPromptDemanda,
    limiteMin: 5,
    modo: "interativo",
    fechar: () => Promise.resolve(),
  });
  const sessao = String(carregarSessoesDoContexto(banco, ref).sessoes[0]?.id);
  const ao_vivo: Record<string, unknown>[] = [];
  const chat = abrirChatDemanda(banco, sessao);
  assert.equal(chat?.cabecalho.sessao.estado, "rodando");
  const cancelar = chat.assinar((e) => ao_vivo.push({ ...e }));

  await ate(() => condutor.situacao(sessao)?.dialogos.length === 1);
  const cab = cabecalhoDaSessao(banco, sessao);
  assert.deepEqual(
    [cab?.sessao.estado, cab?.sessao.pendencia?.tipo, cab?.sessao.dialogos[0]?.type],
    ["aguardando_humano", "dialogo_do_agente", "extension_ui_request"],
  );
  assert.match(String(cab?.sessao.pendencia?.motivo), /^O agente pergunta: /);
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
  const parada = cabecalhoDaSessao(banco, sessao);
  assert.equal(parada?.sessao.estado, "aguardando_humano");
  assert.deepEqual(
    [parada.sessao.pendencia?.tipo, parada.sessao.pendencia?.motivo],
    ["dialogo_do_agente", "A conversa da sessão aguarda o Auditor"],
  );
});

test("CA-8, CA-10, CA-11 e CA-12: responder o diálogo, enviar na conversa e abortar", async () => {
  const { banco } = cenario();
  gravarAgregadoPronto(
    banco,
    demanda("I-303", "planejar", "pergunte perguntar", [ticket("I-303", 1, "planejar", "em_execucao")]),
  );
  const ref = { demanda_id: "I-303", ticket_id: 1 };
  const { fim } = iniciarExecucaoDemanda(banco, ref, {
    montarPrompt: montarPromptDemanda,
    limiteMin: 5,
    modo: "interativo",
    fechar: () => Promise.resolve(),
  });
  const sessao = String(carregarSessoesDoContexto(banco, ref).sessoes[0]?.id);

  await ate(() => condutor.situacao(sessao)?.dialogos.length === 1);
  assert.throws(
    () => enviarDemanda(banco, sessao, "oi", "prompt", 5),
    /aguardando_humano: dialogo_do_agente e não recebe prompt/,
  );
  const dialogo = String(condutor.situacao(sessao)?.dialogos[0]?.id);
  assert.equal(responderDialogoDemanda(banco, sessao, dialogo, { value: "alta" }), true);
  await ate(() => condutor.situacao(sessao)?.dialogos.length === 0 && condutor.situacao(sessao)?.ocupado === false);

  // Conversa com o pi vivo ocioso: a mensagem vai ao mesmo pi, sem nova execução.
  assert.throws(() => enviarDemanda(banco, sessao, "oi", "steer", 5), /não recebe steer.*envie com prompt/);
  // O pi vivo recebe a mensagem sem nova execução e volta a perguntar; o aborto vai a ele.
  assert.equal(enviarDemanda(banco, sessao, "pergunte perguntar de novo", "prompt", 5), true);
  assert.equal(carregarSessoesDoContexto(banco, ref).execucoes.length, 1);
  await ate(() => condutor.situacao(sessao)?.dialogos.length === 1);
  assert.equal(abortarDemanda(banco, sessao), true);
  await ate(() => condutor.situacao(sessao)?.dialogos.length === 0 && condutor.situacao(sessao)?.ocupado === false);
  assert.notEqual(cabecalhoDaSessao(banco, sessao)?.sessao.estado, "rodando");
  interromperExecucaoDemanda(banco, ref);
  await fim;

  // Sem pi e sem execução aberta: o prompt é a mensagem e a mesma sessão é retomada.
  assert.equal(enviarDemanda(banco, sessao, "retoma", "prompt", 5), true);
  const execucoes = carregarSessoesDoContexto(banco, ref).execucoes;
  assert.equal(execucoes.length, 2);
  assert.equal(execucoes.at(-1)?.trabalho_id, sessao);
  await ate(() => condutor.situacao(sessao)?.ocupado === false);
  interromperExecucaoDemanda(banco, ref);
  await ate(() => carregarSessoesDoContexto(banco, ref).execucoes.at(-1)?.fim != null);
});

test("sessão autônoma trabalhando recebe steer e follow_up sem abrir outra execução", async () => {
  const { banco } = cenario();
  instalarPiFalso(temporario).roteirizar([{ termina: "nunca" }]);
  gravarAgregadoPronto(
    banco,
    demanda("I-304", "planejar", "trabalhe", [ticket("I-304", 1, "planejar", "em_execucao")]),
  );
  const execucao = iniciarExecucaoDemanda(
    banco,
    { demanda_id: "I-304", ticket_id: 1 },
    { montarPrompt: montarPromptDemanda, limiteMin: 1 },
  );
  const sessaoDoTicket = carregarSessoesDoContexto(banco, { demanda_id: "I-304", ticket_id: 1 }).sessoes.at(-1);
  assert.ok(sessaoDoTicket);
  const sessao = sessaoDoTicket.id;
  await ate(() => condutor.situacao(sessao)?.ocupado === true);
  assert.equal(enviarDemanda(banco, sessao, "ajuste o teste", "steer", 1), true);
  assert.equal(enviarDemanda(banco, sessao, "confira o lint", "follow_up", 1), true);
  condutor.encerrar(execucao.id);
  await execucao.fim;
  instalarPiFalso(temporario).roteirizar([{ marcas: true }]);
});

test("CA-12: abortar sem execução em andamento avisa; órfã é interrompida; outros estados recusam o envio", () => {
  const { banco } = cenario();
  assert.throws(() => abortarDemanda(banco, "s4"), /não há execução para abortar/);
  // Execução aberta sem pi (serviço reiniciado): interrompe e falha o ticket.
  assert.throws(() => enviarDemanda(banco, "s2", "x", "steer", 5), /não tem pi rodando/);
  assert.equal(abortarDemanda(banco, "s2"), true);
  assert.equal(cabecalhoDaSessao(banco, "s2")?.sessao.pendencia?.tipo, "item_bloqueado");
  assert.throws(
    () => enviarDemanda(banco, "s3", "x", "prompt", 5),
    /aguardando_humano: item_bloqueado e não recebe prompt/,
  );
  assert.throws(() => enviarDemanda(banco, "s4", "x", "prompt", 5), /terminada e não recebe prompt/);
  assert.throws(
    () => enviarDemanda(banco, "s301", "x", "prompt", 5),
    /aguardando_humano: gate_humano e não recebe prompt/,
  );
  assert.throws(() => responderDialogoDemanda(banco, "s4", "d", { value: "x" }), /não tem pi rodando/);
  for (const f of [
    () => enviarDemanda(banco, "nao-existe", "x", "prompt", 5),
    () => responderDialogoDemanda(banco, "nao-existe", "d", { value: "x" }),
    () => abortarDemanda(banco, "nao-existe"),
  ]) {
    assert.equal(f(), false);
  }
});

test("emMarkdown: Fabriquinha, Auditor e agente na íntegra; a chamada com os argumentos e o resultado cortado em 2.000", () => {
  const nada = new Set<string>();
  assert.deepEqual(emMarkdown({ role: "user", content: "# Prompt" }, new Set(["# Prompt"])), [
    "## Fabriquinha\n\n# Prompt",
  ]);
  assert.deepEqual(emMarkdown({ role: "user", content: [{ type: "text", text: "oi" }] }, nada), ["## Auditor\n\noi"]);
  const longo = `\`\`\`\n${"y".repeat(2100)}`;
  const [cortado = ""] = emMarkdown(
    { role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: longo }] },
    nada,
  );
  assert.match(cortado, /^\*\*Resultado de `bash` \(erro\)\*\*\n\n````\n```\n/);
  assert.match(cortado, /\n… \(cortado em 2000 de 2104 caracteres\)\n````$/);
  assert.deepEqual(emMarkdown({ role: "toolResult", toolName: "ls", content: "a" }, nada), [
    "**Resultado de `ls`**\n\n```\na\n```",
  ]);
  const agente = {
    role: "assistant",
    content: [
      { type: "text", text: "Vou ler." },
      { type: "toolCall", name: "read", arguments: { path: "a" } },
      { type: "toolCall", name: "ls" },
    ],
  };
  assert.deepEqual(emMarkdown(agente, nada), [
    "## Agente\n\nVou ler.",
    '**Chamada de `read`**\n\n```json\n{\n  "path": "a"\n}\n```',
    "**Chamada de `ls`**\n\n```json\n{}\n```",
  ]);
  assert.deepEqual(emMarkdown({ role: "bashExecution", content: "x" }, nada), []);
});

const chamada = (id: string, name: string, args?: object) => ({ type: "toolCall", id, name, arguments: args });
const resultado = (toolCallId: string, texto: string) => mensagem("toolResult", texto, { toolCallId });

test("perguntasRespondidasNaSessao: casa a pergunta com a resposta, sem cancelamento, vazio nem outras ferramentas", () => {
  const { c } = cenario();
  mkdirSync(join(c.raiz, "sessoes"), { recursive: true });
  const linhas = [
    { type: "session", id: "s2" },
    mensagem("assistant", "", {
      content: [
        chamada("a", "perguntar", { question: "Como confiro o Sonar?" }),
        chamada("b", "perguntar", { question: "Qual o escopo?" }),
        chamada("c", "perguntar", { question: "Cancelada?" }),
        chamada("d", "perguntar", { question: "Vazia?" }),
        chamada("e", "perguntar"),
        chamada("m", "perguntar", { question: "Quais critérios?" }),
        chamada("v", "perguntar", { question: "Seleção vazia?" }),
        chamada("f", "bash", { question: "outra ferramenta" }),
        { type: "toolCall", name: "perguntar", arguments: { question: "sem id" } },
      ],
    }),
    resultado("a", "User answered: fica com o Auditor no gate do PR"),
    resultado("b", "User selected: só o servidor"),
    resultado("c", "User cancelled the question"),
    resultado(
      "m",
      "User selected:\n- 1. Maior desconto primeiro\n- 2. Validade mais próxima\n- Other: e desempate pelo código",
    ),
    resultado("v", "User selected:\n"),
    resultado("d", "User answered:  "),
    resultado("e", "User answered: sem pergunta"),
    resultado("f", "User answered: não é perguntar"),
    resultado("zzz", "User answered: sem chamada"),
    mensagem("user", "User answered: mensagem comum"),
    { type: "session_info" },
  ];
  writeFileSync(
    join(c.raiz, "sessoes", "2026-01-01T00-00-00-000Z_s2.jsonl"),
    linhas.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  assert.deepEqual(condutor.perguntasRespondidasNaSessao(c.raiz, "s2"), [
    { pergunta: "Como confiro o Sonar?", resposta: "fica com o Auditor no gate do PR" },
    { pergunta: "Qual o escopo?", resposta: "só o servidor" },
    {
      pergunta: "Quais critérios?",
      resposta: "- 1. Maior desconto primeiro\n- 2. Validade mais próxima\n- Other: e desempate pelo código",
    },
  ]);
});

test("perguntasRespondidasNaSessao: ignora linha null e mensagem sem content, mantendo os pares válidos", () => {
  const { c } = cenario();
  mkdirSync(join(c.raiz, "sessoes"), { recursive: true });
  const linhas = [
    "null",
    { type: "message", message: { role: "assistant" } },
    mensagem("assistant", "", { content: [chamada("a", "perguntar", { question: "Como confiro o Sonar?" })] }),
    { type: "message", message: { role: "toolResult", toolCallId: "a" } },
    resultado("a", "User answered: fica com o Auditor"),
  ];
  writeFileSync(
    join(c.raiz, "sessoes", "2026-01-01T00-00-00-000Z_s3.jsonl"),
    linhas.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n",
  );
  assert.deepEqual(condutor.perguntasRespondidasNaSessao(c.raiz, "s3"), [
    { pergunta: "Como confiro o Sonar?", resposta: "fica com o Auditor" },
  ]);
});

test("perguntasRespondidasNaSessao: ignora bloco que não é objeto, mantendo os pares válidos", () => {
  const { c } = cenario();
  mkdirSync(join(c.raiz, "sessoes"), { recursive: true });
  const linhas = [
    mensagem("assistant", "", {
      content: [null, 7, "solto", chamada("a", "perguntar", { question: "Como confiro o Sonar?" })],
    }),
    mensagem("assistant", "", { content: [null] }),
    { type: "message", message: { role: "toolResult", toolCallId: "x", content: [null] } },
    { type: "message", message: { role: "user", content: "texto simples" } },
    mensagem("toolResult", "", {
      toolCallId: "a",
      content: [null, { type: "text", text: "User answered: fica com o Auditor" }],
    }),
  ];
  writeFileSync(
    join(c.raiz, "sessoes", "2026-01-01T00-00-00-000Z_s4.jsonl"),
    linhas.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  assert.deepEqual(condutor.perguntasRespondidasNaSessao(c.raiz, "s4"), [
    { pergunta: "Como confiro o Sonar?", resposta: "fica com o Auditor" },
  ]);
});

test("perguntasRespondidasNaSessao: sessão sem arquivo não tem perguntas", () => {
  const { c } = cenario();
  assert.deepEqual(condutor.perguntasRespondidasNaSessao(c.raiz, "s-sem-arquivo"), []);
});
