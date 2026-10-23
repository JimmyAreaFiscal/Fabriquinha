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
import {
  PACOTE,
  ambienteDaAuditoria,
  ambientePi,
  argumentosDaAuditoria,
  argumentosPi,
  binarioPi,
  confianca,
  divisorJsonl,
  lancarPi,
  skillsDaEtapa,
} from "./pi.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-pi-")));
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

test("skills de artefato da etapa: uma por evidência de agente, com o nome do P1", () => {
  assert.deepEqual(skillsDaEtapa("registro"), ["artefato-comportamento", "artefato-criterios-aceite"]);
  assert.deepEqual(skillsDaEtapa("desenho"), [
    "artefato-desenho-solucao",
    "artefato-prototipo",
    "artefato-complexidade",
    "artefato-impactos-arquitetura",
  ]);
  assert.deepEqual(skillsDaEtapa("desenvolvimento"), []);
  assert.deepEqual(skillsDaEtapa("revisao"), ["artefato-explicacao-fitness", "artefato-comprovacao-criterios"]);
  assert.deepEqual(skillsDaEtapa("encerramento"), [
    "artefato-mensagem-pr",
    "artefato-aula-codigo",
    "artefato-video-demonstracao",
  ]);
  assert.deepEqual(skillsDaEtapa("sessao"), []);
});

