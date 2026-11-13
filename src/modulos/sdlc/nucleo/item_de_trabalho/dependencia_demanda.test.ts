import assert from "node:assert/strict";
import { test } from "node:test";
import { predecessorasPendentes } from "./dependencia_demanda.ts";

test("CA-9 e CA-10: concluída e arquivada satisfazem; o resto fica pendente", () => {
  const pendentes = predecessorasPendentes([
    { demanda_id: "I-1", estado: "em_execucao" },
    { demanda_id: "I-5", estado: "arquivada" },
    { demanda_id: "I-6", estado: "concluida" },
    { demanda_id: "I-7", estado: "cancelada" },
  ]);
  assert.deepEqual(pendentes, ["I-1", "I-7"]);
});
