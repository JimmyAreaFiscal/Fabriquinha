// I-288.R3: o trabalho de um Espaço no container de verdade (CONCEITOS.md §7). O projeto de teste é o de
// `projeto-container/` (imagem com node e git, teste, e2e e hook de commit) e o pi é o falso da imagem. Pulado sem
// `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e constrói a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer as createServidorHttp } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { servir } from "../../apoio-testes/servidor_web_de_teste.ts";
import type { PassoPi } from "../../apoio-testes/falsos/pi_falso.ts";
import {
  despachoDasEtapas,
  ConducaoDePlanejar,
  enviarDemanda,
  condutor,
  Endereco,
  AUDITOR,
  retomarFalhasDeInfraestrutura,
} from "../../src/modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeAmbientes } from "../../src/modulos/ambiente/publico.ts";
import { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import {
  carregarSessoesDoContexto,
  gravarTokenDaExecucao,
  dirDoPiDoAuditor,
  PACOTE,
} from "../../src/modulos/sessoes/publico.ts";
import { anotar, noLog } from "../../src/shared/infra/registro.ts";
import { pastasDoProcesso } from "../../src/modulos/ciclo_de_vida/conducao/nucleo/pastas_do_processo.ts";
import { relogioDoSistema } from "../../src/shared/nucleo/relogio.ts";
import { caminhoDaWorktreeRodada, exigirGit } from "../../src/modulos/repositorio/publico.ts";
import { iniciarServico } from "../../src/server/composicao/servico.ts";
import { raizDo } from "../../src/shared/armazenamento/banco.ts";
import { servirWeb } from "../../src/server/api/servidor.ts";
import {
  atual,
  demandaEmExecucao,
  encerrar,
  execucoesDe,
  revisar,
  rodadaDe,
  statusDe,
  ticketDe,
} from "../apoio-execucao.ts";
import { base, CTX, ciclo, criarCenario, demanda, demandaAprovada, esperar, git, type Cenario } from "../apoio.ts";
import {
  ghFalso,
  instalarSonarFalso,
  ligarContainerAoCenario,
  projetoDeTesteEmContainer,
  raizCompartilhadaComODocker,
} from "../falsos.ts";
import { cancelarDemandaEmCascata } from "../../src/server/fluxos/cancelamento_em_cascata.ts";
import { reservadoPeloDespacho } from "../../apoio-testes/reserva_do_despacho.ts";

const gh = ghFalso(base);
await instalarSonarFalso(join(base, "bin"));

const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

/** O despacho que fecha o ticket com as Verificações de verdade: testes, e2e e fitness do projeto de teste rodam no container. */
const implementacaoComVerificacoesReais = { opcoesSonar: { limiteMs: 60_000, intervaloMs: 1 } };
const despachoComVerificacoesReais = despachoDasEtapas({ implementacao: implementacaoComVerificacoesReais });

/** O pi do planejamento sai sozinho ao receber o prompt: interrompê-lo por sinal pede o Ambiente do processo. */
const PLANEJAMENTO_QUE_SAI_SOZINHO: PassoPi = { uso: null, sai: { codigo: 0 } };

/** O cenário com o projeto de teste e o Ambiente `container` ligado, e o pi falso da imagem dele. */
/** A gestão de Ambientes do cenário em andamento: os testes deste arquivo rodam um por vez. */
let gestaoDoCenario: GestaoDeAmbientes | undefined;

async function cenarioEmContainer(t: TestContext, portaDaApi?: number) {
  const c = criarCenario(t, "loja", raizCompartilhadaComODocker());
  projetoDeTesteEmContainer(c);
  const { pi, gestao } = await ligarContainerAoCenario(t, c, portaDaApi);
  gestaoDoCenario = gestao;
  return { c, pi, gestao };
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
    const { c, pi } = await cenarioEmContainer(t);
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

/** O Ambiente do container que o conjunto alocou ao Espaço `dono` (por exemplo `I-1.R1`). */
function ambienteAlocadoPara(c: Cenario, dono: string) {
  const [linha] = c.banco.prepare("SELECT id FROM ambiente WHERE alocado_para = ?").all(dono) as { id: string }[];
  assert.ok(linha, `o Espaço ${dono} tem container alocado`);
  const ambiente = gestaoDoCenario?.ambienteDo(dono);
  assert.ok(ambiente instanceof AmbienteContainer);
  assert.equal(ambiente.id, linha.id);
  return ambiente;
}

const processosNoContainer = (container: string): string =>
  execFileSync("docker", ["exec", container, "ps", "-eo", "args"], { encoding: "utf8" });

/** O `ps -eo args` do container do Espaço da rodada 1, o único que ainda existe com o ticket implementado. */
function processosNoContainerDaRodada(c: Cenario): string {
  return processosNoContainer(ambienteAlocadoPara(c, "I-1.R1").container_id);
}

/** O motivo do hook de commit: o último estado do ticket `implementar` depois de um ciclo em que o hook se comporta como `caso`. */
async function implementarComHook(
  { c, pi }: Awaited<ReturnType<typeof cenarioEmContainer>>,
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
  await ciclo(c, despachoDasEtapas({ implementacao: { ...implementacaoComVerificacoesReais, limiteCommitMs } }));
  const ref = ticketDe(c, id, 1);
  const tentativa = demanda(c, id).tentativas.findLast((x) => x.ticket.ticket_id === ref.ticket_id);
  assert.ok(tentativa, "o ticket tem Tentativa");
  return tentativa;
}

test(
  "hook de commit que sai com código 1: o ticket registra Tentativa de reprovação com a saída do hook",
  COM_DOCKER,
  async (t) => {
    const cenario = await cenarioEmContainer(t);
    const tentativa = await implementarComHook(cenario, "reprova", 60_000);
    assert.equal(tentativa.resultado?.tipo, "reprovacao");
    assert.match(String((tentativa.resultado as { motivo?: string }).motivo), /hook: reprovado de propósito/);
  },
);

test(
  "hook de commit que não termina no limite: o hook é morto no container e a Tentativa é falha de infraestrutura",
  COM_DOCKER,
  async (t) => {
    const cenario = await cenarioEmContainer(t);
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
  }).conduzir(reservadoPeloDespacho(c.banco, Endereco.doTicket(id, 2)));
  await esperar(() => carregarSessoesDoContexto(c.banco, ticket).sessoes.length === 1, "a sessão do planejamento");
  const [sessao] = carregarSessoesDoContexto(c.banco, ticket).sessoes;
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
    const { c, pi, gestao } = await cenarioEmContainer(t);
    const { porta, pedir } = await servir(c.banco, true, undefined, gestao);
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

    // O JSONL do pi do container é o que o core lê em `R/sessoes/<sessão>`, pasta que só a sessão dele monta.
    assert.deepEqual(
      readdirSync(join(c.raiz, "sessoes", sessao)).filter((nome) => nome.endsWith(`_${sessao}.jsonl`)).length,
      1,
    );
    const conversa = condutor.lerConversa(c.raiz, sessao).map((entrada) => (entrada as { message?: unknown }).message);
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
    const { c, pi } = await cenarioEmContainer(t);
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

    const arquivo = readdirSync(join(c.raiz, "sessoes", sessao)).find((nome) => nome.endsWith(`_${sessao}.jsonl`));
    assert.ok(arquivo);
    const noJsonl = usoDoJsonlPorModelo(join(c.raiz, "sessoes", sessao, arquivo));
    const gravado = carregarSessoesDoContexto(c.banco, ticket).usos.filter((u) => u.execucao_id === execucao.id);
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

/** Os nomes das variáveis que a imagem do container traz no `ENV` (`docker image inspect`). */
function nomesDoEnvDaImagem(container: string): string[] {
  const imagem = execFileSync("docker", ["inspect", "--format", "{{.Config.Image}}", container], { encoding: "utf8" });
  const env = execFileSync("docker", ["image", "inspect", "--format", "{{json .Config.Env}}", imagem.trim()], {
    encoding: "utf8",
  });
  return (JSON.parse(env) as string[]).map((variavel) => variavel.split("=")[0] ?? "");
}

test(
  "CA-2: o env de um comando no container não leva o HOME do host nem variável de hospedagem, do Sonar ou do ssh-agent",
  COM_DOCKER,
  async (t) => {
    const { c } = await cenarioEmContainer(t);
    writeFileSync(join(c.repo, ".env"), "VARIAVEL_DO_ENV_DO_PROJETO=valor-do-projeto\n");
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString());
    const doHost = {
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      GH_TOKEN: "segredo-gh",
      AZURE_DEVOPS_EXT_PAT: "segredo-azure",
      AZURE_OPENAI_API_KEY: "segredo-azure-openai",
      SONAR_TOKEN: "segredo-sonar",
    };
    const antes = Object.fromEntries(Object.keys(doHost).map((nome) => [nome, process.env[nome]]));
    Object.assign(process.env, doHost);
    t.after(() => {
      for (const [nome, valor] of Object.entries(antes))
        if (valor === undefined) Reflect.deleteProperty(process.env, nome);
        else process.env[nome] = valor;
    });
    assert.ok(process.env.HOME);
    const daFabriquinha = {
      FABRIQUINHA_TOKEN: "token-do-processo",
      FABRIQUINHA_SAIDA: join(pastasDoProcesso(c.raiz, "env").dir, "saida"),
      ANTHROPIC_API_KEY: "chave-do-provedor",
    };

    const { codigo, saida } = await ambiente.executar({
      programa: "env",
      argumentos: [],
      cwd: caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 }),
      env: { ...process.env, ...daFabriquinha },
    });

    assert.equal(codigo, 0);
    const variaveis = Object.fromEntries(
      saida
        .split("\n")
        .filter(Boolean)
        .map((linha) => [linha.slice(0, linha.indexOf("=")), linha.slice(linha.indexOf("=") + 1)]),
    );
    const nomes = Object.keys(variaveis);
    assert.deepEqual(
      nomes.filter((nome) => /^(SSH_AUTH_SOCK|GH_|AZURE_|SONAR_)/.test(nome)),
      [],
    );
    assert.notEqual(variaveis.HOME, process.env.HOME);
    assert.equal(variaveis.VARIAVEL_DO_ENV_DO_PROJETO, "valor-do-projeto");
    assert.doesNotMatch(saida, /segredo-/);
    // Fora as da imagem e as do docker, só entram as da Fabriquinha, as chaves de provedor do LLM e as do .env do projeto.
    const doDocker = ["HOSTNAME", "HOME", "PWD", "PATH"];
    const permitidas = [
      ...nomesDoEnvDaImagem(ambiente.container_id),
      ...doDocker,
      "FABRIQUINHA_API",
      "PI_CODING_AGENT_DIR",
      "VARIAVEL_DO_ENV_DO_PROJETO",
      ...Object.keys(daFabriquinha),
    ];
    assert.deepEqual(
      nomes.filter((nome) => !permitidas.includes(nome)),
      [],
    );
    for (const nome of [
      "FABRIQUINHA_API",
      "PI_CODING_AGENT_DIR",
      "VARIAVEL_DO_ENV_DO_PROJETO",
      ...Object.keys(daFabriquinha),
    ])
      assert.ok(nomes.includes(nome), `o env do container tem ${nome}`);
    assert.ok(variaveis.PATH?.startsWith(`${join(PACOTE, "bin")}:`), "pacote-pi/bin vem à frente no PATH");
  },
);

