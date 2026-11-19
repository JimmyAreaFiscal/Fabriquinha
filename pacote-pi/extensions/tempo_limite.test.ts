import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITE_COMANDO_MS } from "../../src/shared/nucleo/primitivos.ts";
import tempoLimite, { LIMITE_SEGUNDOS } from "./tempo_limite.ts";

type Tratadores = Record<string, (evento: never) => unknown>;

function carregar(): Tratadores {
  const tratadores: Tratadores = {};
  tempoLimite({
    on(nome: string, tratador: (evento: never) => unknown) {
      tratadores[nome] = tratador;
    },
  });
  return tratadores;
}

const chamar = (toolName: string, timeout?: number): { timeout?: number } => {
  const input = timeout === undefined ? {} : { timeout };
  carregar().tool_call?.({ toolName, input } as never);
  return input;
};

test("o limite é o LIMITE_COMANDO_MS da Fabriquinha, em segundos", () => {
  assert.equal(LIMITE_SEGUNDOS * 1000, LIMITE_COMANDO_MS);
});

test("sem timeout ou com timeout maior, o bash fica em 30 min", () => {
  assert.equal(chamar("bash").timeout, 1800);
  assert.equal(chamar("bash", 3600).timeout, 1800);
});

test("o timeout menor do agente é mantido, e outras ferramentas não mudam", () => {
  assert.equal(chamar("bash", 60).timeout, 60);
  assert.equal(chamar("read").timeout, undefined);
});

test("o resultado do comando que estourou ganha o aviso; o comando normal fica intacto", () => {
  const tratador = carregar().tool_result;
  assert.ok(tratador);
  const estourou = [{ type: "image" }, { type: "text", text: "Command timed out after 1800 seconds" }];
  assert.deepEqual(tratador({ toolName: "bash", content: estourou } as never), {
    content: [
      ...estourou,
      {
        type: "text",
        text: "o comando excedeu o limite de 30 min da Fabriquinha e foi encerrado; divida o trabalho em comandos menores",
      },
    ],
  });
  assert.equal(tratador({ toolName: "bash", content: [{ type: "text", text: "ok" }] } as never), undefined);
  assert.equal(tratador({ toolName: "read", content: estourou } as never), undefined);
});
