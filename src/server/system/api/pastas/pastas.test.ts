// Rota do navegador de pastas: lista só as subpastas, marca as de Git e as ilegíveis, com o corpo conferido pelo contrato.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { servir } from "../../../../../apoio-testes/servidor_web_de_teste.ts";
import { ListaDePastas } from "../contrato/pastas.ts";
import { ROTAS_DAS_PASTAS } from "./pastas.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const raiz = mkdtempSync(join(tmpdir(), "pastas-"));
after(() => {
  chmodSync(join(raiz, "fechada"), 0o700);
  rmSync(raiz, { recursive: true, force: true });
});
mkdirSync(join(raiz, "repo", ".git"), { recursive: true });
mkdirSync(join(raiz, "comum", "filha"), { recursive: true });
mkdirSync(join(raiz, "fechada"));
writeFileSync(join(raiz, "arquivo.txt"), "x");
chmodSync(join(raiz, "fechada"), 0o000);

const pedirPastas = async (caminho?: string) => {
  const { pedir } = await servir(abrirBancoTemporario().banco);
  return {
    pedir,
    resposta: await pedir(caminho === undefined ? "/api/pastas" : `/api/pastas?caminho=${encodeURIComponent(caminho)}`),
  };
};

test("a rota declara o schema da resposta e, sem caminho, lista o home do usuário", async () => {
  assert.ok(ROTAS_DAS_PASTAS.every((rota) => rota.resposta));
  const { resposta } = await pedirPastas();
  assert.equal(resposta.status, 200);
  const lista = ListaDePastas.parse(resposta.json());
  assert.equal(lista.caminho, homedir());
  assert.equal(lista.pai, dirname(homedir()));
});

test("lista só as subpastas em ordem, marcando as de Git e as sem permissão de leitura", async () => {
  const { resposta } = await pedirPastas(raiz);
  const lista = ListaDePastas.parse(resposta.json());
  assert.deepEqual(
    lista.pastas.map(({ nome, repositorioGit }) => [nome, repositorioGit]),
    [
      ["comum", false],
      ["fechada", false],
      ["repo", true],
    ],
  );
  assert.equal(lista.pastas.find(({ nome }) => nome === "fechada")?.acessivel, process.getuid?.() === 0);
  assert.equal(lista.pai, tmpdir());
});

test("entrar e voltar mostra as subpastas de cada pasta; a pasta ilegível volta vazia, sem derrubar", async () => {
  const filha = ListaDePastas.parse((await pedirPastas(join(raiz, "comum"))).resposta.json());
  assert.deepEqual(
    filha.pastas.map(({ nome }) => nome),
    ["filha"],
  );
  assert.equal(filha.pai, raiz);
  assert.equal(ListaDePastas.parse((await pedirPastas(filha.pai)).resposta.json()).pastas.length, 3);
  assert.equal(ListaDePastas.parse((await pedirPastas("/")).resposta.json()).pai, null);
  if (process.getuid?.() === 0) return;
  const fechada = ListaDePastas.parse((await pedirPastas(join(raiz, "fechada"))).resposta.json());
  assert.deepEqual({ acessivel: fechada.acessivel, pastas: fechada.pastas }, { acessivel: false, pastas: [] });
});

test("caminho relativo ou inexistente é erro de validação, e sem cookie é 401", async () => {
  assert.equal((await pedirPastas("relativo/pasta")).resposta.status, 422);
  assert.equal((await pedirPastas(join(raiz, "nao-existe"))).resposta.status, 422);
  assert.equal((await pedirPastas(join(raiz, "arquivo.txt"))).resposta.status, 422);
  const { pedir } = await pedirPastas(raiz);
  assert.equal((await pedir("/api/pastas", { cookie: false })).status, 401);
});