test(
  "o container enxerga só as sessões e execuções do próprio Espaço, e recebe cópias do pi, do .claude e do .codex",
  COM_DOCKER,
  async (t) => {
    const { c } = await cenarioEmContainer(t);
    for (const [pasta, arquivo] of [
      [".claude", "CLAUDE.md"],
      [".codex", "config.toml"],
    ] as const) {
      mkdirSync(join(c.raiz, pasta), { recursive: true });
      writeFileSync(join(c.raiz, pasta, arquivo), `copia de ${pasta}`);
    }
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    const espaco = Endereco.daRodada(id, 1).toString();
    const ambiente = ambienteAlocadoPara(c, espaco);
    // Uma sessão e uma execução de outro Espaço, no caminho de sempre do core (o container ainda não as abrigou).
    mkdirSync(join(c.raiz, "sessoes", "sessao-de-outro-espaco"), { recursive: true });
    mkdirSync(join(c.raiz, "execucoes", "E-de-outro-espaco"), { recursive: true });
    mkdirSync(join(c.raiz, "execucoes", "E-propria"), { recursive: true });
    ambiente.abrigarProcesso(join(c.raiz, "execucoes", "E-propria"), "sessao-propria");

    const { codigo, saida } = await ambiente.executar({
      programa: `ls ${join(c.raiz, "sessoes")} ${join(c.raiz, "execucoes")}; cat $HOME/.claude/CLAUDE.md $HOME/.codex/config.toml; test -f $HOME/.pi/agent/auth.json && echo tem-auth`,
      argumentos: [],
      cwd: caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 }),
      env: {},
      noShell: true,
    });

    assert.equal(codigo, 0);
    assert.match(saida, /sessao-propria/);
    assert.match(saida, /E-propria/);
    assert.doesNotMatch(saida, /de-outro-espaco/);
    assert.match(saida, /copia de \.claude/);
    assert.match(saida, /copia de \.codex/);
    assert.match(saida, /tem-auth/);
    // As montagens do container são exatamente estas, e nenhuma delas é o home, o ~/.pi ou a pasta inteira de sessões.
    const binds = (
      JSON.parse(execFileSync("docker", ["inspect", ambiente.container_id], { encoding: "utf8" })) as {
        HostConfig: { Binds: string[] };
      }[]
    )[0]?.HostConfig.Binds;
    const origens = (binds ?? []).map((bind) => bind.split(":")[0]);
    assert.ok(!origens.includes(join(c.raiz, "sessoes")) && !origens.includes(join(c.raiz, "execucoes")));
    // Pelo caminho das pastas copiadas, e não por `.claude` no nome: o checkout pode morar dentro de um `.claude/`.
    const copiadas = [dirDoPiDoAuditor(), join(c.raiz, ".claude"), join(c.raiz, ".codex")];
    assert.ok(
      !origens.some((origem) => copiadas.some((copiada) => origem === copiada || origem?.startsWith(`${copiada}/`))),
    );
    assert.equal(binds?.length, 9);
  },
);

