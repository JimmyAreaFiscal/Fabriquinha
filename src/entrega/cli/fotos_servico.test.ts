// Fotos do CLI de serviço, gravadas do código de antes da refatoração da I-282: stdout, stderr e código de saída
// byte a byte para servidor e abrir. Nenhum valor esperado muda depois.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { comandoDoNavegador, principal } from "./cli.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-fotos-servico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

interface Saida {
  codigo: number;
  out: string;
  err: string;
}

async function cli(env: NodeJS.ProcessEnv, args: string[]): Promise<Saida> {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([""]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

/** A saída é igual à gravada: stdout, stderr e código de saída. */
const foto = (s: Saida, esperado: Saida): void => {
  assert.deepEqual(s, esperado);
};

/** Uma porta livre em 127.0.0.1, para o serviço de teste não disputar a porta padrão de outro serviço. */
async function portaLivre(): Promise<number> {
  const s = createServer().listen(0, "127.0.0.1");
  await new Promise((pronto) => s.once("listening", pronto));
  const { port } = s.address() as { port: number };
  await new Promise((fechou) => s.close(fechou));
  return port;
}

test("foto servidor: sobe o serviço e escreve a porta; porta ocupada é recusada; argumento a mais é uso inválido", async () => {
  const raiz = mkdtempSync(join(base, "servidor-"));
  const porta = await portaLivre();
  process.env.FABRIQUINHA_PORTA = String(porta);
  foto(await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]), {
    codigo: 0,
    out: `{"porta":${String(porta)}}\n`,
    err: "",
  });

  const ocupada = createServer().listen(porta, "127.0.0.1");
  await new Promise((pronto) => ocupada.once("listening", pronto));
  const recusada = await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]);
  await new Promise((fechou) => ocupada.close(fechou));
  foto(recusada, {
    codigo: 1,
    out: "",
    err: `a Fabriquinha não conseguiu abrir 127.0.0.1:${String(porta)}: listen EADDRINUSE: address already in use 127.0.0.1:${String(porta)} (se outra Fabriquinha já está rodando, use-a; senão, libere a porta ou troque FABRIQUINHA_PORTA)\n`,
  });

  foto(await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor", "a-mais"]), {
    codigo: 2,
    out: "",
    err: "argumento a mais: a-mais\n\nUso:\n\nServiço:\n  fabriquinha servidor\n\nCom FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.\nIDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.\n",
  });
});

test("foto abrir: abre o navegador na URL de web.url; sem o arquivo é recusado; opção desconhecida é uso inválido", async () => {
  const raiz = mkdtempSync(join(base, "abrir-"));
  const bin = mkdtempSync(join(base, "bin-"));
  const navegador = join(bin, comandoDoNavegador(process.platform));
  writeFileSync(navegador, "#!/bin/sh\n");
  chmodSync(navegador, 0o755);
  const env = { FABRIQUINHA_ROOT: raiz, PATH: bin };

  foto(await cli(env, ["abrir"]), {
    codigo: 1,
    out: "",
    err: `o serviço não está rodando: falta ${join(raiz, "web.url")} (suba-o com fabriquinha servidor)\n`,
  });

  const url = "http://127.0.0.1:8123/entrar?token=abc";
  writeFileSync(join(raiz, "web.url"), `${url}\n`);
  foto(await cli(env, ["abrir"]), { codigo: 0, out: `{"url":"${url}"}\n`, err: "" });

  foto(await cli(env, ["abrir", "--porta", "1"]), {
    codigo: 2,
    out: "",
    err: "Unknown option '--porta'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--porta\"\n\nUso:\n\nServiço:\n  fabriquinha abrir\n\nCom FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.\nIDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.\n",
  });
});
