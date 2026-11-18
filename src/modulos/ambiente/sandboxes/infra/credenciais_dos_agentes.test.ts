import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { comoEntrarNoHost, credenciaisParaOContainer, renovarNoHost } from "./credenciais_dos_agentes.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-credenciais-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const MINUTO = 60_000;
const AGORA = Date.parse("2026-11-18T12:00:00Z");
const TOKEN_DO_GITHUB = `gho_${"a1B2".repeat(9)}`;

/** Um JWT (sem assinatura que valha) com o `exp` dado, como o token de acesso do Codex. */
const jwtQueVenceEm = (venceEmMs: number) =>
  `cabecalho.${Buffer.from(JSON.stringify({ exp: venceEmMs / 1000 })).toString("base64url")}.assinatura`;

let ultimoHost = 0;
/** Um host com os arquivos de credencial dados (relativos ao home; o do pi em `pi/auth.json`). */
function hostCom(arquivos: Record<string, unknown>) {
  const home = join(base, `home-${String(++ultimoHost)}`);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(home, caminho, ".."), { recursive: true });
    writeFileSync(join(home, caminho), typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  }
  return { dir_do_pi: join(home, "pi"), home_do_usuario: home };
}

const conteudoDe = (copias: ReturnType<typeof hostCom>, agente: string) =>
  JSON.parse(
    credenciaisParaOContainer(copias).find((credencial) => credencial.agente === agente)?.conteudo ?? "null",
  ) as unknown;

test("a credencial do Claude vai só com o token de acesso e a validade: sem o refreshToken nem o resto da conta", () => {
  const venceEm = AGORA + 8 * 60 * MINUTO;
  const copias = hostCom({
    ".claude/.credentials.json": {
      claudeAiOauth: {
        accessToken: "acesso-do-claude",
        refreshToken: "renovacao-do-claude",
        refreshTokenExpiresAt: venceEm * 2,
        expiresAt: venceEm,
        scopes: ["user:inference"],
        subscriptionType: "max",
        rateLimitTier: "padrao",
        accountUuid: "conta",
      },
    },
  });
  const claude = credenciaisParaOContainer(copias).at(0);
  assert.deepEqual(
    { ...claude, conteudo: JSON.parse(claude?.conteudo ?? "") as unknown },
    {
      agente: "Claude",
      caminho_no_home: ".claude/.credentials.json",
      conteudo: {
        claudeAiOauth: {
          accessToken: "acesso-do-claude",
          expiresAt: venceEm,
          scopes: ["user:inference"],
          subscriptionType: "max",
          rateLimitTier: "padrao",
        },
      },
      // O Claude Code só renova nos 5 min finais.
      tokens: [{ provedor: "claude.ai", vence_em: venceEm, renovar_em: venceEm - 5 * MINUTO }],
    },
  );
});

test("a credencial do pi vai só com as entradas OAuth, com o refresh vazio; a api_key (que roda !comando) e o GitHub Copilot ficam de fora", () => {
  const venceEm = AGORA + 60 * MINUTO;
  const copias = hostCom({
    "pi/auth.json": {
      "openai-codex": { type: "oauth", access: "acesso", refresh: "renovacao", expires: venceEm, accountId: "conta" },
      anthropic: { type: "oauth", access: "acesso-velho", refresh: "renovacao-velha", expires: AGORA - MINUTO },
      maligno: { type: "api_key", key: "!touch /tmp/pwned" },
      "github-copilot": { type: "oauth", access: "acesso-do-copilot", refresh: TOKEN_DO_GITHUB, expires: venceEm },
      "com-token-do-github": { type: "oauth", access: TOKEN_DO_GITHUB, refresh: "r", expires: venceEm },
      "sem-validade": { type: "oauth", access: "acesso" },
      "sem-acesso": { type: "oauth", expires: venceEm },
      quebrado: "não é objeto",
    },
  });
  const pi = credenciaisParaOContainer(copias).at(0);
  assert.equal(pi?.caminho_no_home, ".pi/agent/auth.json");
  assert.deepEqual(JSON.parse(pi.conteudo), {
    "openai-codex": { type: "oauth", access: "acesso", expires: venceEm, accountId: "conta", refresh: "" },
    anthropic: { type: "oauth", access: "acesso-velho", expires: AGORA - MINUTO, refresh: "" },
  });
  assert.doesNotMatch(pi.conteudo, /renovacao|pwned|copilot|gho_/);
  assert.deepEqual(pi.tokens, [
    { provedor: "openai-codex", vence_em: venceEm, renovar_em: venceEm - 30 * MINUTO },
    { provedor: "anthropic", vence_em: AGORA - MINUTO, renovar_em: AGORA - 31 * MINUTO },
  ]);
});