test("CA-3: o cancelamento da demanda mata o pi dentro do container", COM_DOCKER, async (t) => {
  const { c, pi } = await cenarioEmContainer(t);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
  const container = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString()).container_id;
  pi.roteirizar([{ termina: "nunca", uso: null }]);
  const fim = ciclo(c, despachoComVerificacoesReais);
  await esperar(() => SO_NO_CONTAINER.test(processosNoContainer(container)), "o pi vivo no container");

  cancelarDemandaEmCascata(c.banco, id, AUDITOR, CTX);
  await fim;

  assert.equal(statusDe(c, ticketDe(c, id, 1)), "cancelado");
  assert.doesNotMatch(processosNoContainer(container), SO_NO_CONTAINER);
});

/** Quem sobra no container depois da limpeza: o processo que o mantém vivo (`tail`) e o próprio `ps`. */
const PROCESSOS_DO_CONTAINER_VAZIO = ["ps -eo args", "tail -f /dev/null"];

test(
  "CA-3: o reinício do serviço com o pi vivo no container falha o ticket por infraestrutura, o retoma e devolve o container limpo",
  COM_DOCKER,
  async (t) => {
    const { c } = await cenarioEmContainer(t);
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    const ref = ticketDe(c, id, 1);
    const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString());
    const cwd = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });

    // A instância anterior lançou o pi do ticket e morreu com ele vivo: o banco guarda o processo aberto e o grupo dele.
    await ambiente.executar({
      programa: "touch /tmp/sobra /trabalho/sobra",
      noShell: true,
      argumentos: [],
      cwd,
      env: {},
    });
    const pi = ambiente.lancar({ programa: "pi", argumentos: ["--mode", "rpc"], cwd, env: {} });
    await esperar(() => SO_NO_CONTAINER.test(processosNoContainer(ambiente.container_id)), "o pi vivo no container");
    c.banco
      .prepare("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE demanda_id = ? AND ticket_id = ?")
      .run(ref.demanda_id, ref.ticket_id);
    c.banco
      .prepare(
        "INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', ?, ?, 'autonomo', 's1')",
      )
      .run(ref.demanda_id, ref.ticket_id);
    c.banco
      .prepare(
        "INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha, grupo_processo, ambiente_id) VALUES ('e1', 's1', ?, 0, ?, ?)",
      )
      .run(relogioDoSistema.agora(), pi.identificador.grupo_processo, ambiente.id);

    // Porta 0: a instância nova não disputa a porta com a Fabriquinha de quem roda o teste.
    const portaAntes = process.env.FABRIQUINHA_PORTA;
    process.env.FABRIQUINHA_PORTA = "0";
    const servico = await iniciarServico(c.raiz, join(PACOTE, "bin"));
    try {
      assert.notEqual(await pi.saiu, 0);
      assert.partialDeepStrictEqual(
        servico.banco.prepare("SELECT * FROM tentativa WHERE ticket_id = ?").get(ref.ticket_id),
        { resultado_tipo: "falha_infraestrutura", causa: "servico_reiniciado", motivo: "serviço reiniciado" },
      );
      assert.equal(statusDe(c, ref), "falhou");

      // A mesma retomada do host local: o reinício volta o ticket a `aberto` na hora.
      assert.deepEqual(retomarFalhasDeInfraestrutura(servico.banco), [`${id}.T${String(ref.ticket_id)}`]);
      assert.equal(statusDe(c, ref), "aberto");

      assert.equal(servico.banco.prepare("SELECT estado FROM ambiente WHERE id = ?").get(ambiente.id)?.estado, "livre");
      assert.deepEqual(
        processosNoContainer(ambiente.container_id).split("\n").slice(1).filter(Boolean).sort(),
        PROCESSOS_DO_CONTAINER_VAZIO,
      );
      const sobras = execFileSync(
        "docker",
        ["exec", ambiente.container_id, "find", "/tmp", "/trabalho", "-mindepth", "1"],
        {
          encoding: "utf8",
        },
      );
      assert.equal(sobras, "");
    } finally {
      if (portaAntes === undefined) Reflect.deleteProperty(process.env, "FABRIQUINHA_PORTA");
      else process.env.FABRIQUINHA_PORTA = portaAntes;
      await servico.parar();
    }
  },
);

