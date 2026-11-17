import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Ambiente, GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import { AmbienteHostLocal, gestaoQueSoUsa } from "../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { espacoDaDemanda } from "../../espaco_de_trabalho/publico.ts";
import { montarRepositorio } from "./repositorio_do_projeto.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/system/banco_da_fabriquinha.ts";

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

test("devolverAmbiente limpa só o Ambiente do dono do Espaço e deixa a worktree onde está", async () => {
  const limpos: string[] = [];
  const ambienteDaDemanda = new AmbienteHostLocal();
  const gestao: GestaoDeAmbientes = {
    ...gestaoQueSoUsa(ambienteDaDemanda),
    ambienteDo: (ocupante) => (ocupante === "I-1" ? ({ id: "sandbox-1" } as Ambiente) : ambienteDaDemanda),
    limpar: (id) => {
      limpos.push(id);
      return Promise.resolve();
    },
  };
  const repositorio = montarRepositorio({ banco: new DatabaseSync(":memory:"), ambientes: gestao });
  const projeto = {
    nome: "loja",
    raiz_git: "/nao-existe",
    branch_base: "main",
    hospedagem: "github" as const,
    verificacoes: { preparacao: [] },
  };
  await repositorio.devolverAmbiente(projeto, espacoDaDemanda(projeto, "I-1", "/nao-existe"), "/nao-existe/log");
  assert.deepEqual(limpos, ["sandbox-1"]);
});

test("o git do Espaço que ainda tem o Ambiente alocado roda nele, sem alocar outro nem devolver o dele", async () => {
  const pedidosAGestao: string[] = [];
  const ambienteAlocado = new AmbienteHostLocal();
  const gestao: GestaoDeAmbientes = {
    ...gestaoQueSoUsa(ambienteAlocado),
    ambienteDo: (ocupante) => (ocupante === "I-1" ? ambienteAlocado : ({ id: "do-servico" } as Ambiente)),
    alocar: () => {
      pedidosAGestao.push("alocar");
      return Promise.resolve(ambienteAlocado);
    },
    limpar: (id) => {
      pedidosAGestao.push(`limpar ${id}`);
      return Promise.resolve();
    },
  };
  const repositorio = montarRepositorio({ banco: new DatabaseSync(":memory:"), ambientes: gestao });
  const projeto = {
    nome: "loja",
    raiz_git: "/nao-existe",
    branch_base: "main",
    hospedagem: "github" as const,
    verificacoes: { preparacao: [] },
  };
  const espaco = { ...espacoDaDemanda(projeto, "I-1", "/nao-existe"), pasta: tmpdir() };
  assert.match(await repositorio.gitNoEspaco(projeto, espaco, "--version"), /^git version/);
  assert.deepEqual(pedidosAGestao, []);
});
