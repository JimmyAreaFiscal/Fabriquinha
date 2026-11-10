// I-288.R3: o trabalho de um Espaço no container de verdade (CONCEITOS.md §7). O projeto de teste é o de
// `projeto-container/` (imagem com node e git, teste, e2e e hook de commit) e o pi é o falso da imagem. Pulado sem
// `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e constrói a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { servir } from "../apoio-testes/servidor_web_de_teste.ts";
import type { PassoPi } from "../apoio-testes/pi_falso.ts";
import type { DepsDespacho } from "../src/aplicacao/despacho.ts";
import { ConducaoDePlanejar } from "../src/aplicacao/etapas/conducao_de_planejar.ts";
import { enviarDemanda, lerConversa } from "../src/aplicacao/sessoes_demanda.ts";
import { condutor } from "../src/aplicacao/trabalho/condutor.ts";
import { carregarTrabalhosDoTicket } from "../src/armazenamento/trabalho_agentico.ts";
import { anotar } from "../src/infra/registro.ts";
import { Endereco } from "../src/nucleo/item_de_trabalho.ts";
import { relogioDoSistema } from "../src/nucleo/relogio.ts";
import { caminhoDaWorktreeRodada } from "../src/infra/repositorio/worktree-demanda.ts";
import { demandaEmExecucao, encerrar, execucoesDe, revisar, rodadaDe, ticketDe } from "./apoio-execucao.ts";
import { base, ciclo, criarCenario, demanda, demandaAprovada, esperar, git, type Cenario } from "./apoio.ts";
import {
  ghFalso,
  instalarSonarFalso,
  ligarContainerAoCenario,
  projetoDeTesteEmContainer,
  raizCompartilhadaComODocker,
} from "./falsos.ts";

const gh = ghFalso(base);
await instalarSonarFalso(join(base, "bin"));

const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

/** O despacho que fecha o ticket com as Verificações de verdade: testes, e2e e fitness do projeto de teste rodam no container. */
const despachoComVerificacoesReais: DepsDespacho = {
  implementacao: { opcoesSonar: { limiteMs: 60_000, intervaloMs: 1 } },
};

/** O pi do planejamento sai sozinho ao receber o prompt: interrompê-lo por sinal pede o Ambiente do processo. */
const PLANEJAMENTO_QUE_SAI_SOZINHO: PassoPi = { uso: null, sai: { codigo: 0 } };

/** O cenário com o projeto de teste e o Ambiente `container` ligado, e o pi falso da imagem dele. */
function cenarioEmContainer(t: TestContext) {
  const c = criarCenario(t, "loja", raizCompartilhadaComODocker());
  projetoDeTesteEmContainer(c);
  const pi = ligarContainerAoCenario(t, c);
  return { c, pi };
}

/**
 * Tira uma amostra do `ps -eo args` do host a cada 100 ms até o fim do teste e junta as linhas distintas dos processos
 * que descendem deste teste: o host é de todos, e outro teste ou o próprio pi do Auditor rodam nele ao mesmo tempo.
 */
function amostrarProcessosDoHost(t: TestContext): { linhas: () => string[] } {
  const linhas = new Set<string>();
  const amostrar = setInterval(() => {
    execFile("ps", ["-eo", "pid=,ppid=,args="], (erro, saida) => {
      if (erro) return;
      const processos = saida.split("\n").flatMap((linha) => {
        const [, pid, ppid, args] = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(linha) ?? [];
        return pid && ppid && args ? [{ pid: Number(pid), ppid: Number(ppid), args }] : [];
      });
      const meus = new Set([process.pid]);
      // O ps lista por pid, e o filho pode ter pid menor que o pai: repete até não achar mais descendente.
      for (let achou = true; achou;) {
        achou = false;
        for (const { pid, ppid } of processos) if (meus.has(ppid) && !meus.has(pid)) achou = meus.add(pid).has(pid);
      }
      for (const { pid, args } of processos) if (meus.has(pid) && pid !== process.pid) linhas.add(args);
    });
  }, 100);
  t.after(() => {
    clearInterval(amostrar);
  });
  return { linhas: () => [...linhas] };
}

