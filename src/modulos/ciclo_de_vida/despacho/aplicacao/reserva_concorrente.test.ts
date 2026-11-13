// A reserva é atômica e impede o despacho duplicado (MELHORIAS §5.2, regra 6): duas threads, cada uma com a sua conexão
// ao mesmo banco, reservam o mesmo ticket no mesmo instante, e só uma vence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import {
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { registrarProjeto } from "../../../projeto/aplicacao/cadastro.ts";
import { carregarDemanda } from "../../processo/armazenamento/agregado_da_demanda.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

/** Cada thread abre o banco, espera o sinal de largada e tenta a reserva; devolve "reservou" ou a mensagem da recusa. */
const RESERVA_NA_THREAD = `
const { workerData, parentPort } = require("node:worker_threads");
(async () => {
  const { abrirBancoDaFabriquinha } = await import(workerData.banco);
  const { reservarTicketParaAFabriquinha } = await import(workerData.despacho);
  const { relogioDoSistema } = await import(workerData.relogio);
  const banco = abrirBancoDaFabriquinha(workerData.raiz);
  parentPort.postMessage("pronta");
  Atomics.wait(workerData.largada, 0, 0);
  try {
    reservarTicketParaAFabriquinha(banco, { demanda_id: "I-1", ticket_id: 1 }, relogioDoSistema, true);
    parentPort.postMessage("reservou");
  } catch (erro) {
    parentPort.postMessage(erro.message);
  } finally {
    banco.close();
  }
})();
`;

const moduloDe = (caminho: string): string => pathToFileURL(new URL(caminho, import.meta.url).pathname).href;

test("duas reservas simultâneas do mesmo ticket: só uma vence, e a outra o encontra já em execução", async () => {
  const { raiz, banco } = abrirBancoTemporario();
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "k",
    raiz_git: "/nao/existe",
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-1", "em_execucao", {
      rodadas: [montarRodada("I-1", 1, "implementar")],
      tickets: [montarTicket("I-1", 1, "implementar", { rodada_id: 1, estado: "aberto" })],
    }),
  );
  const largada = new Int32Array(new SharedArrayBuffer(4));
  const dados = {
    raiz,
    largada,
    banco: moduloDe("../../../../server/composicao/banco_da_fabriquinha.ts"),
    despacho: moduloDe("../publico.ts"),
    relogio: moduloDe("../../../../shared/nucleo/relogio.ts"),
  };
  const threads = [0, 1].map(() => new Worker(RESERVA_NA_THREAD, { eval: true, workerData: dados }));
  const respostas = threads.map(
    (thread) =>
      new Promise<string[]>((terminou, falhou) => {
        const mensagens: string[] = [];
        thread.on("message", (mensagem: string) => mensagens.push(mensagem));
        thread.on("error", falhou);
        thread.on("exit", () => {
          terminou(mensagens);
        });
      }),
  );
  await Promise.all(
    threads.map((thread) => new Promise((pronta) => thread.once("message", pronta))), // as duas conexões abertas
  );
  Atomics.store(largada, 0, 1);
  Atomics.notify(largada, 0);
  const desfechos = (await Promise.all(respostas)).map((mensagens) => mensagens.at(-1));
  assert.equal(desfechos.filter((desfecho) => desfecho === "reservou").length, 1);
  assert.match(String(desfechos.find((desfecho) => desfecho !== "reservou")), /o estado atual é em_execucao/);
  assert.equal(carregarDemanda(banco, "I-1").tickets[0]?.estado, "em_execucao");
});
