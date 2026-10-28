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
import { raizDo } from "../persistencia/banco.ts";
import { noLog } from "../persistencia/execucoes.ts";
import { casar } from "./cliente/caminhos.ts";
import { ErroHttp, traduzir } from "./erros.ts";
import type { Agendador, Rota } from "./rotas.ts";
import { ROTAS_DAS_AVALIACOES } from "./rotas/avaliacoes.ts";
import { ROTAS_DO_CHAT } from "./rotas/chat.ts";
import { ROTAS_DA_CONFIGURACAO } from "./rotas/configuracao.ts";
import { ROTAS_DAS_DEMANDAS } from "./rotas/demandas.ts";
import { ROTAS_DAS_ACOES_DE_DEMANDA } from "./rotas/demandas_acoes.ts";
import { ROTAS_DO_HISTORICO } from "./rotas/historico.ts";
import { ROTAS_DAS_METRICAS } from "./rotas/metricas.ts";
import { ROTAS_DO_PROJETO } from "./rotas/projeto.ts";
import { ROTAS_DA_CONFIGURACAO_SDLC } from "./rotas/sdlc.ts";
import { ROTAS_DA_SIMULACAO } from "./rotas/simulacao.ts";

/** A tabela das rotas da API (F7 §4.2), uma lista por tela. */
export const ROTAS: Rota[] = [
  ...ROTAS_DO_HISTORICO,
  ...ROTAS_DA_CONFIGURACAO,
  ...ROTAS_DA_CONFIGURACAO_SDLC,
  ...ROTAS_DAS_DEMANDAS,
  ...ROTAS_DAS_ACOES_DE_DEMANDA,
  ...ROTAS_DO_CHAT,
  ...ROTAS_DAS_AVALIACOES,
  ...ROTAS_DO_PROJETO,
  ...ROTAS_DAS_METRICAS,
  ...ROTAS_DA_SIMULACAO,
];

const CLIENTE = join(import.meta.dirname, "cliente");
const COOKIE = "fabriquinha";
const LIMITE_DO_JSON = { bytes: 64 * 1024, texto: "64 KiB" };
const LIMITE_DO_ANEXO = { bytes: 20 * 1024 * 1024, texto: "20 MiB" };

/** Os tipos servidos em `/static/*`. O cliente é TypeScript: o navegador recebe o JavaScript sem os tipos. */
const TIPOS: Record<string, string> = {
  ".ts": "text/javascript; charset=utf-8",
  ".tsx": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * Os arquivos que o navegador pode pedir, com o caminho e o tipo: os de `cliente/` dos tipos acima, sem testes, e o
 * `markdown-it` do navegador, que o import map do `index.html` resolve.
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
 * O corpo da mutação. `application/octet-stream` é o anexo (F8 §2): os bytes, num `Buffer`, até 20 MiB. Qualquer outro
 * é JSON, até 64 KiB; vazio é `undefined`. Corpo grande demais ou JSON inválido é corpo inválido (422).
 * ponytail: o corpo grande demais é lido até o fim e descartado, para a resposta chegar ao cliente.
 */
async function lerCorpo(pedido: IncomingMessage): Promise<unknown> {
  const binario = pedido.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/octet-stream";
  const limite = binario ? LIMITE_DO_ANEXO : LIMITE_DO_JSON;
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of pedido as AsyncIterable<Buffer>) {
    tamanho += parte.length;
    if (tamanho <= limite.bytes) partes.push(parte);
  }
  if (tamanho > limite.bytes) throw new ErroHttp(422, `o corpo passa de ${limite.texto}`);
  const todo = Buffer.concat(partes);
  if (binario) return todo;
  const texto = todo.toString("utf8");
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

export interface Web {
  banco: DatabaseSync;
  porta: number;
  agendador: Agendador;
}

/**
 * Gera o token desta subida (32 bytes aleatórios), grava o link de entrada em `<raiz>/web.url` com `0600` e devolve o
 * tratador das requisições. Reiniciar o serviço troca o token e invalida o cookie dos navegadores.
 */
export function servirWeb({ banco, porta, agendador }: Web): RequestListener {
  const token = Buffer.from(randomBytes(32).toString("base64url"));
  const origem = `127.0.0.1:${String(porta)}`;
  const arquivo = join(raizDo(banco), "web.url");
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
    resposta.writeHead(303, { Location: "/demandas" }).end();
  }

  async function api(pedido: IncomingMessage, url: URL, resposta: ServerResponse, corpo: unknown): Promise<void> {
    for (const rota of ROTAS) {
      const params = rota.metodo === pedido.method ? casar(rota.caminho, url.pathname) : undefined;
      if (!params) continue;
      const valor: unknown = await rota.tratar({
        banco,
        agendador,
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

  async function atender(pedido: IncomingMessage, resposta: ServerResponse): Promise<void> {
    resposta.setHeader("X-Content-Type-Options", "nosniff");
    // No servidor, `url` sempre vem: o tipo opcional é do cliente.
    const url = new URL(String(pedido.url), `http://${origem}`);
    const caminho = url.pathname;
    const mutacao = pedido.method !== "GET" && pedido.method !== "HEAD";
    guardar(pedido, caminho, mutacao);
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
      if (status === 500) noLog(error_);
      // A rota que já começou a responder (SSE, download) e falhou no meio só pode cortar a conexão.
      if (resposta.headersSent) resposta.destroy();
      else json(resposta, status, { erro: mensagem });
    });
  };
}
