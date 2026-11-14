// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-13: aprovação do PR da rodada solicitada e integração que falha
// na hospedagem (D06). Cenário pelos serviços e pelo agendador, com banco e git reais numa raiz temporária e o `gh` falso.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { AUDITOR, Endereco, decidirGate } from "../../src/modulos/ciclo_de_vida/publico.ts";
import { caminhoDaWorktreeRodada } from "../../apoio-testes/repositorio_de_teste.ts";
import {
  abrirPortao,
  agente,
  atual,
  demandaEmExecucao,
  despacho,
  encerrar,
  pi,
  revisar,
  rodadaDe,
  rodadaEmEncerramento,
  statusDe,
  ticketDe,
} from "../apoio-execucao.ts";
import { base, ciclo, criarCenario, demanda, git } from "../apoio.ts";
import { ghFalso } from "../falsos.ts";
import { modulosDoCicloDeTeste } from "../../apoio-testes/falsos/ambiente_falso.ts";

const gh = ghFalso(base);

test("CA-SDLC-13: integração que falha não conclui a rodada, não grava a aprovação e mantém o gate aberto", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  await encerrar(c, id);
  assert.equal(rodadaDe(c, id, 1)?.estado, "gate_pr");
  const gate = atual(c, id, "encerrar_rodada").ticket_id;
  const antes = demanda(c, id);

  gh.mergeFalha();
  await assert.rejects(
    decidirGate(
      modulosDoCicloDeTeste(c.banco),
      "gate_pr",
      Endereco.daRodada(id, 1),
      { resultado: "aprovado", nota: 5 },
      AUDITOR,
    ),
    /merge rejeitado pela hospedagem/,
  );

  const depois = demanda(c, id);
  assert.equal(rodadaDe(c, id, 1)?.estado, "gate_pr");
  assert.equal(
    depois.tickets.find((x) => x.ticket_id === gate)?.estado,
    antes.tickets.find((x) => x.ticket_id === gate)?.estado,
  );
  assert.deepEqual(depois.decisoes, antes.decisoes, "nenhuma aprovação efetiva gravada");
  assert.equal(gh.prs()[0]?.estado, "aberto");

  assert.equal(atual(c, id, "encerrar_rodada").ticket_id, gate, "o gate segue aberto, sem ticket novo");
});

test("D04: a rodada dependente nasce da ponta da demanda quando começa, já com a predecessora integrada", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }, { depende: [1], tickets: 1 }]);
  const branchR2 = rodadaDe(c, id, 2)?.branch ?? "";
  // Na aprovação do plano só a independente ganha worktree; a dependente ainda não tem nem branch.
  assert.ok(existsSync(caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 })));
  assert.equal(existsSync(caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 2 })), false);
  assert.equal(git(c.repo, "branch", "--list", branchR2), "");

  abrirPortao();
  pi.roteirizar([{ agente }]);
  await ciclo(c, despacho());
  await revisar(c, id, { resultado: "aprovado" });
  await encerrar(c, id);
  await decidirGate(
    modulosDoCicloDeTeste(c.banco),
    "gate_pr",
    Endereco.daRodada(id, 1),
    { resultado: "aprovado", nota: 5 },
    AUDITOR,
  );
  assert.equal(rodadaDe(c, id, 1)?.estado, "concluida");
  const pontaComR1 = git(c.repo, "rev-parse", `refs/heads/${demanda(c, id).demanda.branch}`);

  abrirPortao();
  pi.roteirizar([{ agente }]);
  await ciclo(c, despacho());
  assert.equal(statusDe(c, ticketDe(c, id, 2)), "concluido");
  // A R2 parte da ponta com a R1: o merge do PR da R1 é ancestral da branch dela (o git falha se não for).
  git(c.repo, "merge-base", "--is-ancestor", pontaComR1, `refs/heads/${branchR2}`);
});
