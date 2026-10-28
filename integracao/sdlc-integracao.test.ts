// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-13: aprovação do PR da rodada solicitada e integração que falha
// na hospedagem (D06). Cenário pelos serviços e pelo agendador, com banco e git reais numa raiz temporária e o `gh` falso.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR } from "../src/dominio/agregado.ts";
import { aprovarPRRodada } from "../src/execucao/aprovacao_pr_rodada.ts";
import { atual, encerrar, rodadaDe, rodadaEmEncerramento } from "./apoio-execucao.ts";
import { base, criarCenario, demanda } from "./apoio.ts";
import { ghFalso } from "./falsos.ts";

const gh = ghFalso(base);

test("CA-SDLC-13: integração que falha não conclui a rodada, não grava a aprovação e mantém o gate aberto", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  await encerrar(c, id);
  assert.equal(rodadaDe(c, id, 1)?.fase, "aprovacao_pull_request");
  const ref = { demanda_id: id, rodada_id: 1 };
  const gate = atual(c, id, "encerrar_rodada").ticket_id;
  const antes = demanda(c, id);

  gh.mergeFalha();
  await assert.rejects(aprovarPRRodada(c.banco, ref, 5, AUDITOR), /merge recusado pela hospedagem/);

  const depois = demanda(c, id);
  assert.equal(rodadaDe(c, id, 1)?.fase, "aprovacao_pull_request");
  assert.equal(
    depois.tickets.find((x) => x.ticket_id === gate)?.status,
    antes.tickets.find((x) => x.ticket_id === gate)?.status,
  );
  assert.deepEqual(depois.decisoes, antes.decisoes, "nenhuma aprovação efetiva gravada");
  assert.equal(gh.prs()[0]?.estado, "aberto");

  assert.equal(atual(c, id, "encerrar_rodada").ticket_id, gate, "o gate segue aberto, sem ticket novo");
});
