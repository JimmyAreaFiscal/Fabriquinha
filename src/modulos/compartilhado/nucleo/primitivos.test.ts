import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { EstadoTicket } from "./primitivos.ts";
import { EstadoDemanda, EstadoRodada } from "../../ciclo_de_vida/processo/nucleo/ciclos/ciclos.ts";
import { EtapaTicket } from "../../etapas/catalogo.ts";

const aceita = (schema: z.ZodType, ...valores: unknown[]) => {
  for (const v of valores) assert.ok(schema.safeParse(v).success, `deveria aceitar ${JSON.stringify(v)}`);
};
const recusa = (schema: z.ZodType, ...valores: unknown[]) => {
  for (const v of valores) assert.ok(!schema.safeParse(v).success, `deveria recusar ${JSON.stringify(v)}`);
};

test("estados SDLC têm exatamente os valores da seção 2.1", () => {
  const casos: [z.ZodEnum, string[]][] = [
    [
      EstadoDemanda,
      [
        "entender_e_desenhar",
        "gate_demanda",
        "planejar",
        "gate_planejamento",
        "em_execucao",
        "revisar_demanda",
        "encerrar_demanda",
        "concluida",
        "arquivada",
        "cancelada",
      ],
    ],
    [EstadoRodada, ["implementar", "revisar_rodada", "encerrar_rodada", "gate_pr", "ajustar_resultado", "concluida"]],
    [
      EtapaTicket,
      [
        "entender_e_desenhar",
        "planejar",
        "implementar",
        "revisar_rodada",
        "encerrar_rodada",
        "ajustar_resultado",
        "revisar_demanda",
        "encerrar_demanda",
        "resolver_conflito",
      ],
    ],
    [EstadoTicket, ["aberto", "em_execucao", "concluido", "falhou", "cancelado"]],
  ];
  for (const [schema, valores] of casos) {
    assert.deepEqual(schema.options, valores);
    aceita(schema, ...valores);
    recusa(schema, "", "aprovação_demanda", "em execução", "desenho", 1);
  }
});