test("a credencial do Codex vai com o refresh_token vazio (o Codex exige o campo); a renovação vem 30 min antes de vencer ou aos 7 dias do last_refresh", () => {
  const venceEm = AGORA + 3 * 24 * 60 * MINUTO;
  const ultimaRenovacao = AGORA - 6 * 24 * 60 * MINUTO;
  const copias = hostCom({
    ".codex/auth.json": {
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "identidade",
        access_token: jwtQueVenceEm(venceEm),
        refresh_token: "renovacao-do-codex",
        account_id: "conta",
      },
      last_refresh: new Date(ultimaRenovacao).toISOString(),
    },
  });
  assert.deepEqual(conteudoDe(copias, "Codex"), {
    OPENAI_API_KEY: null,
    tokens: { id_token: "identidade", access_token: jwtQueVenceEm(venceEm), account_id: "conta", refresh_token: "" },
    last_refresh: new Date(ultimaRenovacao).toISOString(),
  });
  const codex = credenciaisParaOContainer(copias).find(({ agente }) => agente === "Codex");
  assert.equal(codex?.caminho_no_home, ".codex/auth.json");
  assert.deepEqual(codex.tokens, [
    { provedor: "chatgpt", vence_em: venceEm, renovar_em: ultimaRenovacao + 7 * 24 * 60 * MINUTO },
  ]);
  // Sem last_refresh, só a validade do token decide.
  const semUltimaRenovacao = hostCom({ ".codex/auth.json": { tokens: { access_token: jwtQueVenceEm(venceEm) } } });
  assert.deepEqual(credenciaisParaOContainer(semUltimaRenovacao).find(({ agente }) => agente === "Codex")?.tokens, [
    { provedor: "chatgpt", vence_em: venceEm, renovar_em: venceEm - 30 * MINUTO },
  ]);
});

test("a chave de API do Codex vai sem token que vença; o token que não é JWT, ou sem exp, também não vence", () => {
  const comChave = hostCom({ ".codex/auth.json": { auth_mode: "apikey", OPENAI_API_KEY: "sk-chave" } });
  assert.deepEqual(conteudoDe(comChave, "Codex"), { auth_mode: "apikey", OPENAI_API_KEY: "sk-chave" });
  assert.deepEqual(credenciaisParaOContainer(comChave).at(0)?.tokens, []);
  for (const tokenQueNaoVence of ["sem-ponto", `a.${Buffer.from("{}").toString("base64url")}.b`]) {
    const copias = hostCom({ ".codex/auth.json": { tokens: { access_token: tokenQueNaoVence } } });
    assert.deepEqual(credenciaisParaOContainer(copias).at(0)?.tokens, []);
  }
});

test("o arquivo que não existe, não é JSON ou não tem a credencial não vai; a credencial com token do GitHub também não", () => {
  assert.deepEqual(credenciaisParaOContainer(hostCom({})), []);
  const semCredencial = hostCom({
    "pi/auth.json": "não é json",
    ".claude/.credentials.json": { claudeAiOauth: { accessToken: "sem-validade" } },
    ".codex/auth.json": { tokens: "não é objeto" },
  });
  assert.deepEqual(credenciaisParaOContainer(semCredencial), []);
  const pastaNoLugarDoArquivo = hostCom({ ".claude/.credentials.json/x": "{}", "pi/auth.json": "[]" });
  assert.deepEqual(credenciaisParaOContainer(pastaNoLugarDoArquivo), []);
  const comTokenDoGithub = hostCom({
    ".claude/.credentials.json": { claudeAiOauth: { accessToken: TOKEN_DO_GITHUB, expiresAt: AGORA } },
    ".codex/auth.json": { OPENAI_API_KEY: TOKEN_DO_GITHUB },
  });
  assert.deepEqual(credenciaisParaOContainer(comTokenDoGithub), []);
});

test("a orientação de login nomeia o comando de cada agente", () => {
  assert.equal(comoEntrarNoHost("Claude", "claude.ai"), "claude auth login");
  assert.equal(comoEntrarNoHost("pi", "openai-codex"), "pi auth login openai-codex");
  assert.equal(comoEntrarNoHost("Codex", "chatgpt"), "codex login");
});

