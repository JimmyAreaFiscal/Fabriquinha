import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { after, test } from "node:test";
import { instalarPiFalso } from "../../../apoio-testes/pi_falso.ts";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { AmbienteHostLocal } from "../../ambiente/infra/ambiente_host_local.ts";
import type { executar } from "../../compartilhado/infra/processo.ts";
import { HarnessPi, divisorJsonl } from "./harness_pi.ts";
import { PACOTE } from "./pi.ts";

const harness = new HarnessPi();
const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-harness-pi-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("framing: divide só em \\n, junta pedaços, tira \\r final e mantém U+2028 e U+2029 dentro da string", () => {
  const dividir = divisorJsonl();
  const evento = JSON.stringify({ type: "message_end", texto: "a\u2028b\u2029c" });
  assert.deepEqual(dividir(evento.slice(0, 10)), []);
  assert.deepEqual(dividir(evento.slice(10) + '\r\n\n{"type":'), [evento]);
  assert.deepEqual(dividir('"agent_settled"}\n'), ['{"type":"agent_settled"}']);
  assert.deepEqual(JSON.parse(evento), { type: "message_end", texto: "a\u2028b\u2029c" });
});

test("linha de comando do F4 §6.1: sessão, modelo, skills da etapa, guarda e confiança; sem prompt de sistema extra", () => {
  // O pacote vem do próprio repositório, ao lado de `src/`.
  assert.equal(existsSync(join(PACOTE, "extensions", "guarda.ts")), true);
  assert.equal(existsSync(join(PACOTE, "extensions", "pergunta.ts")), true);
  const comum = { raiz: "/r", sessaoPi: "s-1", modo: "autonomo" as const };
  assert.deepEqual(
    harness.argumentos({
      ...comum,
      skills: ["artefato-comportamento", "artefato-criterios-aceite"],
      modelo: { provedor: "anthropic", nome: "m 1" },
      confianca: true,
    }),
    [
      "--mode",
      "rpc",
      "--session-dir",
      "/r/sessoes/s-1",
      "--session-id",
      "s-1",
      "--provider",
      "anthropic",
      "--model",
      "m 1",
      "--skill",
      `${PACOTE}/skills/artefato-comportamento`,
      "--skill",
      `${PACOTE}/skills/artefato-criterios-aceite`,
      "-e",
      `${PACOTE}/extensions/guarda.ts`,
      "-e",
      `${PACOTE}/extensions/pergunta.ts`,
      "--approve",
      "--exclude-tools",
      "ask_user_question",
    ],
  );
  const comEffort = harness.argumentos({ ...comum, skills: [], modelo: undefined, effort: "high", confianca: false });
  assert.deepEqual(comEffort.slice(6, 8), ["--thinking", "high"]);
  assert.deepEqual(harness.argumentos({ ...comum, skills: [], modelo: undefined, confianca: false }), [
    "--mode",
    "rpc",
    "--session-dir",
    "/r/sessoes/s-1",
    "--session-id",
    "s-1",
    "-e",
    `${PACOTE}/extensions/guarda.ts`,
    "-e",
    `${PACOTE}/extensions/pergunta.ts`,
    "--no-approve",
    "--exclude-tools",
    "ask_user_question",
  ]);
  assert.deepEqual(harness.argumentos({ ...comum, skills: [], modelo: undefined, confianca: undefined }).slice(-3), [
    `${PACOTE}/extensions/pergunta.ts`,
    "--exclude-tools",
    "ask_user_question",
  ]);
  // F4 §6.5: a consulta roda sem as ferramentas de escrita.
  const consulta = {
    ...comum,
    skills: [],
    modelo: undefined,
    confianca: undefined,
    modo: "consulta" as const,
  };
  assert.deepEqual(harness.argumentos(consulta).slice(-3), [
    `${PACOTE}/extensions/pergunta.ts`,
    "--exclude-tools",
    "ask_user_question,edit,write,bash,powershell",
  ]);
});