test("linha de comando do F4 §6.1: sessão, modelo, skills da etapa, guarda e confiança; sem prompt de sistema extra", () => {
  // O pacote vem do próprio repositório, ao lado de `src/`.
  assert.equal(existsSync(join(PACOTE, "extensions", "guarda.ts")), true);
  assert.equal(existsSync(join(PACOTE, "extensions", "pergunta.ts")), true);
  const comum = { raiz: "/r", sessaoPi: "s-1", modo: "autonomo" as const };
  assert.deepEqual(
    argumentosPi({ ...comum, etapa: "registro", modelo: { provedor: "anthropic", modelo: "m 1" }, confianca: true }),
    [
      "--mode",
      "rpc",
      "--session-dir",
      "/r/sessoes",
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
  const comEffort = argumentosPi({ ...comum, etapa: "sessao", modelo: undefined, effort: "high", confianca: false });
  assert.deepEqual(comEffort.slice(6, 8), ["--thinking", "high"]);
  assert.deepEqual(argumentosPi({ ...comum, etapa: "sessao", modelo: undefined, confianca: false }), [
    "--mode",
    "rpc",
    "--session-dir",
    "/r/sessoes",
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
  assert.deepEqual(argumentosPi({ ...comum, etapa: "sessao", modelo: undefined, confianca: undefined }).slice(-3), [
    `${PACOTE}/extensions/pergunta.ts`,
    "--exclude-tools",
    "ask_user_question",
  ]);
  // F4 §6.5: a consulta abre copiando a sessão principal e retoma sem copiar; em ambas, sem as ferramentas de escrita.
  const consulta = {
    ...comum,
    etapa: "sessao" as const,
    modelo: undefined,
    confianca: undefined,
    modo: "consulta" as const,
  };
  assert.deepEqual(argumentosPi({ ...consulta, fork: "/r/sessoes/x_p.jsonl" }).slice(-4), [
    "--fork",
    "/r/sessoes/x_p.jsonl",
    "--exclude-tools",
    "ask_user_question,edit,write,bash,powershell",
  ]);
  assert.deepEqual(argumentosPi(consulta).slice(-3), [
    `${PACOTE}/extensions/pergunta.ts`,
    "--exclude-tools",
    "ask_user_question,edit,write,bash,powershell",
  ]);
});

test("ambiente: variáveis da Fabriquinha, sem credenciais e com gh e az num diretório vazio", () => {
  process.env.GH_TOKEN = "segredo";
  process.env.SYSTEM_ACCESSTOKEN = "segredo";
  process.env.SONAR_TOKEN = "segredo";
  try {
    const env = ambientePi("/r", 7, "/r/execucoes/E-7");
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.SYSTEM_ACCESSTOKEN, undefined);
    assert.equal(env.SONAR_TOKEN, undefined);
    assert.equal(env.PATH, process.env.PATH);
    assert.deepEqual(
      [env.FABRIQUINHA_EXECUCAO, env.FABRIQUINHA_ROOT, env.FABRIQUINHA_SAIDA, env.GH_CONFIG_DIR, env.AZURE_CONFIG_DIR],
      ["7", "/r", "/r/execucoes/E-7/saida", "/r/execucoes/E-7/vazio", "/r/execucoes/E-7/vazio"],
    );
  } finally {
    delete process.env.GH_TOKEN;
    delete process.env.SYSTEM_ACCESSTOKEN;
    delete process.env.SONAR_TOKEN;
  }
});

test("auditoria: só leitura (sem edit, write, bash nem powershell), com a guarda, e o ambiente sem FABRIQUINHA_EXECUCAO", () => {
  const sessao = "11111111-1111-4111-8111-111111111111";
  const args = argumentosDaAuditoria("/r", sessao);
  assert.deepEqual(args, [
    "--mode",
    "rpc",
    "--session-dir",
    "/r/sessoes",
    "--session-id",
    sessao,
    "-e",
    `${PACOTE}/extensions/guarda.ts`,
    "--exclude-tools",
    "edit,write,bash,powershell",
  ]);
  // Com o modelo da Configuração, `--provider` e `--model` vêm logo depois de `--session-id`; `null` é sem modelo.
  assert.deepEqual(argumentosDaAuditoria("/r", sessao, null), args);
  const com = argumentosDaAuditoria("/r", sessao, { provedor: "llamacpp", modelo: "qwen3-coder-30b" });
  assert.deepEqual(com.slice(4, 9), ["--session-id", sessao, "--provider", "llamacpp", "--model"]);
  assert.deepEqual(com.slice(9, 11), ["qwen3-coder-30b", "-e"]);
  assert.equal(com.length, args.length + 4);
  process.env.FABRIQUINHA_EXECUCAO = "9"; // nem herdada do serviço
  process.env.GH_TOKEN = "segredo";
  try {
    const env = ambienteDaAuditoria("/r", `/r/auditorias/${sessao}`);
    assert.equal(env.FABRIQUINHA_EXECUCAO, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.deepEqual(
      [env.FABRIQUINHA_ROOT, env.FABRIQUINHA_AUDITORIA, env.GH_CONFIG_DIR],
      ["/r", "1", `/r/auditorias/${sessao}/vazio`],
    );
  } finally {
    delete process.env.FABRIQUINHA_EXECUCAO;
    delete process.env.GH_TOKEN;
  }
});

test("confiança herdada: a decisão mais próxima do repositório (ou de um pai) em trust.json, pelo caminho real", () => {
  const agente = join(base, "agente");
  const repos = join(base, "repos");
  for (const nome of ["confiado", "recusado", "nulo", "solto"]) mkdirSync(join(repos, nome), { recursive: true });
  const link = join(base, "link-confiado");
  symlinkSync(join(repos, "confiado"), link);
  process.env.PI_CODING_AGENT_DIR = agente;
  try {
    assert.equal(confianca(join(repos, "confiado")), undefined, "sem trust.json, vale o padrão do Auditor");
    mkdirSync(agente);
    writeFileSync(
      join(agente, "trust.json"),
      JSON.stringify({ [repos]: false, [join(repos, "confiado")]: true, [join(repos, "nulo")]: null }),
    );
    assert.equal(confianca(link), true);
    assert.equal(confianca(join(repos, "recusado")), false, "herdada do pai");
    assert.equal(confianca(join(repos, "nulo")), false, "null não decide: sobe para o pai");
    assert.equal(confianca(base), undefined, "nenhuma decisão até a raiz");
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
  }
});

test("pi que nem roda: o erro vai para o log, saiu resolve, e enviar e parar não derrubam o serviço", async () => {
  const log = join(base, "log-inexistente");
  process.env.FABRIQUINHA_PI = join(base, "nao-existe");
  try {
    const pi = lancarPi([], { cwd: base, env: process.env, log }, () => undefined);
    pi.enviar({ type: "prompt", message: "oi" });
    assert.equal(await pi.saiu, -2);
    await pi.parar();
    assert.match(readFileSync(log, "utf8"), /pi: spawn .*nao-existe ENOENT/);
  } finally {
    delete process.env.FABRIQUINHA_PI;
  }
});

test("stdout: cada objeto JSON vira evento; texto solto, null e número vão para o log, e o stderr também", async () => {
  const log = join(base, "log-sh");
  process.env.FABRIQUINHA_PI = "/bin/sh";
  try {
    const eventos: unknown[] = [];
    const pi = lancarPi(
      ["-c", 'echo "aviso solto"; echo null; echo 5; echo \'{"type":"agent_settled"}\'; echo erro >&2'],
      { cwd: base, env: process.env, log },
      (e) => eventos.push(e),
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
  process.env.FABRIQUINHA_PI = "/bin/sh";
  try {
    // `cat` só termina no EOF; sem fecharStdin, o pi ficaria preso até o parar().
    const fechado = lancarPi(
      ["-c", "cat >/dev/null"],
      { cwd: base, env: process.env, log, fecharStdin: true },
      () => undefined,
    );
    assert.equal(await fechado.saiu, 0);
    const aberto = lancarPi(["-c", "cat >/dev/null"], { cwd: base, env: process.env, log }, () => undefined);
    const preso = await Promise.race([aberto.saiu, dormir(200, "preso")]);
    assert.equal(preso, "preso");
    await aberto.parar();
  } finally {
    delete process.env.FABRIQUINHA_PI;
  }
});

test("padrões do Auditor: o pi do PATH e o trust.json em ~/.pi/agent", () => {
  const home = join(base, "home");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "trust.json"), JSON.stringify({ [home]: true }));
  const { HOME } = process.env;
  process.env.HOME = home;
  delete process.env.FABRIQUINHA_PI;
  try {
    assert.equal(binarioPi(), "pi");
    assert.equal(confianca(home), true);
  } finally {
    process.env.HOME = HOME;
  }
});