test("uma segunda demanda no container reaproveitado cria a worktree dela", COM_DOCKER, async (t) => {
  const { c } = await cenarioEmContainer(t);
  await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
  // Os Espaços da primeira demanda acabaram: o conjunto limpa os containers dela e os devolve livres.
  const alocados = c.banco.prepare("SELECT id, container_id FROM ambiente WHERE estado = 'alocado'").all() as {
    id: string;
    container_id: string;
  }[];
  assert.ok(alocados.length > 0);
  for (const { id } of alocados) await gestaoDoCenario?.limpar(id);

  const segunda = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);

  const worktree = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: segunda, rodada_id: 1 });
  assert.ok(existsSync(worktree), "a worktree da rodada da segunda demanda existe");
  const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(segunda, 1).toString());
  assert.ok(
    alocados.some(({ container_id }) => container_id === ambiente.container_id),
    "a segunda demanda recebeu um container que a primeira já usou",
  );
  const { codigo } = await ambiente.executar({ programa: "git", argumentos: ["status"], cwd: worktree, env: {} });
  assert.equal(codigo, 0);
});

test(
  "o container não altera o que o git do host lê a partir do clone (commondir, config, hooks e worktrees do usuário), e o git do usuário e o push do core não executam nada",
  COM_DOCKER,
  async (t) => {
    const { c } = await cenarioEmContainer(t);
    // Uma worktree do usuário, que já existe quando o container é criado.
    const worktreeDoUsuario = join(c.dir, "worktree-do-usuario");
    git(c.repo, "worktree", "add", "-q", "-b", "do-usuario", worktreeDoUsuario);
    await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    const ambiente = ambienteAlocadoPara(c, "I-1.R1");
    // Outra, criada com o container já vivo: também fica fora do alcance dele.
    const worktreeCriadaDepois = join(c.dir, "worktree-criada-depois");
    git(c.repo, "worktree", "add", "-q", "-b", "criada-depois", worktreeCriadaDepois);
    const marca = join(c.dir, "executado-no-host");
    const gitDoClone = join(c.repo, ".git");
    const entradaDoUsuario = join(gitDoClone, "worktrees", "worktree-do-usuario");
    const entradaCriadaDepois = join(gitDoClone, "worktrees", "worktree-criada-depois");
    const noContainer = (cwd: string, script: string) =>
      ambiente.executar({ programa: "sh", argumentos: ["-c", script], cwd, env: {} });
    const fsmonitor = `printf '[core]\\n\\tfsmonitor = "touch ${marca}; false"\\n'`;
    const receivepack = `printf '[remote "origin"]\\n\\treceivepack = "touch ${marca}; git-receive-pack"\\n'`;

    const tentativas = await Promise.all([
      noContainer(gitDoClone, `${fsmonitor} >> config`),
      noContainer(gitDoClone, `${receivepack} >> config`),
      noContainer(gitDoClone, "printf '#!/bin/sh\\n' > hooks/pre-commit"),
      noContainer(
        gitDoClone,
        `mkdir objects/forjado && ${fsmonitor} > objects/forjado/config && echo objects/forjado > commondir`,
      ),
      noContainer(entradaDoUsuario, "echo ../../objects/forjado > commondir"),
      noContainer(entradaDoUsuario, "echo /tmp/forjado > gitdir"),
      noContainer(
        entradaCriadaDepois,
        `mkdir ../../objects/forjado2 && ${fsmonitor} > ../../objects/forjado2/config && echo ../../objects/forjado2 > commondir`,
      ),
    ]);
    for (const { codigo, saida } of tentativas) assert.notEqual(codigo, 0, saida);
    assert.ok(!existsSync(join(gitDoClone, "commondir")));
    for (const entrada of [entradaDoUsuario, entradaCriadaDepois]) {
      assert.equal(readFileSync(join(entrada, "commondir"), "utf8"), "../..\n");
      assert.match(readFileSync(join(entrada, "gitdir"), "utf8"), /^\S+\/\.git\n$/);
    }
    assert.ok(!existsSync(join(gitDoClone, "hooks", "pre-commit")));

    git(c.repo, "status");
    git(worktreeDoUsuario, "status");
    git(worktreeCriadaDepois, "status");
    git(c.repo, "branch", "nova");
    await exigirGit(c.repo, "push", "origin", "nova");
    assert.ok(!existsSync(marca), "nem o git do usuário nem o push do core executaram o que o container tentou gravar");
  },
);