test("ambiente: variáveis da Fabriquinha, sem credenciais e com gh e az num diretório vazio", () => {
  process.env.FABRIQUINHA_EXECUCAO = "9"; // nem herdadas do serviço
  process.env.FABRIQUINHA_ROOT = "/herdada";
  process.env.GH_TOKEN = "segredo";
  process.env.SYSTEM_ACCESSTOKEN = "segredo";
  process.env.SONAR_TOKEN = "segredo";
  try {
    const env = harness.ambiente("/r", "/r/execucoes/E-7", 7);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.SYSTEM_ACCESSTOKEN, undefined);
    assert.equal(env.SONAR_TOKEN, undefined);
    assert.equal(env.PATH, `${PACOTE}/bin:${String(process.env.PATH)}`);
    assert.equal(env.FABRIQUINHA_EXECUCAO, undefined);
    assert.equal(env.FABRIQUINHA_ROOT, undefined);
    assert.deepEqual(
      [env.FABRIQUINHA_SAIDA, env.GH_CONFIG_DIR, env.AZURE_CONFIG_DIR],
      ["/r/execucoes/E-7/saida", "/r/execucoes/E-7/vazio", "/r/execucoes/E-7/vazio"],
    );
  } finally {
    delete process.env.FABRIQUINHA_EXECUCAO;
    delete process.env.FABRIQUINHA_ROOT;
    delete process.env.GH_TOKEN;
    delete process.env.SYSTEM_ACCESSTOKEN;
    delete process.env.SONAR_TOKEN;
  }
});

test("ambiente container: começa vazio, sem HOME, SSH_AUTH_SOCK nem credenciais de hospedagem ou do Sonar", () => {
  const herdadas = {
    HOME: "/home/host",
    SSH_AUTH_SOCK: "/tmp/ssh",
    GH_TOKEN: "segredo",
    AZURE_DEVOPS_EXT_PAT: "segredo",
    AZURE_OPENAI_API_KEY: "segredo",
    SONAR_TOKEN: "segredo",
    PI_CODING_AGENT_DIR: "/home/host/.pi/agent",
    ANTHROPIC_API_KEY: "chave",
  };
  const originais = Object.fromEntries(Object.keys(herdadas).map((nome) => [nome, process.env[nome]]));
  Object.assign(process.env, herdadas);
  try {
    assert.deepEqual(harness.ambiente("/r", "/r/execucoes/E-7", 7, "container"), {
      ANTHROPIC_API_KEY: "chave",
      FABRIQUINHA_SAIDA: "/r/execucoes/E-7/saida",
    });
    assert.deepEqual(harness.ambiente("/r", "/r/avaliacoes/s", undefined, "container"), {
      ANTHROPIC_API_KEY: "chave",
      FABRIQUINHA_ROOT: "/r",
      FABRIQUINHA_AUDITORIA: "1",
    });
  } finally {
    for (const [nome, valor] of Object.entries(originais)) {
      if (valor === undefined) Reflect.deleteProperty(process.env, nome);
      else process.env[nome] = valor;
    }
  }
});

test("auditoria: só leitura (sem edit, write, bash nem powershell), com a guarda, e o ambiente sem FABRIQUINHA_EXECUCAO", () => {
  const sessao = "11111111-1111-4111-8111-111111111111";
  const args = harness.argumentos({ raiz: "/r", sessaoPi: sessao });
  assert.deepEqual(args, [
    "--mode",
    "rpc",
    "--session-dir",
    `/r/sessoes/${sessao}`,
    "--session-id",
    sessao,
    "-e",
    `${PACOTE}/extensions/guarda.ts`,
    "--exclude-tools",
    "edit,write,bash,powershell",
  ]);
  // Com o modelo da Configuração, `--provider` e `--model` vêm logo depois de `--session-id`; `null` é sem modelo.
  assert.deepEqual(harness.argumentos({ raiz: "/r", sessaoPi: sessao, modelo: null }), args);
  const com = harness.argumentos({
    raiz: "/r",
    sessaoPi: sessao,
    modelo: { provedor: "llamacpp", nome: "qwen3-coder-30b" },
  });
  assert.deepEqual(com.slice(4, 9), ["--session-id", sessao, "--provider", "llamacpp", "--model"]);
  assert.deepEqual(com.slice(9, 11), ["qwen3-coder-30b", "-e"]);
  assert.equal(com.length, args.length + 4);
  // Extensões extras entram depois da guarda, antes de `--exclude-tools`.
  const extra = harness.argumentos({ raiz: "/r", sessaoPi: sessao, modelo: null, extensoes: ["achado.ts"] });
  assert.deepEqual(extra.slice(6, 10), [
    "-e",
    `${PACOTE}/extensions/guarda.ts`,
    "-e",
    `${PACOTE}/extensions/achado.ts`,
  ]);
  assert.equal(extra.length, args.length + 2);
  process.env.FABRIQUINHA_EXECUCAO = "9"; // nem herdada do serviço
  process.env.GH_TOKEN = "segredo";
  try {
    const env = harness.ambiente("/r", `/r/avaliacoes/${sessao}`);
    assert.equal(env.FABRIQUINHA_EXECUCAO, undefined);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.GH_TOKEN, undefined);
    assert.deepEqual(
      [env.FABRIQUINHA_ROOT, env.FABRIQUINHA_AUDITORIA, env.GH_CONFIG_DIR],
      ["/r", "1", `/r/avaliacoes/${sessao}/vazio`],
    );
  } finally {
    delete process.env.FABRIQUINHA_EXECUCAO;
    delete process.env.GH_TOKEN;
  }
});