// O que só deve existir dentro do container: o pi, os comandos de teste do projeto de teste e o hook de commit dele.
const SO_NO_CONTAINER = /pi_falso|\/opt\/pi-falso|--mode rpc|node --test src\/|npm (test|run e2e)|hooks\/pre-commit/;

test(
  "CA-1: a Rodada inteira (implementar, revisar_rodada e encerrar_rodada) roda no container e o PR é aberto pelo core",
  COM_DOCKER,
  async (t) => {
    const { c, pi } = cenarioEmContainer(t);
    const processosDoHost = amostrarProcessosDoHost(t);

    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    pi.roteirizar([{ escreve: { "feature.txt": "linha\n" }, uso: null }]);
    await ciclo(c, despachoComVerificacoesReais);
    assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");
    await revisar(c, id, { resultado: "aprovado" });
    await encerrar(c, id);
    assert.equal(rodadaDe(c, id, 1)?.estado, "gate_pr");

    // A hospedagem falsa tem o PR da Rodada aberto.
    const [pr, ...outros] = gh.prs();
    assert.ok(pr);
    assert.deepEqual(outros, []);
    assert.equal(pr.estado, "aberto");
    assert.equal(pr.head, rodadaDe(c, id, 1)?.branch);

    // O commit do ticket saiu do container: a identidade é a da imagem, e não a do git do host.
    const rodada = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
    assert.equal(git(rodada, "log", "-1", "--format=%an"), "Fabriquinha");

    // No host, o pi, os testes e o hook só aparecem como argumento de um `docker exec`.
    const amostras = processosDoHost.linhas();
    const noDockerExec = amostras.filter((linha) => linha.includes("docker exec"));
    assert.ok(
      noDockerExec.some((linha) => linha.includes("'--mode' 'rpc'")),
      "a amostra viu o pi no docker exec",
    );
    assert.deepEqual(
      amostras.filter((linha) => SO_NO_CONTAINER.test(linha) && !linha.includes("docker exec")),
      [],
    );
  },
);

/** O `ps -eo args` do container do Espaço da rodada 1, o único que ainda existe com o ticket implementado. */
function processosNoContainerDaRodada(c: Cenario): string {
  const [container] = c.banco.prepare("SELECT container_id FROM ambiente WHERE alocado_para = 'I-1.R1'").all() as {
    container_id: string;
  }[];
  assert.ok(container, "o Espaço da rodada 1 tem container alocado");
  return execFileSync("docker", ["exec", container.container_id, "ps", "-eo", "args"], { encoding: "utf8" });
}

/** O motivo do hook de commit: o último estado do ticket `implementar` depois de um ciclo em que o hook se comporta como `caso`. */
async function implementarComHook(
  { c, pi }: ReturnType<typeof cenarioEmContainer>,
  caso: "reprova" | "trava",
  limiteCommitMs: number,
) {
  const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
  pi.roteirizar([
    {
      escreve: { "feature.txt": "linha\n" },
      // O hook lê o caso do diretório git da worktree, que o agente alcança por dentro do container.
      shell: `echo ${caso} > "$(git rev-parse --git-path hook-caso)"`,
      uso: null,
    },
  ]);
  await ciclo(c, { implementacao: { ...despachoComVerificacoesReais.implementacao, limiteCommitMs } });
  const ref = ticketDe(c, id, 1);
  const tentativa = demanda(c, id).tentativas.findLast((x) => x.ticket.ticket_id === ref.ticket_id);
  assert.ok(tentativa, "o ticket tem Tentativa");
  return tentativa;
}

test(
  "hook de commit que sai com código 1: o ticket registra Tentativa de reprovação com a saída do hook",
  COM_DOCKER,
  async (t) => {
    const cenario = cenarioEmContainer(t);
    const tentativa = await implementarComHook(cenario, "reprova", 60_000);
    assert.equal(tentativa.resultado?.tipo, "reprovacao");
    assert.match(String((tentativa.resultado as { motivo?: string }).motivo), /hook: reprovado de propósito/);
  },
);