test(
  "o fabriquinha empacotado, num comando no container, anexa à evidência um arquivo de $FABRIQUINHA_SAIDA",
  COM_DOCKER,
  async (t) => {
    // A API do agente de verdade, em todas as interfaces: o container a alcança pelo `host.docker.internal`.
    const apiDoAgente = createServidorHttp().listen(0, "0.0.0.0");
    await once(apiDoAgente, "listening");
    t.after(() => {
      apiDoAgente.closeAllConnections();
      apiDoAgente.close();
    });
    const porta = (apiDoAgente.address() as AddressInfo).port;
    const { c, pi, gestao } = await cenarioEmContainer(t, porta);
    apiDoAgente.on(
      "request",
      servirWeb({
        banco: c.banco,
        raiz: raizDo(c.banco),
        porta,
        agendador: { proximaBusca: () => new Date() },
        // A gestão do cenário: uma segunda montagem conferiria o conjunto do Docker da máquina.
        ambientes: { gestao, configurar: () => undefined },
        relogio: relogioDoSistema,
        registrarErro: noLog,
      }),
    );
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    // A comprovação dos critérios é do ticket de revisão da rodada, que nasce quando o `implementar` conclui.
    pi.roteirizar([{ escreve: { "feature.txt": "linha\n" }, uso: null }]);
    await ciclo(c, despachoComVerificacoesReais);
    const revisao = atual(c, id, "revisar_rodada", 1);
    const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString());
    c.banco
      .prepare("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE demanda_id = ? AND ticket_id = ?")
      .run(id, revisao.ticket_id);
    c.banco
      .prepare(
        "INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', ?, ?, 'autonomo', 's1')",
      )
      .run(id, revisao.ticket_id);
    c.banco
      .prepare("INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES ('e1', 's1', ?, 0)")
      .run(relogioDoSistema.agora());
    gravarTokenDaExecucao(c.banco, "e1", "token-do-processo");

    // Como o `conduzir` faz: a pasta do processo vira link para a do Ambiente, e a saída nasce dentro dela.
    const { dir } = pastasDoProcesso(c.raiz, "e1");
    mkdirSync(dir, { recursive: true });
    ambiente.abrigarProcesso(dir, "sessao-1");
    const saida = join(dir, "saida");
    mkdirSync(saida, { recursive: true });
    const dados = { criterios: [{ id: "CA-1", atendido: true, comoVerificado: "tela", arquivos: ["prova.png"] }] };
    writeFileSync(join(saida, "dados.json"), JSON.stringify(dados));

    const { codigo, saida: resposta } = await ambiente.executar({
      programa: `printf '\\211PNG\\r\\n\\032\\n' > "$FABRIQUINHA_SAIDA/prova.png" && fabriquinha evidencia add ${id}.T${String(revisao.ticket_id)} comprovacao_criterios --dados "$FABRIQUINHA_SAIDA/dados.json" --arquivo "$FABRIQUINHA_SAIDA/prova.png"`,
      noShell: true,
      argumentos: [],
      cwd: caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 }),
      env: {
        FABRIQUINHA_API: `host.docker.internal:${String(porta)}`,
        FABRIQUINHA_TOKEN: "token-do-processo",
        FABRIQUINHA_SAIDA: saida,
      },
    });

    assert.equal(codigo, 0, resposta);
    assert.deepEqual(
      c.banco
        .prepare("SELECT caminho FROM arquivo_evidencia WHERE caminho = 'prova.png'")
        .all()
        .map((a) => a.caminho),
      ["prova.png"],
    );
  },
);

