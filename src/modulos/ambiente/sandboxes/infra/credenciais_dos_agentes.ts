// As credenciais do Claude Code, do pi e do Codex que o container recebe do host (CONCEITOS.md §7). Só o host renova: o
// container recebe uma cópia enxuta, com o token de acesso e a validade, sem o token de renovação, sem entrada que execute
// comando (a `api_key` do pi aceita `!comando`) e sem token do GitHub. Nada que o container grava volta ao host.
// A renovação no host roda o próprio agente, sem gastar token de modelo: `claude auth status` (que só renova nos 5 min
// finais, conferido no Claude Code 2.1.327), `pi auth print-bearer-token --min-expiry` e o `getAuthStatus` do
// `codex app-server` com `refreshToken`.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ambienteSemCredenciais, type InstalacaoDoHarness } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { executar } from "../../../../shared/infra/processo.ts";
import { type Copias, DIR_DO_PI_NO_HOME, PADRAO_DE_TOKEN_DO_GITHUB } from "./gerador_de_ambientes.ts";

export type AgenteComCredencial = "Claude" | "pi" | "Codex";

const MS_POR_MINUTO = 60_000;
/** A folga com que o host renova o token do pi e o do Codex, antes de vencer. */
const FOLGA_DA_RENOVACAO_MS = 30 * MS_POR_MINUTO;
/** O Claude Code só renova nos 5 min finais: antes disso, o `claude auth status` não renova. */
const FOLGA_EM_QUE_O_CLAUDE_RENOVA_MS = 5 * MS_POR_MINUTO;
/**
 * O Codex renova sozinho o token com `last_refresh` de mais de 8 dias; no container, sem token de renovação, essa tentativa
 * falharia. O host renova antes, aos 7.
 */
const IDADE_EM_QUE_O_HOST_RENOVA_O_CODEX_MS = 7 * 24 * 60 * MS_POR_MINUTO;
/** Quanto a renovação de um agente pode levar no host. */
const LIMITE_DA_RENOVACAO_MS = 60_000;
/** O pi do GitHub Copilot guarda o token do GitHub como token de renovação: nunca vai ao container. */
const PROVEDOR_DO_PI_COM_TOKEN_DO_GITHUB = "github-copilot";
const TEM_TOKEN_DO_GITHUB = new RegExp(PADRAO_DE_TOKEN_DO_GITHUB);

/** Um token de acesso que a cópia do container leva: quando vence e quando o host deve renová-lo. */
interface TokenDeAcesso {
  /** O provedor, no pi; a conta (`claude.ai`, `chatgpt`), no Claude e no Codex: o que a renovação e a orientação nomeiam. */
  provedor: string;
  /** Quando o token vence, em ms desde a época. */
  vence_em: number;
  /** A partir de quando o host o renova, em ms desde a época. */
  renovar_em: number;
}

/** A credencial de um agente como o container a recebe. */
interface CredencialParaOContainer {
  agente: AgenteComCredencial;
  /** Onde o agente a lê, relativo ao `HOME` do container. */
  caminho_no_home: string;
  /** O arquivo enxuto, só com o que autentica. */
  conteudo: string;
  /** Os tokens que vencem; a chave de API não vence e não entra aqui. */
  tokens: TokenDeAcesso[];
}

type Objeto = Record<string, unknown>;
const ehObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** O JSON do arquivo do host; o que não existe ou não se lê é `undefined` (o agente fica sem a credencial). */
function jsonDoArquivoDoHost(caminho: string): Objeto | undefined {
  try {
    const conteudo: unknown = JSON.parse(readFileSync(caminho, "utf8"));
    return ehObjeto(conteudo) ? conteudo : undefined;
  } catch {
    return undefined;
  }
}

/** Só os `campos` de `origem` que existem, na ordem dada. */
const soOsCampos = (origem: Objeto, campos: readonly string[]): Objeto =>
  Object.fromEntries(campos.filter((campo) => origem[campo] !== undefined).map((campo) => [campo, origem[campo]]));

/** O `.credentials.json` do Claude Code: o token de acesso do `claudeAiOauth`, sem o `refreshToken`. */
function credencialDoClaude(credenciaisDoHost: Objeto): Omit<CredencialParaOContainer, "agente"> | undefined {
  const oauth = credenciaisDoHost.claudeAiOauth;
  if (!ehObjeto(oauth) || typeof oauth.accessToken !== "string" || typeof oauth.expiresAt !== "number")
    return undefined;
  const credencialEnxuta = {
    claudeAiOauth: soOsCampos(oauth, ["accessToken", "expiresAt", "scopes", "subscriptionType", "rateLimitTier"]),
  };
  return {
    caminho_no_home: ".claude/.credentials.json",
    conteudo: JSON.stringify(credencialEnxuta),
    tokens: [
      {
        provedor: "claude.ai",
        vence_em: oauth.expiresAt,
        renovar_em: oauth.expiresAt - FOLGA_EM_QUE_O_CLAUDE_RENOVA_MS,
      },
    ],
  };
}

