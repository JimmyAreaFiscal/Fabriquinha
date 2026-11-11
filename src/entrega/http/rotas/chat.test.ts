// Rotas do chat (F7 §4.2) contra o serviço de verdade, numa raiz temporária e numa porta livre, com git real e o pi
// falso único: a sessão de ticket da demanda com o SSE, as mensagens, os diálogos, o aborto e o histórico; a sessão
// que não é de uma demanda dá 404.
import { Endereco } from "../../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { condutor } from "../../../execucao/aplicacao/trabalho/condutor.ts";
import { iniciarServico, type Servico } from "../../../composicao/servico.ts";
import { DadosDoChatDemanda } from "../../contrato/chat.ts";
import { gravarAgregadoPronto, montarAgregadoDemanda } from "../../../../apoio-testes/cenarios_de_demanda.ts";
import { gravarConfiguracaoSdlc } from "../../../ambiente/aplicacao/projeto/cadastro.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "../../../execucao/aplicacao/execucao_demanda.ts";
import { carregarTrabalhosDoTicket, comTrabalhosDoTicket } from "../../../execucao/armazenamento/trabalho_agentico.ts";
import { registrarProjeto } from "../../../ambiente/aplicacao/projeto/cadastro.ts";
import { instalarPiFalso } from "../../../../apoio-testes/pi_falso.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-chat-")));
const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");
instalarPiFalso(base).roteirizar([{ marcas: true }]);

let servico: Servico;
let origem: string;
const raiz = join(base, "raiz");

before(async () => {
  const livre = createServer().listen(0, "127.0.0.1");
  await once(livre, "listening");
  process.env.FABRIQUINHA_PORTA = String((livre.address() as { port: number }).port);
  livre.close();
  await once(livre, "close");
  origem = `http://127.0.0.1:${process.env.FABRIQUINHA_PORTA}`;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  const bare = join(base, "origin.git");
  const repo = join(base, "repo");
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, "LEIAME"), "loja\n");
  git(repo, "add", "LEIAME");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "push", "-q", "origin", "main");
  delete process.env.SONAR_HOST_URL;
  servico = await iniciarServico(raiz, join(base, "pacote-bin"));
  registrarProjeto(servico.banco, {
    nome: "loja",
    raiz_git: repo,
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "loja",
  });
});
after(async () => {
  await servico.parar();
  rmSync(base, { recursive: true, force: true });
});

const cookie = () =>
  `fabriquinha=${String(new URL(readFileSync(join(raiz, "web.url"), "utf8")).searchParams.get("token"))}`;

