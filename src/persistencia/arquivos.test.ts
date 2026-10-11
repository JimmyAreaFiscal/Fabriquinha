import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { caminhoArquivo, guardarArquivos } from "./arquivos.ts";
import { abrir, raizDo } from "./banco.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-arquivos-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const sha = (conteudo: string) => createHash("sha256").update(conteudo).digest("hex");
const permissao = (caminho: string) => statSync(caminho).mode & 0o777;

/** Guarda os arquivos dos caminhos pelos descritores, com a conferência dada (por padrão, aceita tudo). */
function guardarTodos(
  banco: DatabaseSync,
  caminhos: string[],
  conferir: (copia: number, bytes: number, origem: { fd: number; caminho: string }) => object = () => ({}),
) {
  const origens = caminhos.map((caminho) => ({ fd: openSync(caminho, "r"), caminho }));
  try {
    return guardarArquivos(banco, origens, conferir, Number.MAX_SAFE_INTEGER);
  } finally {
    for (const { fd } of origens) closeSync(fd);
  }
}

const guardar = (banco: DatabaseSync, caminho: string) => {
  const [guardado] = guardarTodos(banco, [caminho]);
  assert.ok(guardado);
  return guardado;
};

function preparar() {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const banco = abrir(raiz);
  const origem = (nome: string, conteudo: string) => {
    const caminho = join(raiz, nome);
    writeFileSync(caminho, conteudo);
    return caminho;
  };
  return { raiz, banco, origem };
}

test("raizDo() é a pasta do banco aberto", () => {
  const { raiz, banco } = preparar();
  assert.equal(raizDo(banco), raiz);
  banco.close();
});

test("guardarArquivos grava por SHA-256 em arquivos/<ab>/<hash>, 0600 em pastas 0700, sem sobra de temporário", () => {
  const { raiz, banco, origem } = preparar();
  const conteudo = "x".repeat(3 * 1024 * 1024 + 7); // mais de um bloco de cópia
  const guardado = guardar(banco, origem("log.txt", conteudo));

  assert.deepEqual(guardado, { sha256: sha(conteudo), bytes: conteudo.length });
  const caminho = caminhoArquivo(banco, guardado.sha256);
  assert.equal(caminho, join(raiz, "arquivos", guardado.sha256.slice(0, 2), guardado.sha256));
  assert.equal(readFileSync(caminho, "utf8"), conteudo);
  assert.equal(permissao(caminho), 0o600);
  assert.equal(permissao(join(raiz, "arquivos")), 0o700);
  assert.equal(permissao(join(raiz, "arquivos", guardado.sha256.slice(0, 2))), 0o700);
  assert.deepEqual(readdirSync(join(raiz, "arquivos")), [guardado.sha256.slice(0, 2)]);
  assert.deepEqual(guardar(banco, origem("vazio", "")), { sha256: sha(""), bytes: 0 });
  banco.close();
});

test("o mesmo conteúdo guardado duas vezes ocupa um arquivo só, que não é tocado", () => {
  const { raiz, banco, origem } = preparar();
  const primeiro = guardar(banco, origem("a.png", "mesmo"));
  const antes = statSync(caminhoArquivo(banco, primeiro.sha256));
  const segundo = guardar(banco, origem("b.png", "mesmo"));

  assert.deepEqual(segundo, primeiro);
  const depois = statSync(caminhoArquivo(banco, segundo.sha256));
  assert.deepEqual([depois.ino, depois.mtimeMs, depois.nlink], [antes.ino, antes.mtimeMs, 1]);
  assert.deepEqual(readdirSync(join(raiz, "arquivos", primeiro.sha256.slice(0, 2))), [primeiro.sha256]);
  banco.close();
});

test("guardarArquivos propaga a falha ao ligar o arquivo e não deixa temporário", () => {
  const { raiz, banco, origem } = preparar();
  const pasta = join(raiz, "arquivos", sha("bloqueado").slice(0, 2));
  mkdirSync(pasta, { recursive: true });
  chmodSync(pasta, 0o500);
  assert.throws(() => guardar(banco, origem("x", "bloqueado")), { code: "EACCES" });
  chmodSync(pasta, 0o700);
  assert.deepEqual(readdirSync(join(raiz, "arquivos")), [sha("bloqueado").slice(0, 2)]);
  banco.close();
});

test("conferir valida a cópia privada antes de ligá-la; uma recusa não guarda nenhum dos arquivos", () => {
  const { raiz, banco, origem } = preparar();
  const [a, b] = [origem("a.txt", "abc"), origem("b.txt", "recusado")];
  const vistos: [string, number, number, string][] = [];
  assert.throws(
    () =>
      guardarTodos(banco, [a, b], (copia, bytes, { caminho }) => {
        const conteudo = Buffer.alloc(bytes);
        readSync(copia, conteudo, 0, bytes, 0);
        vistos.push([caminho, bytes, fstatSync(copia).mode & 0o777, conteudo.toString()]);
        if (conteudo.toString() === "recusado") throw new ErroDeRegra("recusado", "teste");
        return {};
      }),
    ErroDeRegra,
  );
  assert.deepEqual(vistos, [
    [a, 3, 0o600, "abc"],
    [b, 8, 0o600, "recusado"],
  ]);
  assert.deepEqual(readdirSync(join(raiz, "arquivos")), []);

  // O que conferir devolve vai junto do resultado; a cópia começa do byte 0, qualquer que seja a posição do fd.
  const fd = openSync(a, "r");
  readFileSync(fd);
  assert.deepEqual(
    guardarArquivos(banco, [{ fd }], () => ({ mime: "text/plain" }), 3),
    [{ mime: "text/plain", sha256: sha("abc"), bytes: 3 }],
  );
  closeSync(fd);
  banco.close();
});

test("guardarArquivos para de ler em teto + 1 bytes e recusa, mesmo de uma origem que não acaba", () => {
  const { raiz, banco } = preparar();
  const fd = openSync("/dev/zero", "r");
  const recusa = (e: unknown) =>
    e instanceof ErroDeRegra &&
    e.message ===
      "um anexo passou de 3145728 bytes durante a cópia (anexe um arquivo menor, que não esteja sendo escrito)";
  assert.throws(() => guardarArquivos(banco, [{ fd }], () => ({}), 3 * 1024 * 1024), recusa);
  closeSync(fd);
  assert.deepEqual(readdirSync(join(raiz, "arquivos")), []);
  banco.close();
});

test("caminhoArquivo só aceita um SHA-256, nunca um caminho", () => {
  const { banco } = preparar();
  for (const ruim of ["../../etc/passwd", "A".repeat(64), "a".repeat(63)]) {
    assert.throws(() => caminhoArquivo(banco, ruim), ErroDeRegra);
  }
  banco.close();
});