/** Um servidor TCP que escuta em todas as interfaces, para o container tentar alcançá-lo pelo `host.docker.internal`. */
async function escutarNoHost(t: TestContext): Promise<number> {
  const servidor = createServer((conexao) => conexao.destroy()).listen(0, "0.0.0.0");
  await once(servidor, "listening");
  t.after(() => {
    servidor.close();
  });
  return (servidor.address() as AddressInfo).port;
}

const CONECTA_NO_HOST = `const s = require("net").connect(Number(process.argv[1]), "host.docker.internal");
s.on("connect", () => { console.log("conectou"); process.exit(0); });
s.on("error", (erro) => { console.log(erro.code); process.exit(1); });
setTimeout(() => { console.log("sem resposta"); process.exit(2); }, 5000);`;

test(
  "container: FABRIQUINHA_SAIDA é gravável, ele não grava pre-push nos hooks do projeto e só a porta da API do host é alcançável",
  COM_DOCKER,
  async (t) => {
    const portaDaApi = await escutarNoHost(t);
    const outraPorta = await escutarNoHost(t);
    const { c, pi } = await cenarioEmContainer(t, portaDaApi);
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);

    // O pi grava na saída do processo, que o core lê do host.
    pi.roteirizar([
      {
        escreve: { "feature.txt": "linha\n" },
        shell: 'test -d "$FABRIQUINHA_SAIDA" && echo gravavel > "$FABRIQUINHA_SAIDA/prova"',
        uso: null,
      },
    ]);
    await ciclo(c, despachoComVerificacoesReais);
    const execucao = execucoesDe(c, ticketDe(c, id, 1)).at(-1);
    assert.ok(execucao);
    assert.equal(readFileSync(join(pastasDoProcesso(c.raiz, execucao.id).dir, "saida", "prova"), "utf8"), "gravavel\n");

    // O container não consegue gravar um pre-push nos hooks do projeto; o push do core não executa nada.
    const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString());
    const cwd = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
    const marca = join(c.raiz, "execucoes", "pre-push-executou");
    const escreveOHook = await ambiente.executar({
      programa: `hooks="$(git rev-parse --path-format=absolute --git-common-dir)/hooks" && mkdir -p "$hooks" && printf '#!/bin/sh\\necho executou >> ${marca}\\n' > "$hooks/pre-push" && chmod +x "$hooks/pre-push"`,
      noShell: true,
      argumentos: [],
      cwd,
      env: {},
    });
    assert.notEqual(escreveOHook.codigo, 0);
    const forjaOGit = await ambiente.executar({
      programa: `git_comum="$(git rev-parse --path-format=absolute --git-common-dir)" && echo "$git_comum/objects" > "$git_comum/commondir" && printf '[remote "origin"]\\n\\treceivepack = "echo executou >> ${marca}"\\n' >> "$git_comum/config"`,
      noShell: true,
      argumentos: [],
      cwd,
      env: {},
    });
    assert.notEqual(forjaOGit.codigo, 0);
    git(c.repo, "branch", "nova");
    await exigirGit(c.repo, "push", "origin", "nova");
    assert.equal(existsSync(marca), false, "o git do core não executou o pre-push");

    // Da rede do container, a API do agente responde e nenhuma outra porta do host.
    const conectar = (porta: number) =>
      ambiente.executar({ programa: "node", argumentos: ["-e", CONECTA_NO_HOST, String(porta)], cwd, env: {} });
    assert.equal((await conectar(portaDaApi)).saida.trim(), "conectou");
    const aOutra = await conectar(outraPorta);
    assert.notEqual(aOutra.codigo, 0);
    assert.doesNotMatch(aOutra.saida, /conectou/);
  },
);