/** Os agentes falsos do host: gravam o que receberam (argumentos e env) e saem com o código pedido. */
const bin = join(base, "bin");
const registro = join(base, "registro.jsonl");
mkdirSync(bin);
const registrarChamada = `require("node:fs").appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ argumentos: process.argv.slice(2), HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, CODEX_HOME: process.env.CODEX_HOME, GH_TOKEN: process.env.GH_TOKEN }) + "\\n");`;
function instalarAgenteFalso(nome: string, corpo: string): string {
  const caminho = join(bin, nome);
  writeFileSync(caminho, `#!/usr/bin/env node\n${registrarChamada}\n${corpo}\n`);
  chmodSync(caminho, 0o755);
  return caminho;
}
instalarAgenteFalso("claude", "process.exit(Number(process.env.CODIGO_DO_AGENTE_FALSO ?? 0));");
const piFalso = instalarAgenteFalso(
  "pi",
  'console.log("token-que-nunca-sai"); process.exit(Number(process.env.CODIGO_DO_AGENTE_FALSO ?? 0));',
);
// O app-server falso responde a cada pedido conforme o modo: certo, com erro, com lixo, calado ou saindo sem responder.
instalarAgenteFalso(
  "codex",
  `const modo = process.env.MODO_DO_CODEX_FALSO;
if (modo === "sai") process.exit(0);
require("node:readline").createInterface({ input: process.stdin }).on("line", (linha) => {
  const { id } = JSON.parse(linha);
  if (id === undefined || modo === "calado") return;
  if (modo === "lixo") console.log("isto não é JSON");
  console.log(JSON.stringify(modo === "erro" && id === 2 ? { id, error: { message: "falhou" } } : { id, result: {} }));
});`,
);
const caminhoOriginal = process.env.PATH;
const chamadas = () =>
  readFileSync(registro, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((linha) => JSON.parse(linha) as Record<string, unknown>);

/** Roda `trabalho` com o PATH dos agentes falsos e as variáveis dadas, e devolve o que eles registraram. */
async function comAgentesFalsos<T>(variaveis: Record<string, string>, trabalho: () => Promise<T>) {
  writeFileSync(registro, "");
  process.env.PATH = `${bin}:${caminhoOriginal ?? ""}`;
  Object.assign(process.env, variaveis);
  try {
    return { resultado: await trabalho(), chamadas: chamadas() };
  } finally {
    process.env.PATH = caminhoOriginal;
    for (const nome of Object.keys(variaveis)) Reflect.deleteProperty(process.env, nome);
  }
}

const host = {
  copias: { dir_do_pi: join(base, "pi-do-host"), home_do_usuario: join(base, "home-do-host") },
  instalacaoDoPi: () => ({ comando: "pi", executavel: piFalso, raiz: bin }),
};

test("renovarNoHost roda claude auth status, no home do usuário e sem o env de hospedagem do serviço", async () => {
  const { resultado, chamadas: feitas } = await comAgentesFalsos({ GH_TOKEN: "do-servico" }, () =>
    renovarNoHost("Claude", "claude.ai", host),
  );
  assert.equal(resultado, true);
  assert.deepEqual(
    feitas.map(({ argumentos, HOME, GH_TOKEN }) => ({ argumentos, HOME, GH_TOKEN })),
    [{ argumentos: ["auth", "status", "--json"], HOME: host.copias.home_do_usuario, GH_TOKEN: undefined }],
  );
  const falhou = await comAgentesFalsos({ CODIGO_DO_AGENTE_FALSO: "1" }, () =>
    renovarNoHost("Claude", "claude.ai", host),
  );
  assert.equal(falhou.resultado, false);
});

test("renovarNoHost roda o pi do Auditor com --min-expiry de 30 min, na pasta dele, e descarta o token impresso", async () => {
  const { resultado, chamadas: feitas } = await comAgentesFalsos({}, () => renovarNoHost("pi", "openai-codex", host));
  assert.equal(resultado, true);
  assert.deepEqual(
    feitas.map(({ argumentos, HOME, PI_CODING_AGENT_DIR }) => ({ argumentos, HOME, PI_CODING_AGENT_DIR })),
    [
      {
        argumentos: ["auth", "print-bearer-token", "--provider", "openai-codex", "--min-expiry", "30m"],
        HOME: host.copias.home_do_usuario,
        PI_CODING_AGENT_DIR: host.copias.dir_do_pi,
      },
    ],
  );
  const semPi = await comAgentesFalsos({}, () =>
    renovarNoHost("pi", "openai-codex", {
      ...host,
      instalacaoDoPi: () => ({ comando: "pi", executavel: join(base, "nao-existe"), raiz: bin }),
    }),
  );
  assert.equal(semPi.resultado, false);
});

test("renovarNoHost pede ao codex app-server o getAuthStatus com refreshToken e espera a resposta", async () => {
  const { resultado, chamadas: feitas } = await comAgentesFalsos({}, () => renovarNoHost("Codex", "chatgpt", host));
  assert.equal(resultado, true);
  assert.deepEqual(
    feitas.map(({ argumentos, HOME, CODEX_HOME }) => ({ argumentos, HOME, CODEX_HOME })),
    [
      {
        argumentos: ["app-server"],
        HOME: host.copias.home_do_usuario,
        CODEX_HOME: join(host.copias.home_do_usuario, ".codex"),
      },
    ],
  );
  for (const modo of ["erro", "sai"])
    assert.equal(
      (await comAgentesFalsos({ MODO_DO_CODEX_FALSO: modo }, () => renovarNoHost("Codex", "chatgpt", host))).resultado,
      false,
      modo,
    );
  assert.equal(
    (await comAgentesFalsos({ MODO_DO_CODEX_FALSO: "lixo" }, () => renovarNoHost("Codex", "chatgpt", host))).resultado,
    true,
  );
  const calado = await comAgentesFalsos({ MODO_DO_CODEX_FALSO: "calado" }, () =>
    renovarNoHost("Codex", "chatgpt", host, 300),
  );
  assert.equal(calado.resultado, false);
  // Sem o codex no PATH, a renovação só não acontece.
  process.env.PATH = "/nao-existe";
  try {
    assert.equal(await renovarNoHost("Codex", "chatgpt", host), false);
  } finally {
    process.env.PATH = caminhoOriginal;
  }
});
