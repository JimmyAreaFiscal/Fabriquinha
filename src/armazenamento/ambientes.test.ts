import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeInexistente } from "../nucleo/erros.ts";
import {
  alocarAmbienteLivreDaImagem,
  buscarAmbienteAlocadoPara,
  eliminarAmbiente,
  inserirAmbienteAlocado,
  liberarAmbiente,
  reservarAmbienteParaEliminar,
  listarAmbientes,
} from "./ambientes.ts";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function bancoComConjunto(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  return banco;
}

const novo = (id: string, imagem = "fabriquinha/loja:abc", alocadoPara = `I-1/${id}`) => ({
  id,
  container_id: `container-${id}`,
  imagem,
  criado_em: T1,
  alocado_para: alocadoPara,
});

test("inserir grava o Ambiente alocado ao Espaço e buscar o acha pelo Espaço", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, novo("a1"));

  assert.deepEqual(buscarAmbienteAlocadoPara(banco, "I-1/a1"), {
    id: "a1",
    container_id: "container-a1",
    imagem: "fabriquinha/loja:abc",
    estado: "alocado",
    alocado_para: "I-1/a1",
    criado_em: T1,
    liberado_em: null,
  });
  assert.equal(buscarAmbienteAlocadoPara(banco, "I-1/outro"), undefined);
  banco.close();
});

test("liberar tira o Espaço e grava quando; só o livre da imagem pedida é alocado, o mais antigo primeiro", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, novo("a1"));
  inserirAmbienteAlocado(banco, novo("a2"));
  inserirAmbienteAlocado(banco, novo("o1", "outra:imagem"));
  liberarAmbiente(banco, "a2", "livre", T1);
  liberarAmbiente(banco, "a1", "livre", T2);
  liberarAmbiente(banco, "o1", "livre", T1);

  assert.equal(buscarAmbienteAlocadoPara(banco, "I-1/a1"), undefined);
  const alocado = alocarAmbienteLivreDaImagem(banco, "fabriquinha/loja:abc", "I-2/1");
  assert.deepEqual(alocado, {
    id: "a2",
    container_id: "container-a2",
    imagem: "fabriquinha/loja:abc",
    estado: "alocado",
    alocado_para: "I-2/1",
    criado_em: T1,
    liberado_em: T1,
  });
  assert.equal(alocarAmbienteLivreDaImagem(banco, "fabriquinha/loja:abc", "I-3/1")?.id, "a1");
  assert.equal(alocarAmbienteLivreDaImagem(banco, "fabriquinha/loja:abc", "I-4/1"), undefined);
  assert.equal(alocarAmbienteLivreDaImagem(banco, "imagem:inexistente", "I-4/1"), undefined);
  banco.close();
});

test("o Ambiente sujo não é alocado nem reaproveitado até ser eliminado", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, novo("a1"));
  liberarAmbiente(banco, "a1", "sujo", T2);

  assert.equal(alocarAmbienteLivreDaImagem(banco, "fabriquinha/loja:abc", "I-2/1"), undefined);
  assert.deepEqual(
    listarAmbientes(banco).map(({ id, estado, alocado_para, liberado_em }) => ({
      id,
      estado,
      alocado_para,
      liberado_em,
    })),
    [{ id: "a1", estado: "sujo", alocado_para: null, liberado_em: T2 }],
  );
  banco.close();
});

test("eliminar tira o Ambiente da lista e do alocável, mas a linha fica gravada", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, novo("a1"));
  inserirAmbienteAlocado(banco, novo("a2"));
  liberarAmbiente(banco, "a1", "livre", T1);
  eliminarAmbiente(banco, "a1");
  eliminarAmbiente(banco, "a2");

  assert.deepEqual(listarAmbientes(banco), []);
  assert.equal(alocarAmbienteLivreDaImagem(banco, "fabriquinha/loja:abc", "I-2/1"), undefined);
  assert.deepEqual(
    banco
      .prepare("SELECT id, estado, alocado_para FROM ambiente ORDER BY id")
      .all()
      .map((l) => ({ ...l })),
    [
      { id: "a1", estado: "eliminado", alocado_para: null },
      { id: "a2", estado: "eliminado", alocado_para: null },
    ],
  );
  banco.close();
});

test("listar devolve o conjunto vivo do mais antigo ao mais novo", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, { ...novo("b"), criado_em: T2 });
  inserirAmbienteAlocado(banco, novo("a"));
  inserirAmbienteAlocado(banco, novo("c"));
  eliminarAmbiente(banco, "c");

  assert.deepEqual(
    listarAmbientes(banco).map((ambiente) => ambiente.id),
    ["a", "b"],
  );
  banco.close();
});

test("liberar e eliminar um Ambiente inexistente ou já eliminado recusam com orientação", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, novo("a1"));
  eliminarAmbiente(banco, "a1");

  for (const operacao of [
    () => {
      liberarAmbiente(banco, "nao-existe", "livre", T1);
    },
    () => {
      liberarAmbiente(banco, "a1", "livre", T1);
    },
    () => {
      eliminarAmbiente(banco, "nao-existe");
    },
    () => {
      eliminarAmbiente(banco, "a1");
    },
  ]) {
    assert.throws(operacao, (erro) => erro instanceof ErroDeInexistente && erro.message.includes("o ambiente"));
  }
  banco.close();
});

test("reservar para eliminar só vale para o livre ou sujo, uma vez, e devolve o container", () => {
  const banco = bancoComConjunto();
  inserirAmbienteAlocado(banco, novo("a1"));
  inserirAmbienteAlocado(banco, novo("a2"));
  assert.equal(reservarAmbienteParaEliminar(banco, "a1"), undefined);
  liberarAmbiente(banco, "a1", "livre", T1);
  liberarAmbiente(banco, "a2", "sujo", T1);

  assert.equal(reservarAmbienteParaEliminar(banco, "a1")?.container_id, novo("a1").container_id);
  assert.equal(reservarAmbienteParaEliminar(banco, "a1"), undefined);
  assert.equal(reservarAmbienteParaEliminar(banco, "a2")?.estado, "eliminado");
  assert.equal(alocarAmbienteLivreDaImagem(banco, "fabriquinha/loja:abc", "I-2/1"), undefined);
  assert.equal(reservarAmbienteParaEliminar(banco, "nao-existe"), undefined);
  banco.close();
});