test("pi que nem roda: o erro vai para o log, saiu resolve, e enviar e parar não derrubam o serviço", async () => {
  const log = join(base, "log-inexistente");
  process.env.FABRIQUINHA_PI = join(base, "nao-existe");
  try {
    // Variável indefinida do env não vai ao Ambiente.
    const env = { ...process.env, SEM_VALOR: undefined };
    const pi = harness.lancar(new AmbienteHostLocal(), [], { cwd: base, env, log }, () => undefined);
    pi.enviar({ type: "prompt", message: "oi" });
    assert.equal(await pi.saiu, -2);
    await pi.parar();
    assert.match(readFileSync(log, "utf8"), /pi: spawn .*nao-existe ENOENT/);
  } finally {
    delete process.env.FABRIQUINHA_PI;
  }
});

test("stdout: cada objeto JSON vira evento; texto solto, null e número vão para o log, e o stderr também", async () => {
  const log = join(base, "log-saida");
  instalarPiFalso(base).roteirizar([
    {
      saidaDoProcesso: {
        stdout: 'aviso solto\nnull\n5\n{"type":"agent_settled"}\n',
        stderr: "erro\n",
      },
    },
  ]);
  process.env.FABRIQUINHA_ROOT = base;
  try {
    const eventos: unknown[] = [];
    const pi = harness.lancar(new AmbienteHostLocal(), [], { cwd: base, env: process.env, log }, (e) =>
      eventos.push(e),
    );
    assert.equal(await pi.saiu, 0);
    assert.deepEqual(eventos, [{ type: "agent_settled" }]);
    const texto = readFileSync(log, "utf8");
    assert.match(
      texto,
      /pi, fora do protocolo: aviso solto\n.*pi, fora do protocolo: null\n.*pi, fora do protocolo: 5\n/,
    );
    assert.match(texto, /^erro$/m);
    // Escrever depois que o pi saiu dá EPIPE, que só vai para o log.
    pi.enviar({ type: "abort" });
    await pi.parar();
  } finally {
    delete process.env.FABRIQUINHA_PI;
  }
});

test("fecharStdin: o pi recebe o EOF do stdin; sem ele, o stdin segue aberto", async () => {
  const log = join(base, "log-eof");
  instalarPiFalso(base).roteirizar([{ saidaDoProcesso: { esperaEof: true } }]);
  process.env.FABRIQUINHA_ROOT = base;
  try {
    // O pi só termina no EOF; sem fecharStdin, ficaria preso até o parar().
    const piFechado = harness.lancar(
      new AmbienteHostLocal(),
      [],
      { cwd: base, env: process.env, log, fecharStdin: true },
      () => undefined,
    );
    assert.equal(await piFechado.saiu, 0);
    const aberto = harness.lancar(new AmbienteHostLocal(), [], { cwd: base, env: process.env, log }, () => undefined);
    const preso = await Promise.race([aberto.saiu, dormir(200, "preso")]);
    assert.equal(preso, "preso");
    await aberto.parar();
  } finally {
    delete process.env.FABRIQUINHA_PI;
  }
});

test("padrões do Auditor: o pi do PATH", () => {
  delete process.env.FABRIQUINHA_PI;
  assert.equal(harness.binarioPi(), "pi");
});