/**
 * O `auth.json` do pi: cada entrada OAuth com o token de acesso e o `refresh` vazio (o pi exige a string). A `api_key` fica
 * de fora (o `!comando` dela o pi executa), e o GitHub Copilot também (o `refresh` dele é o token do GitHub).
 */
function credencialDoPi(authDoHost: Objeto): Omit<CredencialParaOContainer, "agente"> {
  const credencialEnxuta: Objeto = {};
  const tokens: TokenDeAcesso[] = [];
  for (const [provedor, credencialDoProvedor] of Object.entries(authDoHost)) {
    if (
      provedor === PROVEDOR_DO_PI_COM_TOKEN_DO_GITHUB ||
      !ehObjeto(credencialDoProvedor) ||
      credencialDoProvedor.type !== "oauth"
    )
      continue;
    if (typeof credencialDoProvedor.access !== "string" || typeof credencialDoProvedor.expires !== "number") continue;
    credencialEnxuta[provedor] = {
      ...soOsCampos(credencialDoProvedor, ["type", "access", "expires", "accountId"]),
      refresh: "",
    };
    tokens.push({
      provedor,
      vence_em: credencialDoProvedor.expires,
      renovar_em: credencialDoProvedor.expires - FOLGA_DA_RENOVACAO_MS,
    });
  }
  return { caminho_no_home: `${DIR_DO_PI_NO_HOME}/auth.json`, conteudo: JSON.stringify(credencialEnxuta), tokens };
}

