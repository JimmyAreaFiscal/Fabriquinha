import assert from "node:assert/strict";
import { test } from "node:test";
import type { Demanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { demandaParaCli } from "./demanda_para_cli.ts";

test("troca criada_por pela origem do CLI no mesmo lugar e preserva a ordem e os demais campos", () => {
  const demanda: Demanda = {
    id: "I-266",
    projeto: "fabriquinha",
    titulo: "Autoria",
    tipo: "funcionalidade",
    descricao: "Unificar atores",
    estado: "entender_e_desenhar",
    estado_alterado_em: "2026-01-01T00:00:00.000Z",
    criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
    enviada: false,
    branch: "fabriquinha/I-266",
  };
  const convertida = demandaParaCli(demanda);
  assert.deepEqual(convertida, {
    id: "I-266",
    projeto: "fabriquinha",
    titulo: "Autoria",
    tipo: "funcionalidade",
    descricao: "Unificar atores",
    estado: "entender_e_desenhar",
    estado_alterado_em: "2026-01-01T00:00:00.000Z",
    origem_ferramenta: "claude",
    origem_sessao: "s1",
    enviada: false,
    branch: "fabriquinha/I-266",
  });
  assert.deepEqual(Object.keys(convertida), [
    "id",
    "projeto",
    "titulo",
    "tipo",
    "descricao",
    "estado",
    "estado_alterado_em",
    "origem_ferramenta",
    "origem_sessao",
    "enviada",
    "branch",
  ]);
  assert.equal("criada_por" in convertida, false);
  assert.deepEqual(demanda.criada_por, { tipo: "externo", ferramenta: "claude", sessao: "s1" });
});