const TOKEN_DO_GITHUB = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";

/** Define variáveis no `process.env` do core até o fim do teste. */
function definirNoEnvDoCore(t: TestContext, variaveis: Record<string, string>): void {
  const antes = Object.fromEntries(Object.keys(variaveis).map((nome) => [nome, process.env[nome]]));
  Object.assign(process.env, variaveis);
  t.after(() => {
    for (const [nome, valor] of Object.entries(antes))
      if (valor === undefined) Reflect.deleteProperty(process.env, nome);
      else process.env[nome] = valor;
  });
}

test(
  "nenhum token do GitHub entra no container: nem no env, nem nas cópias do pi, do .claude e do .codex, nem nas montagens",
  COM_DOCKER,
  async (t) => {
    const { c } = await cenarioEmContainer(t);
    definirNoEnvDoCore(t, { GH_TOKEN: TOKEN_DO_GITHUB, GITHUB_TOKEN: TOKEN_DO_GITHUB });
    writeFileSync(
      join(c.repo, ".env"),
      `GH_TOKEN=${TOKEN_DO_GITHUB}\nGITHUB_TOKEN=${TOKEN_DO_GITHUB}\nGH_PAT=${TOKEN_DO_GITHUB}\n`,
    );
    for (const [pasta, arquivo] of [
      [".claude", "settings.json"],
      [".codex", "config.toml"],
    ] as const) {
      mkdirSync(join(c.raiz, pasta), { recursive: true });
      writeFileSync(join(c.raiz, pasta, arquivo), `token = "${TOKEN_DO_GITHUB}"`);
    }
    writeFileSync(join(dirDoPiDoAuditor(), "settings.json"), `{"githubToken":"${TOKEN_DO_GITHUB}"}`);
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString());
    const cwd = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
    const [inspecao] = JSON.parse(execFileSync("docker", ["inspect", ambiente.container_id], { encoding: "utf8" })) as {
      Config: { Env: string[] };
      HostConfig: { Binds: string[] };
    }[];
    assert.ok(inspecao);
    const montagens = inspecao.HostConfig.Binds.map((bind) => bind.split(":")[1] ?? "");

    // O env de um comando, com o token no env do core e no .env do projeto, e o env que o docker deu ao container.
    const { saida: envDoComando } = await ambiente.executar({
      programa: "env",
      argumentos: [],
      cwd,
      env: { ...process.env } as Record<string, string>,
    });
    assert.doesNotMatch(envDoComando, /ghp_/);
    assert.doesNotMatch(inspecao.Config.Env.join("\n"), /ghp_/);

    // As cópias do home do container e todas as montagens.
    const { codigo, saida } = await ambiente.executar({
      programa: `grep -rIl 'ghp_' "$HOME" ${montagens.join(" ")} /tmp /trabalho`,
      argumentos: [],
      cwd,
      env: {},
      noShell: true,
    });
    assert.equal(saida.trim(), "", "nenhum arquivo do container tem token do GitHub");
    assert.equal(codigo, 1, "o grep varreu tudo e não achou nada");
  },
);

