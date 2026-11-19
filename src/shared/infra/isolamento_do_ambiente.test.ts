import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { identidadeDaInstalacaoDoHarness, instalacaoDoPi } from "./isolamento_do_ambiente.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-instalacao-do-pi-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Um pacote npm instalado como o do pi: `package.json` na raiz, o executável em `dist/bundle` e o link em `bin`. */
function instalarPacote(nome: string): { bin: string; executavel: string; raiz: string } {
  const raiz = join(base, nome, "lib", "pi-coding-agent");
  const executavel = join(raiz, "dist", "bundle", "cli.js");
  mkdirSync(join(raiz, "dist", "bundle"), { recursive: true });
  writeFileSync(join(raiz, "package.json"), "{}");
  writeFileSync(executavel, "");
  const bin = join(base, nome, "bin");
  mkdirSync(bin);
  symlinkSync(executavel, join(bin, "pi"));
  return { bin, executavel, raiz };
}

test("instalacaoDoPi acha o pi do PATH, desfaz o link e sobe até a pasta com package.json", () => {
  const { bin, executavel, raiz } = instalarPacote("npm-global");
  assert.deepEqual(instalacaoDoPi({ PATH: [join(base, "nao-existe"), bin].join(":") }), {
    comando: "pi",
    executavel,
    raiz,
  });
});

test("instalacaoDoPi usa o FABRIQUINHA_PI absoluto, como o harness", () => {
  const { bin, executavel, raiz } = instalarPacote("outro-lugar");
  assert.deepEqual(instalacaoDoPi({ FABRIQUINHA_PI: join(bin, "pi"), PATH: "" }), { comando: "pi", executavel, raiz });
});

test("instalacaoDoPi sem package.json acima monta só a pasta do executável, nunca a raiz do disco", () => {
  const pasta = join(base, "solto");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "pi"), "");
  assert.deepEqual(instalacaoDoPi({ FABRIQUINHA_PI: join(pasta, "pi") }), {
    comando: "pi",
    executavel: join(pasta, "pi"),
    raiz: pasta,
  });
});

test("instalacaoDoPi sem o pi no host recusa com a orientação", () => {
  assert.throws(
    () => instalacaoDoPi({}),
    (erro: unknown) => {
      assert.ok(erro instanceof ErroDeRegra);
      assert.match(erro.message, /não achei o pi no host/);
      return true;
    },
  );
});

test("identidadeDaInstalacaoDoHarness repete na mesma pasta e muda quando outra pasta toma o lugar, com o mesmo package.json", () => {
  const { executavel, raiz } = instalarPacote("npm-identidade");
  const instalacao = { comando: "pi", executavel, raiz };
  const antes = identidadeDaInstalacaoDoHarness(instalacao);
  assert.equal(identidadeDaInstalacaoDoHarness(instalacao), antes);
  assert.ok(antes.startsWith(raiz));

  // Como o `npm install -g`: a nova nasce antes de a antiga sair, então não herda o inode dela.
  const nova = `${raiz}-nova`;
  mkdirSync(nova);
  writeFileSync(join(nova, "package.json"), "{}");
  rmSync(raiz, { recursive: true });
  renameSync(nova, raiz);

  assert.notEqual(identidadeDaInstalacaoDoHarness(instalacao), antes);
});
