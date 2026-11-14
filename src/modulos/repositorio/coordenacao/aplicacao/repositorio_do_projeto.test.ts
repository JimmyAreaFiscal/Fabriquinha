import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { montarRepositorio } from "./repositorio_do_projeto.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";

test("sem a varredura, o Repositório não lê o banco em segundo plano e parar resolve na hora", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // O banco sem tabelas: qualquer leitura da varredura lançaria.
  const repositorio = montarRepositorio({ banco: new DatabaseSync(":memory:") });
  t.mock.timers.tick(60_000);
  await assert.doesNotReject(repositorio.parar());
});

test("a varredura diária segue a cadência do agendador: varre a cada intervaloMin batidas e só com ele ligado", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  let varreduras = 0;
  let lerCadencia = () => ({ intervaloMin: 3, agendadorAtivo: true });
  const erros: unknown[] = [];
  const repositorio = montarRepositorio({
    banco,
    varredura: {
      // Cada varredura lê a lista dos projetos uma vez: a contagem diz quantas rodaram.
      projetos: () => {
        varreduras++;
        return [];
      },
      cadencia: () => lerCadencia(),
      registrarErro: (erro) => erros.push(erro),
    },
  });
  const bater = async (minutos: number) => {
    for (let minuto = 0; minuto < minutos; minuto++) {
      t.mock.timers.tick(60_000);
      await new Promise(setImmediate);
    }
  };
  await bater(2);
  assert.equal(varreduras, 0, "antes do intervalo, nada");
  await bater(1);
  assert.equal(varreduras, 1, "no intervalo, uma varredura");
  lerCadencia = () => ({ intervaloMin: 3, agendadorAtivo: false });
  await bater(4);
  assert.equal(varreduras, 1, "desligado, nada");
  lerCadencia = () => ({ intervaloMin: 3, agendadorAtivo: true });
  await bater(1);
  assert.equal(varreduras, 2, "religado depois do intervalo, varre na batida seguinte");
  lerCadencia = () => {
    throw new Error("configuração ilegível");
  };
  await bater(4);
  assert.equal(varreduras, 2, "a configuração que não se lê vale como desligada");
  assert.deepEqual(erros, []);
  await repositorio.parar();
});