test("perguntar: o modo consulta roda o pi uma vez, sem ferramentas e sem credenciais, e devolve o stdout e o Uso", async () => {
  const credenciais = ["GH_TOKEN", "GITHUB_TOKEN", "AZURE_DEVOPS_EXT_PAT", "SYSTEM_ACCESSTOKEN", "SONAR_TOKEN"];
  for (const nome of credenciais) process.env[nome] = "segredo";
  const chamadas: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const sessao = JSON.stringify({
    type: "message",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "assistant",
      provider: "p",
      model: "m",
      usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.5 } },
    },
  });
  // O pi falso grava a sessão no diretório que a consulta lhe deu, como o pi de verdade.
  const pi =
    (codigo: number | null): typeof executar =>
    (_comando, args, opcoes) => {
      chamadas.push({ args, env: opcoes?.env ?? {} });
      writeFileSync(join(args[args.indexOf("--session-dir") + 1] ?? "", "consulta.jsonl"), sessao + "\n");
      return Promise.resolve({ codigo, saida: "resposta", erro: "", limiteEstourado: false });
    };
  try {
    assert.deepEqual(await harness.perguntar("pergunta", { provedor: "p", nome: "m" }, 1000, pi(0)), {
      saida: "resposta",
      uso: [
        {
          modelo: "p/m",
          tokens_entrada: 10,
          tokens_saida: 5,
          tokens_cache_leitura: 2,
          tokens_cache_escrita: 1,
          custo: 0.5,
          chamadas: 1,
        },
      ],
    });
    const dirDaSessao = chamadas[0]?.args[2] ?? "";
    assert.deepEqual(chamadas[0]?.args.toSpliced(2, 1), [
      "-p",
      "--session-dir",
      "--no-tools",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-mcp",
      "--model",
      "p/m",
      "pergunta",
    ]);
    assert.ok(!existsSync(dirDaSessao), "o diretório temporário da sessão é apagado");
    for (const nome of credenciais) assert.equal(chamadas[0].env[nome], undefined, nome);
    assert.equal(chamadas[0].env.PATH, process.env.PATH);
    assert.equal(await harness.perguntar("pergunta", undefined, 1000, pi(1)), undefined);
    assert.ok(!chamadas[1]?.args.includes("--model"));
    const quebra = (() => Promise.reject(new Error("spawn pi ENOENT"))) as unknown as typeof executar;
    assert.equal(await harness.perguntar("pergunta", undefined, 1000, quebra), undefined);
  } finally {
    for (const nome of credenciais) Reflect.deleteProperty(process.env, nome);
  }
});

test("arquivoDaSessao: o arquivo do pi da sessão, nenhum se não há, e erro se há mais de um", () => {
  const raiz = join(base, "sessoes-do-pi");
  assert.equal(harness.arquivoDaSessao(raiz, "s-1"), undefined, "sem a pasta");
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  assert.equal(harness.arquivoDaSessao(raiz, "s-1"), undefined, "sem o arquivo");
  writeFileSync(join(raiz, "sessoes", "2026-10-11T00-00-00-000Z_s-1.jsonl"), "");
  writeFileSync(join(raiz, "sessoes", "2026-10-11T00-00-00-000Z_s-2.jsonl"), "");
  assert.equal(harness.arquivoDaSessao(raiz, "s-1"), join(raiz, "sessoes", "2026-10-11T00-00-00-000Z_s-1.jsonl"));
  writeFileSync(join(raiz, "sessoes", "2026-10-12T00-00-00-000Z_s-1.jsonl"), "");
  assert.throws(() => harness.arquivoDaSessao(raiz, "s-1"), ErroDeRegra);
});

test("a sessão tem pasta própria, e o core a acha pelo caminho de sempre mesmo que a pasta seja um link para o Espaço (container)", () => {
  const raiz = join(base, "sessoes-por-pasta");
  assert.equal(harness.pastaDaSessao(raiz, "s-7"), join(raiz, "sessoes", "s-7"));
  const doEspaco = join(base, "espaco-da-sessao", "s-7");
  mkdirSync(doEspaco, { recursive: true });
  writeFileSync(join(doEspaco, "2026-10-11T00-00-00-000Z_s-7.jsonl"), "");
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  symlinkSync(doEspaco, join(raiz, "sessoes", "s-7"));
  assert.equal(
    harness.arquivoDaSessao(raiz, "s-7"),
    join(raiz, "sessoes", "s-7", "2026-10-11T00-00-00-000Z_s-7.jsonl"),
  );
  assert.equal(harness.pastaDaSessao(raiz, "s-7"), join(raiz, "sessoes", "s-7"));
});

test("a sessão que já nasceu solta em sessoes/ (antes da pasta própria) continua lá, para o pi retomá-la", () => {
  const raiz = join(base, "sessoes-antigas");
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  writeFileSync(join(raiz, "sessoes", "2026-10-11T00-00-00-000Z_s-8.jsonl"), "");
  assert.equal(harness.pastaDaSessao(raiz, "s-8"), join(raiz, "sessoes"));
  assert.equal(harness.pastaDaSessao(raiz, "s-9"), join(raiz, "sessoes", "s-9"));
});