/** Põe na frente do PATH um `docker` que anota cada chamada em `registro` e chama o de verdade. */
function registrarChamadasAoDocker(t: TestContext, dir: string): string {
  const registro = join(dir, "chamadas-ao-docker");
  const docker = execFileSync("sh", ["-c", "command -v docker"], { encoding: "utf8" }).trim();
  mkdirSync(join(dir, "docker-que-registra"), { recursive: true });
  writeFileSync(
    join(dir, "docker-que-registra", "docker"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${registro}'\nexec '${docker}' "$@"\n`,
    { mode: 0o755 },
  );
  definirNoEnvDoCore(t, { PATH: `${join(dir, "docker-que-registra")}:${process.env.PATH ?? ""}` });
  return registro;
}

test(
  "o push da Rodada é feito pelo core, fora do container, e de dentro do container um git push falha por falta de credencial",
  COM_DOCKER,
  async (t) => {
    // Um servidor HTTP que exige login: o git do container o alcança pela porta da API do agente e anota o que apresentou.
    const credenciaisApresentadas: (string | undefined)[] = [];
    const hospedagemQueExigeLogin = createServidorHttp((pedido, resposta) => {
      credenciaisApresentadas.push(pedido.headers.authorization);
      resposta.writeHead(401, { "www-authenticate": 'Basic realm="hospedagem"' }).end();
    }).listen(0, "0.0.0.0");
    await once(hospedagemQueExigeLogin, "listening");
    t.after(() => {
      hospedagemQueExigeLogin.close();
    });
    const portaDaApi = (hospedagemQueExigeLogin.address() as AddressInfo).port;
    const registroDoDocker = registrarChamadasAoDocker(t, join(base, "docker-do-push"));
    const { c, pi } = await cenarioEmContainer(t, portaDaApi);

    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    pi.roteirizar([{ escreve: { "feature.txt": "linha\n" }, uso: null }]);
    await ciclo(c, despachoComVerificacoesReais);
    await revisar(c, id, { resultado: "aprovado" });
    await encerrar(c, id);

    // O push chegou à hospedagem falsa: a branch da Rodada está no remoto.
    const branch = rodadaDe(c, id, 1)?.branch;
    assert.ok(branch);
    assert.equal(
      git(c.bare, "rev-parse", `refs/heads/${branch}`),
      git(caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 }), "rev-parse", "HEAD"),
    );
    // Nenhum `docker exec` da Rodada rodou `git push`.
    const chamadas = readFileSync(registroDoDocker, "utf8").split("\n");
    assert.ok(
      chamadas.some((chamada) => chamada.startsWith("exec ") && chamada.includes("git")),
      "o git do commit rodou no container",
    );
    assert.deepEqual(
      chamadas.filter((chamada) => /\bpush\b/.test(chamada)),
      [],
    );

    // De dentro do container, o git não tem credencial nenhuma e o push falha.
    const ambiente = ambienteAlocadoPara(c, Endereco.daRodada(id, 1).toString());
    const push = await ambiente.executar({
      programa: "git",
      argumentos: [
        "push",
        `http://host.docker.internal:${String(portaDaApi)}/loja.git`,
        "HEAD:refs/heads/do-container",
      ],
      cwd: caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 }),
      env: {},
    });
    assert.notEqual(push.codigo, 0);
    assert.match(push.erro, /could not read Username|terminal prompts disabled|Authentication failed/);
    assert.ok(credenciaisApresentadas.length > 0, "o git do container chegou à hospedagem");
    assert.deepEqual(
      credenciaisApresentadas.filter((credencial) => credencial !== undefined),
      [],
    );
  },
);