async function pedir(caminho: string, corpo?: unknown): Promise<{ status: number; corpo: unknown; texto: string }> {
  const r = await fetch(`${origem}${caminho}`, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { cookie: cookie(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });
  const texto = await r.text();
  return {
    status: r.status,
    texto,
    corpo: r.headers.get("content-type")?.includes("json") ? JSON.parse(texto) : texto,
  };
}

const postar = (caminho: string, corpo: unknown = {}) => pedir(caminho, corpo);

/** Espera `condicao` ficar verdadeira, até 10 s. */
async function ate(condicao: () => boolean | Promise<boolean>, oQue: string): Promise<void> {
  for (let espera = 0; !(await condicao()); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

type Evento = Record<string, unknown> & { type: string };

/** Assina o SSE da sessão e junta os eventos que chegam. */
async function assinar(sessao: string) {
  const controle = new AbortController();
  const r = await fetch(`${origem}/api/sessoes/${sessao}/eventos`, {
    headers: { cookie: cookie() },
    signal: controle.signal,
  });
  assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const eventos: Evento[] = [];
  const corpo = r.body;
  assert.ok(corpo);
  void (async () => {
    let resto = "";
    for await (const parte of corpo.pipeThrough(new TextDecoderStream())) {
      const blocos = (resto + parte).split("\n\n");
      resto = blocos.pop() ?? "";
      for (const bloco of blocos) eventos.push(JSON.parse(bloco.replace(/^data: /, "")) as Evento);
    }
  })().catch(() => undefined);
  return {
    eventos,
    fechar: () => {
      controle.abort();
    },
  };
}

const textos = (conversa: Record<string, unknown>[]) =>
  conversa.map((e) => {
    const m = e.message as { role: string; content: string | { text?: string }[] };
    return `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((b) => b.text).join("")}`;
  });

test("sessão de ticket da demanda: o chat, o SSE e o histórico saem do serviço da demanda", async () => {
  const em = "2026-01-01T00:00:00.000Z";
  gravarAgregadoPronto(
    servico.banco,
    montarAgregadoDemanda("I-310", "planejar", {
      tentativas: [
        {
          ticket: Endereco.doTicket("I-310", 1),
          numero: 1,
          processo_id: "ed-falhou",
          inicio: em,
          fim: em,
          resultado: { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "a execução anterior falhou" },
        },
      ],
      tickets: [
        {
          demanda_id: "I-310",
          ticket_id: 1,
          etapa: "planejar",
          estado: "em_execucao",
          estado_alterado_em: em,
          criado_por: { tipo: "fabriquinha" },
        },
      ],
    }),
  );
  comTrabalhosDoTicket(servico.banco, { demanda_id: "I-310", ticket_id: 1 }, (e) => ({
    ...e,
    sessoes: [{ demanda_id: "I-310", ticket_id: 1, id: "sd-310", modo: "interativo", conversa_referencia: "sd-310" }],
    execucoes: [
      { id: "ed-falhou", trabalho_id: "sd-310", inicio: em, fim: em, falha: true },
      { id: "ed-310", trabalho_id: "sd-310", inicio: em, fim: em, falha: false },
    ],
  }));
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  const mensagem = (role: string, text: string) => ({
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  });
  writeFileSync(
    join(raiz, "sessoes", "2026-01-01T00-00-00-000Z_sd-310.jsonl"),
    [mensagem("user", "planeje"), mensagem("assistant", "Qual a prioridade?")]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );

  const chat = DadosDoChatDemanda.parse((await pedir("/api/sessoes/sd-310")).corpo);
  assert.deepEqual(
    [chat.origem, chat.demanda, chat.rodada, chat.ticket, chat.etapa, chat.sessao.estado, chat.sessao.pendencia?.tipo],
    ["demanda", "I-310", undefined, "I-310.T1", "planejar", "aguardando_humano", "dialogo_do_agente"],
  );
  assert.deepEqual(
    chat.pendencias.map((p) => [p.tipo, p.item, p.acao_esperada]),
    [["dialogo_do_agente", "I-310.T1", "responder"]],
  );
  assert.deepEqual(textos(chat.conversa), ["user: planeje", "assistant: Qual a prioridade?"]);
  assert.deepEqual(
    chat.execucoes.map((execucao) => [execucao.id, execucao.motivo]),
    [
      ["ed-falhou", "a execução anterior falhou"],
      ["ed-310", undefined],
    ],
  );

  const sse = await assinar("sd-310");
  await ate(() => sse.eventos.length > 0, "o retrato");
  const [retrato] = sse.eventos as [Evento & DadosDoChatDemanda];
  assert.deepEqual([retrato.type, retrato.origem, retrato.conversa.length], ["chat", "demanda", 2]);
  condutor.avisar("sd-310", join(raiz, "log"));
  await ate(() => sse.eventos.length > 1, "o estado novo");
  assert.deepEqual([sse.eventos[1]?.type, sse.eventos[1]?.origem], ["estado", "demanda"]);
  sse.fechar();

  const baixado = await fetch(`${origem}/api/sessoes/sd-310/historico.md`, { headers: { cookie: cookie() } });
  assert.equal(baixado.status, 200);
  assert.equal(baixado.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(baixado.headers.get("content-disposition"), 'attachment; filename="historico-I-310.T1.md"');
  assert.match(
    await baixado.text(),
    /^# Histórico da sessão I-310.T1 \(planejar\)[\s\S]*## Auditor\n\nplaneje[\s\S]*## Agente\n\nQual a prioridade\?/,
  );

  // CA-9, CA-12: texto vazio rejeitado no schema; steer na conversa, diálogo e aborto sem pi são rejeitados.
  const vazio = await postar("/api/sessoes/sd-310/mensagens", { texto: "   ", modo: "prompt" });
  assert.equal(vazio.status, 422);
  assert.equal((await postar("/api/sessoes/sd-310/mensagens", { texto: "x", modo: "steer" })).status, 409);
  for (const resposta of [{ valor: "x" }, { confirmado: true }, { cancelado: true }]) {
    assert.equal((await postar("/api/sessoes/sd-310/dialogos/d1", resposta)).status, 409);
  }
  assert.equal((await postar("/api/sessoes/sd-310/dialogos/d1", { valor: "x", cancelado: true })).status, 422);
  assert.equal((await postar("/api/sessoes/sd-310/abortar")).status, 409);
});

test("CA-3: a sessão que não é de uma demanda não existe em nenhuma rota do chat (404)", async () => {
  const nada = await pedir("/api/sessoes/sd-nada");
  assert.equal(nada.status, 404);
  assert.match(JSON.stringify(nada.corpo), /a sessão sd-nada não existe[\s\S]*confira o endereço do chat/);
  for (const [caminho, corpo] of [
    ["/api/sessoes/sd-nada/eventos", undefined],
    ["/api/sessoes/sd-nada/historico.md", undefined],
    ["/api/sessoes/sd-nada/mensagens", { texto: "oi", modo: "prompt" }],
    ["/api/sessoes/sd-nada/dialogos/d1", { valor: "x" }],
    ["/api/sessoes/sd-nada/abortar", {}],
  ] as const) {
    const r = await pedir(caminho, corpo);
    assert.equal(r.status, 404, caminho);
    assert.match(r.texto, /a sessão sd-nada não existe/);
  }
});

test("sessão de ticket da demanda com o pi vivo: responder o diálogo, enviar a mensagem e abortar", async () => {
  gravarConfiguracaoSdlc(servico.banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: join(base, "repo"),
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      preparacao: [],
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      e2e: [],
      globs: [],
    },
  });
  const ref = { demanda_id: "I-311", ticket_id: 1 };
  gravarAgregadoPronto(
    servico.banco,
    montarAgregadoDemanda("I-311", "planejar", {
      demanda: { ...montarAgregadoDemanda("I-311", "planejar").demanda, descricao: "pergunte perguntar" },
      tickets: [
        {
          ...ref,
          etapa: "planejar",
          estado: "em_execucao",
          estado_alterado_em: "2026-01-01T00:00:00.000Z",
          criado_por: { tipo: "fabriquinha" },
        },
      ],
    }),
  );
  const { fim } = iniciarExecucaoDemanda(servico.banco, ref, {
    limiteMin: 5,
    modo: "interativo",
    fechar: () => Promise.resolve(),
  });
  const sessao = String(carregarTrabalhosDoTicket(servico.banco, ref).sessoes[0]?.id);
  const dialogos = () => condutor.situacao(sessao)?.dialogos ?? [];
  await ate(() => dialogos().length === 1, "o diálogo");
  const resposta = await postar(`/api/sessoes/${sessao}/dialogos/${String(dialogos()[0]?.id)}`, { valor: "alta" });
  assert.equal(resposta.status, 204);
  await ate(() => condutor.situacao(sessao)?.ocupado === false, "o pi ocioso");

  // Quem assina no meio da mensagem recebe, logo depois do retrato, o começo dela e os pedaços já escritos (F4 §5.4).
  const sse = await assinar(sessao);
  assert.equal((await postar(`/api/sessoes/${sessao}/mensagens`, { texto: "[ao vivo]", modo: "prompt" })).status, 204);
  await ate(() => sse.eventos.some((e) => JSON.stringify(e).includes('"delta":"esperam a "')), "o texto em fluxo");
  sse.fechar();
  const tarde = await assinar(sessao);
  await ate(() => tarde.eventos.length >= 5, "o retrato e a mensagem em andamento");
  assert.deepEqual(
    tarde.eventos
      .slice(1)
      .filter((e) => e.type === "message_start" || e.type === "message_update")
      .map((e) => (e.assistantMessageEvent as { delta?: string } | undefined)?.delta)
      .slice(0, 4),
    [undefined, undefined, "Os testes ", "esperam a "],
  );
  tarde.fechar();
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 204);
  await ate(() => condutor.situacao(sessao)?.ocupado === false, "o pi ocioso depois do aborto");

  assert.equal(
    (await postar(`/api/sessoes/${sessao}/mensagens`, { texto: "pergunte perguntar", modo: "prompt" })).status,
    204,
  );
  await ate(() => dialogos().length === 1, "o diálogo da mensagem");
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 204);
  await ate(() => condutor.situacao(sessao)?.ocupado === false, "o aborto");
  interromperExecucaoDemanda(servico.banco, ref);
  await fim;
});
