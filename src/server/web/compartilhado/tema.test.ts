import assert from "node:assert/strict";
import { test } from "node:test";
import { alternarTema, aplicarTema, CHAVE_DO_TEMA, lerTemaSalvo } from "./tema.ts";

function armazenamentoEmMemoria(inicial: Record<string, string> = {}) {
  const guardado = new Map(Object.entries(inicial));
  return {
    guardado,
    getItem: (chave: string) => guardado.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void guardado.set(chave, valor),
  };
}

const armazenamentoQuebrado = {
  getItem: (): string | null => {
    throw new Error("bloqueado");
  },
  setItem: (): void => {
    throw new Error("bloqueado");
  },
};

test("sem escolha salva, ou com valor desconhecido, o tema é o escuro", () => {
  assert.equal(lerTemaSalvo(armazenamentoEmMemoria()), "dark");
  assert.equal(lerTemaSalvo(armazenamentoEmMemoria({ [CHAVE_DO_TEMA]: "azul" })), "dark");
  assert.equal(lerTemaSalvo(armazenamentoEmMemoria({ [CHAVE_DO_TEMA]: "light" })), "light");
});

test("alternar vai do escuro ao claro e volta, gravando cada escolha", () => {
  const armazenamento = armazenamentoEmMemoria();
  const raiz = { dataset: {} as DOMStringMap };
  aplicarTema(raiz, lerTemaSalvo(armazenamento));
  assert.equal(raiz.dataset.theme, "dark");

  assert.equal(alternarTema(armazenamento, raiz), "light");
  assert.equal(raiz.dataset.theme, "light");
  assert.equal(armazenamento.guardado.get(CHAVE_DO_TEMA), "light");
  assert.equal(lerTemaSalvo(armazenamento), "light");

  assert.equal(alternarTema(armazenamento, raiz), "dark");
  assert.equal(raiz.dataset.theme, "dark");
  assert.equal(armazenamento.guardado.get(CHAVE_DO_TEMA), "dark");
});

test("sem armazenamento disponível, lê o escuro e ainda alterna na página", () => {
  const raiz = { dataset: {} as DOMStringMap };
  assert.equal(lerTemaSalvo(armazenamentoQuebrado), "dark");
  assert.equal(alternarTema(armazenamentoQuebrado, raiz), "light");
  assert.equal(raiz.dataset.theme, "light");
});