test(
  "hook de commit que não termina no limite: o hook é morto no container e a Tentativa é falha de infraestrutura",
  COM_DOCKER,
  async (t) => {
    const cenario = cenarioEmContainer(t);
    const tentativa = await implementarComHook(cenario, "trava", 5000);
    assert.equal(tentativa.resultado?.tipo, "falha_infraestrutura");
    assert.doesNotMatch(processosNoContainerDaRodada(cenario.c), /sleep 3600/);
  },
);

/** Um evento do SSE do chat: o JSON de cada bloco `data:`. */
type EventoDoChat = Record<string, unknown> & { type: string };

/** O SSE do chat da sessão, assinado pelo serviço web de verdade; junta os eventos que chegam. */
async function assinarOChat(t: TestContext, c: Cenario, porta: number, sessao: string) {
  const token = new URL(readFileSync(join(c.raiz, "web.url"), "utf8")).searchParams.get("token");
  const controle = new AbortController();
  const resposta = await fetch(`http://127.0.0.1:${String(porta)}/api/sessoes/${sessao}/eventos`, {
    headers: { cookie: `fabriquinha=${String(token)}` },
    signal: controle.signal,
  });
  assert.equal(resposta.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const corpo = resposta.body;
  assert.ok(corpo);
  const eventos: EventoDoChat[] = [];
  void (async () => {
    let resto = "";
    for await (const parte of corpo.pipeThrough(new TextDecoderStream())) {
      const blocos = (resto + parte).split("\n\n");
      resto = blocos.pop() ?? "";
      for (const bloco of blocos) eventos.push(JSON.parse(bloco.replace(/^data: /, "")) as EventoDoChat);
    }
  })().catch(() => undefined);
  t.after(() => {
    controle.abort();
  });
  return eventos;
}

const textoDe = (mensagem: unknown): string => {
  const { content } = mensagem as { content: string | { text?: string }[] };
  return typeof content === "string" ? content : content.map((bloco) => bloco.text ?? "").join("");
};

/** O texto das mensagens que chegaram pelo SSE, com o papel de quem as disse. */
const mensagensDoSse = (eventos: EventoDoChat[]): string[] =>
  eventos
    .filter((e) => e.type === "message_end")
    .map((e) => `${(e.message as { role: string }).role}: ${textoDe(e.message)}`);

const MODELO_A = { provedor: "anthropic", modelo: "claude-opus-5-5" };
const MODELO_B = { provedor: "anthropic", modelo: "claude-sonnet-5-5" };

/** O diálogo que o pi abre ao receber o primeiro prompt e a resposta que ele dá quando o Auditor o responde. */
const PI_QUE_PERGUNTA: PassoPi = {
  eventos: [
    {
      type: "tool_execution_start",
      toolCallId: "p1",
      toolName: "perguntar",
      args: { question: "Qual ordem?", options: [{ label: "A" }, { label: "B" }] },
    },
    { type: "extension_ui_request", id: "d1", method: "select", title: "Qual ordem?", options: ["A", "B"] },
  ],
  termina: "nunca",
  resposta: "ordem escolhida",
  modelo: MODELO_A,
  uso: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3, totalTokens: 128 },
  custo: 0.5,
};

/**
 * O planejamento da demanda é interativo: o pi fica vivo conversando com o Auditor. Começa a execução e devolve a
 * sessão dele e o que o `fim` da condução espera.
 */
async function iniciarConversaDoPlanejamento(c: Cenario) {
  const id = await demandaAprovada(c);
  const ticket = { demanda_id: id, ticket_id: 2 };
  const fim = new ConducaoDePlanejar({
    banco: c.banco,
    relogio: relogioDoSistema,
    condutor,
    registro: anotar,
  }).conduzir(Endereco.doTicket(id, 2));
  await esperar(() => carregarTrabalhosDoTicket(c.banco, ticket).sessoes.length === 1, "a sessão do planejamento");
  const [sessao] = carregarTrabalhosDoTicket(c.banco, ticket).sessoes;
  assert.ok(sessao);
  return { ticket, sessao: sessao.id, fim };
}

