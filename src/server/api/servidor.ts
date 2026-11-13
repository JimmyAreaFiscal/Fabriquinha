// Servidor web do F7 §4.1: o token de cada subida em `<raiz>/web.url`, a entrada pelo link, a guarda de toda
// requisição, os estáticos do cliente, o `index.html` das páginas e o despacho das rotas da API (o contrato em rotas.ts, as de cada tela em rotas/).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { GestaoDeDemandas } from "../../modulos/demandas/publico.ts";
import type { Relogio } from "../../shared/nucleo/relogio.ts";
import { casar } from "../web/compartilhado/caminhos.ts";
import { autenticarAgente } from "./agente/autenticacao.ts";
import { rotasDeEvidenciaAdd } from "./agente/evidencia.ts";
import { erroDaApiDoAgente, PREFIXO_DA_API_DO_AGENTE, type RotaDoAgente, rotasDoAgente } from "./agente/rotas.ts";
import { ErroHttp, traduzir } from "./erros.ts";
import type { Agendador, AmbientesDoServico, Rota } from "./rotas.ts";
import { ROTAS_DO_CHAT } from "./rotas/sessoes/chat.ts";
import { ROTAS_DA_CONFIGURACAO } from "./rotas/configuracao.ts";
import { ROTAS_DAS_ETAPAS } from "./rotas/etapas.ts";
import { ROTAS_DAS_DEMANDAS } from "./rotas/demandas/demandas.ts";
import { ROTAS_DAS_ACOES_DE_DEMANDA } from "./rotas/demandas/demandas_acoes.ts";
import { ROTAS_DO_HISTORICO } from "./rotas/sessoes/historico.ts";
import { ROTAS_DO_INICIO } from "./rotas/inicio.ts";
import { ROTAS_DAS_METRICAS } from "./rotas/metricas.ts";
import { ROTAS_DO_PROJETO } from "./rotas/projeto/projeto.ts";
import { ROTAS_DA_CONFIGURACAO_SDLC } from "./rotas/projeto/sdlc.ts";

/** A tabela das rotas da API (F7 §4.2), uma lista por tela. */
/** @testes o teste do servidor confere a tabela de rotas */
export const ROTAS: Rota[] = [
  ...ROTAS_DO_INICIO,
  ...ROTAS_DAS_ETAPAS,
  ...ROTAS_DO_HISTORICO,
  ...ROTAS_DA_CONFIGURACAO,
  ...ROTAS_DA_CONFIGURACAO_SDLC,
  ...ROTAS_DAS_DEMANDAS,
  ...ROTAS_DAS_ACOES_DE_DEMANDA,
  ...ROTAS_DO_CHAT,
  ...ROTAS_DO_PROJETO,
  ...ROTAS_DAS_METRICAS,
];

/** As rotas de /api/agente/*: fora de `ROTAS`, porque entram com o token do processo e não com o cookie do navegador. */
const ROTAS_DO_AGENTE: RotaDoAgente[] = [...rotasDoAgente(), ...rotasDeEvidenciaAdd()];

const CLIENTE = join(import.meta.dirname, "../web");
const COOKIE = "fabriquinha";
const LIMITE_DO_JSON = { bytes: 64 * 1024, texto: "64 KiB" };
// Os `dados` da evidência do agente; o anexo vai em pedido próprio, em fluxo (rotas.ts, `corpoEmFluxo`).
const LIMITE_DO_JSON_DO_AGENTE = { bytes: 5 * 1024 * 1024, texto: "5 MiB" };

/** Os tipos servidos em `/static/*`. O cliente é TypeScript: o navegador recebe o JavaScript sem os tipos. */
const TIPOS: Record<string, string> = {
  ".ts": "text/javascript; charset=utf-8",
  ".tsx": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * Os arquivos que o navegador pode pedir, com o caminho e o tipo: os de `web/` (o `compartilhado/` com o servidor
 * inclusive) dos tipos acima, sem testes, e o `markdown-it` do navegador.
 */
const ESTATICOS = new Map([
  ...readdirSync(CLIENTE, { recursive: true, encoding: "utf8" }).flatMap((arquivo) => {
    const tipo = TIPOS[extname(arquivo)];
    return tipo && !arquivo.endsWith(".test.ts") ? [[arquivo, [join(CLIENTE, arquivo), tipo]] as const] : [];
  }),
  ["markdown-it.js", [fileURLToPath(import.meta.resolve("markdown-it/browser")), "text/javascript; charset=utf-8"]],
]);

function enviar(resposta: ServerResponse, status: number, tipo: string, corpo: string | Buffer): void {
  resposta.writeHead(status, { "Content-Type": tipo }).end(corpo);
}

const json = (resposta: ServerResponse, status: number, valor: unknown): void => {
  enviar(resposta, status, "application/json; charset=utf-8", JSON.stringify(valor));
};

/**
 * O corpo da mutação: JSON, até 64 KiB; vazio é `undefined`. Corpo grande demais ou JSON inválido é corpo inválido (422).
 * ponytail: o corpo grande demais é lido até o fim e descartado, para a resposta chegar ao cliente.
 */
async function lerCorpo(pedido: IncomingMessage, limite = LIMITE_DO_JSON): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of pedido as AsyncIterable<Buffer>) {
    tamanho += parte.length;
    if (tamanho <= limite.bytes) partes.push(parte);
  }
  if (tamanho > limite.bytes) throw new ErroHttp(422, `o corpo passa de ${limite.texto}`);
  const texto = Buffer.concat(partes).toString("utf8");
  if (texto === "") return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroHttp(422, "o corpo não é JSON válido");
  }
}