/** Quando vence o JWT (o `exp` dele); o que não se lê como JWT não diz. */
function vencimentoDoJwt(jwt: string): number | undefined {
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** O `auth.json` do Codex: a chave de API ou os tokens do ChatGPT com o `refresh_token` vazio (o Codex exige o campo). */
function credencialDoCodex(authDoHost: Objeto): Omit<CredencialParaOContainer, "agente"> | undefined {
  const chaveDeApi = typeof authDoHost.OPENAI_API_KEY === "string" ? authDoHost.OPENAI_API_KEY : null;
  const doChatgpt = authDoHost.tokens;
  const comTokens = ehObjeto(doChatgpt) && typeof doChatgpt.access_token === "string";
  if (!comTokens && chaveDeApi === null) return undefined;
  const credencialEnxuta: Objeto = {
    ...soOsCampos(authDoHost, ["auth_mode"]),
    OPENAI_API_KEY: chaveDeApi,
    ...(comTokens
      ? {
          tokens: { ...soOsCampos(doChatgpt, ["id_token", "access_token", "account_id"]), refresh_token: "" },
          ...soOsCampos(authDoHost, ["last_refresh"]),
        }
      : {}),
  };
  const venceEm = comTokens ? vencimentoDoJwt(String(doChatgpt.access_token)) : undefined;
  const ultimaRenovacao = Date.parse(String(authDoHost.last_refresh));
  const renovarPelaIdade = Number.isNaN(ultimaRenovacao)
    ? Infinity
    : ultimaRenovacao + IDADE_EM_QUE_O_HOST_RENOVA_O_CODEX_MS;
  return {
    caminho_no_home: ".codex/auth.json",
    conteudo: JSON.stringify(credencialEnxuta),
    tokens:
      venceEm === undefined
        ? []
        : [
            {
              provedor: "chatgpt",
              vence_em: venceEm,
              renovar_em: Math.min(venceEm - FOLGA_DA_RENOVACAO_MS, renovarPelaIdade),
            },
          ],
  };
}

/**
 * As credenciais do host, enxutas, que o container recebe: a do pi do Auditor e, se o host as tem, a do Claude Code e a
 * do Codex. A que leva token do GitHub não vai (no pi, só a entrada que o leva fica de fora).
 */
export function credenciaisParaOContainer({ dir_do_pi, home_do_usuario }: Copias): CredencialParaOContainer[] {
  const credenciais: CredencialParaOContainer[] = [];
  const authDoPi = jsonDoArquivoDoHost(join(dir_do_pi, "auth.json"));
  if (authDoPi) {
    const semEntradaComTokenDoGithub = Object.fromEntries(
      Object.entries(authDoPi).filter(
        ([, credencialDoProvedor]) => !TEM_TOKEN_DO_GITHUB.test(JSON.stringify(credencialDoProvedor)),
      ),
    );
    credenciais.push({ agente: "pi", ...credencialDoPi(semEntradaComTokenDoGithub) });
  }
  const credenciaisDoClaude = jsonDoArquivoDoHost(join(home_do_usuario, ".claude", ".credentials.json"));
  const doClaude = credenciaisDoClaude && credencialDoClaude(credenciaisDoClaude);
  if (doClaude) credenciais.push({ agente: "Claude", ...doClaude });
  const authDoCodex = jsonDoArquivoDoHost(join(home_do_usuario, ".codex", "auth.json"));
  const doCodex = authDoCodex && credencialDoCodex(authDoCodex);
  if (doCodex) credenciais.push({ agente: "Codex", ...doCodex });
  return credenciais.filter(({ agente, conteudo }) => agente === "pi" || !TEM_TOKEN_DO_GITHUB.test(conteudo));
}

/** Como o operador entra de novo no agente, no host: a orientação de quando a renovação não basta. */
export function comoEntrarNoHost(agente: AgenteComCredencial, provedor: string): string {
  if (agente === "Claude") return "claude auth login";
  if (agente === "pi") return `pi auth login ${provedor}`;
  return "codex login";
}

/** O que a renovação no host precisa saber: as pastas das credenciais e a instalação do pi do Auditor. */
export interface HostDasCredenciais {
  copias: Copias;
  instalacaoDoPi: () => InstalacaoDoHarness;
}

/** Uma linha do `codex app-server`: a resposta JSON-RPC, ou `undefined` para o que não é JSON. */
function respostaDoAppServer(linha: string): { id?: unknown; error?: unknown } | undefined {
  try {
    return JSON.parse(linha) as { id?: unknown; error?: unknown };
  } catch {
    return undefined;
  }
}

/**
 * Pergunta ao `codex app-server` (JSON-RPC no stdin) o `getAuthStatus` com `refreshToken`, que renova o token no host, e
 * espera a resposta: o app-server sai assim que o stdin fecha, antes de responder, então o stdin fica aberto até ela.
 */
function renovarOCodexPeloAppServer(env: Record<string, string>, limiteMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const appServer = spawn("codex", ["app-server"], { env, stdio: ["pipe", "pipe", "ignore"] }); // NOSONAR
    const relogio = setTimeout(() => appServer.kill(), limiteMs);
    const encerrar = (renovou: boolean) => {
      clearTimeout(relogio);
      appServer.kill();
      resolve(renovou); // a segunda chamada (o `close` depois da resposta) não muda o resultado
    };
    const encerrarSemRenovar = () => {
      encerrar(false);
    };
    createInterface({ input: appServer.stdout }).on("line", (linha) => {
      const respostaJsonRpc = respostaDoAppServer(linha);
      if (respostaJsonRpc?.id === 2) encerrar(respostaJsonRpc.error === undefined);
    });
    // Sem o codex, o `spawn` falha e a escrita no stdin também; o processo que sai sem responder não renovou.
    appServer.on("error", encerrarSemRenovar);
    appServer.stdin.on("error", encerrarSemRenovar);
    appServer.on("close", encerrarSemRenovar);
    appServer.stdin.write(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "fabriquinha", version: "1" } } },
        { jsonrpc: "2.0", method: "initialized" },
        { jsonrpc: "2.0", id: 2, method: "getAuthStatus", params: { includeToken: false, refreshToken: true } },
      ]
        .map((pedido) => `${JSON.stringify(pedido)}\n`)
        .join(""),
    );
  });
}

/**
 * Renova no host o token do `provedor` do agente, sem o env do serviço (as credenciais de hospedagem e do SonarQube ficam
 * de fora, como no pi do Auditor). Diz se o agente terminou bem; o que ele imprime (o pi imprime o token) é descartado.
 */
export async function renovarNoHost(
  agente: AgenteComCredencial,
  provedor: string,
  { copias, instalacaoDoPi }: HostDasCredenciais,
  limiteMs = LIMITE_DA_RENOVACAO_MS,
): Promise<boolean> {
  const env = {
    ...ambienteSemCredenciais(process.env, join(tmpdir(), "fabriquinha-vazio")),
    HOME: copias.home_do_usuario,
  };
  if (agente === "Codex")
    return renovarOCodexPeloAppServer({ ...env, CODEX_HOME: join(copias.home_do_usuario, ".codex") }, limiteMs);
  const [programa, argumentos, envDoAgente] =
    agente === "Claude"
      ? ["claude", ["auth", "status", "--json"], env]
      : [
          instalacaoDoPi().executavel,
          [
            "auth",
            "print-bearer-token",
            "--provider",
            provedor,
            "--min-expiry",
            `${String(FOLGA_DA_RENOVACAO_MS / MS_POR_MINUTO)}m`,
          ],
          { ...env, PI_CODING_AGENT_DIR: copias.dir_do_pi },
        ];
  try {
    const { codigo } = await executar(programa, argumentos, { env: envDoAgente, limiteMs });
    return codigo === 0;
  } catch {
    return false;
  }
}