/** O pi vivo da sessão está ocioso, sem diálogo aberto: a conversa espera o Auditor. */
const conversaOciosa = (sessao: string): boolean => {
  const situacao = condutor.situacao(sessao);
  return situacao?.dialogos.length === 0 && !situacao.ocupado;
};

test(
  "CA-4: chat com o pi no container: mensagem e diálogo pelo SSE e retomada com o mesmo session-id",
  COM_DOCKER,
  async (t) => {
    const { c, pi } = cenarioEmContainer(t);
    const { porta, pedir } = await servir(c.banco);
    pi.roteirizar([
      PI_QUE_PERGUNTA,
      { resposta: "resposta à mensagem", modelo: MODELO_B, uso: null },
      { resposta: "voltei à conversa", modelo: MODELO_A, uso: null },
    ]);
    const { ticket, sessao, fim } = await iniciarConversaDoPlanejamento(c);
    const eventos = await assinarOChat(t, c, porta, sessao);

    // O diálogo chega pelo SSE, e a resposta dele é aceita.
    await esperar(() => eventos.some((e) => e.type === "extension_ui_request" && e.id === "d1"), "o diálogo no SSE");
    assert.equal(
      (await pedir(`/api/sessoes/${sessao}/dialogos/d1`, { metodo: "POST", corpo: { valor: "A" } })).status,
      204,
    );
    await esperar(() => mensagensDoSse(eventos).includes("assistant: ordem escolhida"), "a resposta do pi ao diálogo");

    // A mensagem do Auditor e a resposta do pi chegam pelo SSE.
    await esperar(() => conversaOciosa(sessao), "o pi ocioso");
    const mensagem = { texto: "como ficou a ordem?", modo: "prompt" };
    assert.equal((await pedir(`/api/sessoes/${sessao}/mensagens`, { metodo: "POST", corpo: mensagem })).status, 204);
    await esperar(() => mensagensDoSse(eventos).includes("assistant: resposta à mensagem"), "a resposta do pi");
    assert.ok(mensagensDoSse(eventos).includes("user: como ficou a ordem?"));

    // O pi sai, e a mensagem seguinte retoma a conversa na mesma sessão, com outro pi.
    const primeiraExecucao = execucoesDe(c, ticket).at(-1);
    assert.ok(primeiraExecucao);
    condutor.encerrar(primeiraExecucao.id);
    await fim;
    const mensagemDaRetomada = { texto: "pode continuar?", modo: "prompt" };
    assert.equal(
      (await pedir(`/api/sessoes/${sessao}/mensagens`, { metodo: "POST", corpo: mensagemDaRetomada })).status,
      204,
    );
    await esperar(() => mensagensDoSse(eventos).includes("assistant: voltei à conversa"), "a resposta do pi retomado");

    const inicios = pi.registro().filter((entrada) => entrada.evento === "inicio");
    assert.equal(inicios.length, 2);
    const sessoesDosPis = inicios.map((entrada) => entrada.argv?.[entrada.argv.indexOf("--session-id") + 1]);
    assert.deepEqual(sessoesDosPis, [sessao, sessao]);

    // O JSONL do pi do container é o que o core lê em `R/sessoes`.
    assert.deepEqual(
      readdirSync(join(c.raiz, "sessoes")).filter((nome) => nome.endsWith(`_${sessao}.jsonl`)).length,
      1,
    );
    const conversa = lerConversa(c.raiz, sessao).map((entrada) => (entrada as { message?: unknown }).message);
    assert.deepEqual(
      conversa.filter(Boolean).map((m) => `${(m as { role: string }).role}: ${textoDe(m)}`),
      [
        "user: " + textoDe(conversa[0]),
        "assistant: ordem escolhida",
        "user: como ficou a ordem?",
        "assistant: resposta à mensagem",
        "user: pode continuar?",
        "assistant: voltei à conversa",
      ],
    );

    const segundaExecucao = execucoesDe(c, ticket).at(-1);
    assert.notEqual(segundaExecucao?.id, primeiraExecucao.id);
    condutor.encerrar(String(segundaExecucao?.id));
  },
);