/**
 * Os `.tsx` empacotados (React e assistant-ui dentro), por arquivo: montados no primeiro pedido.
 * ponytail: guardado até o servidor cair; editar o `.tsx` exige reiniciar o servidor.
 */
const PACOTES = new Map<string, Promise<string>>();

function empacotar(arquivo: string): Promise<string> {
  let pacote = PACOTES.get(arquivo);
  if (pacote === undefined) {
    pacote = build({
      entryPoints: [arquivo],
      bundle: true,
      format: "esm",
      jsx: "automatic",
      minify: true,
      write: false,
      external: ["markdown-it/browser"],
      define: { "process.env.NODE_ENV": '"production"' },
    }).then(({ outputFiles }) => String(outputFiles[0]?.text));
    PACOTES.set(arquivo, pacote);
  }
  return pacote;
}

/** Um arquivo de `/static/`: o cliente, sem os tipos (o `.tsx` empacotado), e o `markdown-it`. */
async function estatico(caminho: string, resposta: ServerResponse): Promise<void> {
  const nome = caminho.slice("/static/".length);
  const achado = ESTATICOS.get(nome);
  if (achado === undefined) throw new ErroHttp(404, `${caminho} não existe`);
  const [arquivo, tipo] = achado;
  if (nome.endsWith(".tsx")) {
    enviar(resposta, 200, tipo, await empacotar(arquivo));
    return;
  }
  const conteudo = readFileSync(arquivo);
  enviar(resposta, 200, tipo, nome.endsWith(".ts") ? stripTypeScriptTypes(conteudo.toString()) : conteudo);
}
/** O valor do cookie `fabriquinha`, se veio. */
const cookie = (pedido: IncomingMessage): string | undefined =>
  pedido.headers.cookie
    ?.split(";")
    .map((par) => par.trim())
    .find((par) => par.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

interface Web {
  banco: DatabaseSync;
  /** A pasta de dados do serviço, onde vai o `web.url`. */
  raiz: string;
  porta: number;
  agendador: Agendador;
  ambientes: AmbientesDoServico;
  demandas: GestaoDeDemandas;
  relogio: Relogio;
  /** O log do serviço para o erro 500 (a composição entrega o `noLog` com o relógio dela). */
  registrarErro: (erro: unknown) => void;
  /** As rotas do agente; os testes trocam os casos de uso por espiões. */
  rotasDoAgente?: RotaDoAgente[];
}

/**
 * Gera o token desta subida (32 bytes aleatórios), grava o link de entrada em `<raiz>/web.url` com `0600` e devolve o
 * tratador das requisições. Reiniciar o serviço troca o token e invalida o cookie dos navegadores.
 */
export function servirWeb({
  banco,
  raiz,
  porta,
  agendador,
  ambientes,
  demandas,
  relogio,
  registrarErro,
  rotasDoAgente: rotasDaApiDoAgente = ROTAS_DO_AGENTE,
}: Web): RequestListener {
  const token = Buffer.from(randomBytes(32).toString("base64url"));
  const origem = `127.0.0.1:${String(porta)}`;
  const arquivo = join(raiz, "web.url");
  // Escrito ao lado e renomeado: quem lê nunca vê o arquivo vazio ou pela metade. O temporário é recriado: o modo só
  // vale na criação.
  const temporario = `${arquivo}.novo`;
  rmSync(temporario, { force: true });
  writeFileSync(temporario, `http://${origem}/entrar?token=${token.toString()}`, { mode: 0o600 });
  renameSync(temporario, arquivo);

  /** Compara em tempo constante; o tamanho diferente sai antes, sem revelar nada do token. */
  const confere = (valor: string | null | undefined): boolean => {
    const recebido = Buffer.from(valor ?? "");
    return recebido.length === token.length && timingSafeEqual(recebido, token);
  };

  /** A guarda do F7 §4.1, na ordem da tabela: `Host`, cookie nas rotas de dado, `Sec-Fetch-Site` na mutação. */
  function guardar(pedido: IncomingMessage, caminho: string, mutacao: boolean): void {
    // O agente não é um navegador: a guarda dele é o token do processo (`autenticarAgente`), em qualquer `Host`.
    if (caminho.startsWith(PREFIXO_DA_API_DO_AGENTE)) return;
    if (pedido.headers.host !== origem) throw new ErroHttp(403, `só ${origem} é atendido`);
    const dado = caminho.startsWith("/api/") || caminho.startsWith("/arquivos/");
    if (dado && !confere(cookie(pedido))) {
      throw new ErroHttp(401, "o navegador não entrou nesta Fabriquinha (rode fabriquinha abrir)");
    }
    if (mutacao && pedido.headers["sec-fetch-site"] !== "same-origin") {
      throw new ErroHttp(403, "mutação só da própria página da Fabriquinha (Sec-Fetch-Site: same-origin)");
    }
  }

  /** `GET /entrar?token=`: com o token certo, grava o cookie; com qualquer outro, a página pede o `abrir`. */
  function entrar(url: URL, resposta: ServerResponse): void {
    if (confere(url.searchParams.get("token"))) {
      resposta.setHeader("Set-Cookie", `${COOKIE}=${token.toString()}; HttpOnly; SameSite=Strict; Path=/`);
    }
    resposta.writeHead(303, { Location: "/home" }).end();
  }

  async function api(pedido: IncomingMessage, url: URL, resposta: ServerResponse, corpo: unknown): Promise<void> {
    for (const rota of ROTAS) {
      const params = rota.metodo === pedido.method ? casar(rota.caminho, url.pathname) : undefined;
      if (!params) continue;
      const valor: unknown = await rota.tratar({
        banco,
        agendador,
        ambientes,
        demandas,
        relogio,
        params,
        query: url.searchParams,
        corpo,
        cabecalhos: pedido.headers,
        resposta,
      });
      if (resposta.headersSent) return;
      if (valor === undefined) resposta.writeHead(204).end();
      else json(resposta, 200, valor);
      return;
    }
    throw new ErroHttp(404, `${String(pedido.method)} ${url.pathname} não existe`);
  }

  /** `/api/agente/*`: o token vem antes do corpo, para quem não o tem não fazer o serviço ler o pedido. */
  async function apiDoAgente(pedido: IncomingMessage, url: URL, resposta: ServerResponse): Promise<void> {
    const agente = autenticarAgente(banco, pedido.headers);
    for (const rota of rotasDaApiDoAgente) {
      const params = rota.metodo === pedido.method ? casar(rota.caminho, url.pathname) : undefined;
      if (!params) continue;
      let corpo: unknown;
      if (rota.corpoEmFluxo) corpo = pedido;
      else if (rota.metodo === "POST") corpo = await lerCorpo(pedido, LIMITE_DO_JSON_DO_AGENTE);
      json(resposta, 200, await rota.tratar({ banco, relogio, agente, params, query: url.searchParams, corpo }));
      return;
    }
    throw new ErroHttp(404, `${String(pedido.method)} ${url.pathname} não existe`);
  }

  async function atender(pedido: IncomingMessage, resposta: ServerResponse): Promise<void> {
    resposta.setHeader("X-Content-Type-Options", "nosniff");
    // No servidor, `url` sempre vem: o tipo opcional é do cliente.
    const url = new URL(String(pedido.url), `http://${origem}`);
    const caminho = url.pathname;
    const mutacao = pedido.method !== "GET" && pedido.method !== "HEAD";
    guardar(pedido, caminho, mutacao);
    if (caminho.startsWith(PREFIXO_DA_API_DO_AGENTE)) {
      await apiDoAgente(pedido, url, resposta);
      return;
    }
    if (caminho.startsWith("/api/") || caminho.startsWith("/arquivos/")) {
      await api(pedido, url, resposta, mutacao ? await lerCorpo(pedido) : undefined);
      return;
    }
    if (pedido.method !== "GET") throw new ErroHttp(404, `${String(pedido.method)} ${caminho} não existe`);
    if (caminho === "/entrar") entrar(url, resposta);
    else if (caminho.startsWith("/static/")) await estatico(caminho, resposta);
    // Toda outra página: o cliente escolhe a tela pelo caminho (F7 §4.4).
    else enviar(resposta, 200, "text/html; charset=utf-8", readFileSync(join(CLIENTE, "index.html")));
  }

  return (pedido, resposta) => {
    atender(pedido, resposta).catch((error_: unknown) => {
      const [status, mensagem] = traduzir(error_);
      if (status === 500) registrarErro(error_);
      // A rota que já começou a responder (SSE, download) e falhou no meio só pode cortar a conexão.
      if (resposta.headersSent) resposta.destroy();
      else if (String(pedido.url).startsWith(PREFIXO_DA_API_DO_AGENTE))
        json(resposta, status, erroDaApiDoAgente(mensagem));
      else json(resposta, status, { erro: mensagem });
    });
  };
}