/** O Uso de cada modelo, somado à parte do Uso gravado pela Fabriquinha: lê as mensagens do assistente do JSONL do pi. */
function usoDoJsonlPorModelo(arquivo: string) {
  const somas = new Map<string, Record<"entrada" | "saida" | "cacheLeitura" | "cacheEscrita" | "custo", number>>();
  for (const linha of readFileSync(arquivo, "utf8").split("\n").filter(Boolean)) {
    const { message: m } = JSON.parse(linha) as {
      message?: {
        role: string;
        provider: string;
        model: string;
        usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
      };
    };
    if (m?.role !== "assistant" || !m.usage) continue;
    const modelo = `${m.provider}/${m.model}`;
    const soma = somas.get(modelo) ?? { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, custo: 0 };
    somas.set(modelo, {
      entrada: soma.entrada + m.usage.input,
      saida: soma.saida + m.usage.output,
      cacheLeitura: soma.cacheLeitura + m.usage.cacheRead,
      cacheEscrita: soma.cacheEscrita + m.usage.cacheWrite,
      custo: soma.custo + m.usage.cost.total,
    });
  }
  return somas;
}

test(
  "CA-5: o Uso gravado da execução no container é a soma, por modelo, das mensagens do JSONL da sessão",
  COM_DOCKER,
  async (t) => {
    const { c, pi } = cenarioEmContainer(t);
    pi.roteirizar([
      PI_QUE_PERGUNTA,
      {
        resposta: "r2",
        modelo: MODELO_B,
        uso: { input: 7, output: 3, cacheRead: 1, cacheWrite: 2, totalTokens: 13 },
        custo: 0.25,
      },
      {
        resposta: "r3",
        modelo: MODELO_A,
        uso: { input: 11, output: 13, cacheRead: 17, cacheWrite: 19, totalTokens: 60 },
        custo: 0.125,
      },
    ]);
    const { ticket, sessao, fim } = await iniciarConversaDoPlanejamento(c);
    await esperar(() => (condutor.situacao(sessao)?.dialogos.length ?? 0) === 1, "o diálogo");
    condutor.responder(execucoesDe(c, ticket).at(-1)?.id ?? "", "d1", { value: "A" });
    for (const mensagem of ["segunda mensagem", "terceira mensagem"]) {
      await esperar(() => conversaOciosa(sessao), "o pi ocioso");
      assert.equal(enviarDemanda(c.banco, sessao, mensagem, "prompt"), true);
    }
    await esperar(() => conversaOciosa(sessao) && pi.prompts().length === 3, "a terceira resposta");
    const execucao = execucoesDe(c, ticket).at(-1);
    assert.ok(execucao);
    condutor.encerrar(execucao.id);
    await fim;

    const arquivo = readdirSync(join(c.raiz, "sessoes")).find((nome) => nome.endsWith(`_${sessao}.jsonl`));
    assert.ok(arquivo);
    const noJsonl = usoDoJsonlPorModelo(join(c.raiz, "sessoes", arquivo));
    const gravado = carregarTrabalhosDoTicket(c.banco, ticket).usos.filter((u) => u.execucao_id === execucao.id);
    assert.deepEqual(gravado.map((u) => `${u.modelo_provedor}/${u.modelo_nome}`).sort(), [...noJsonl.keys()].sort());
    for (const u of gravado) {
      assert.deepEqual(
        {
          entrada: u.tokens_entrada,
          saida: u.tokens_saida,
          cacheLeitura: u.tokens_cache_leitura,
          cacheEscrita: u.tokens_cache_escrita,
          custo: u.custo,
        },
        noJsonl.get(`${u.modelo_provedor}/${u.modelo_nome}`),
      );
    }
    // O modelo A respondeu duas vezes: a soma não é a de uma mensagem só.
    assert.equal(noJsonl.get("anthropic/claude-opus-5-5")?.entrada, 111);
  },
);
