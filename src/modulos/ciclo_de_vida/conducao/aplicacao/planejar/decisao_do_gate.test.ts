// Os efeitos do gate do planejamento com banco real, git real em repositório temporário e pi falso mínimo (CA-2 a CA-5,
// CA-8 a CA-13 da I-205): o plano vai ao gate, a aprovação prepara as worktrees e a recusa nada grava.
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { carregarDemanda } from "../../../../sdlc/armazenamento/demandas.ts";
import { rodarGit } from "../../../../../../apoio-testes/repositorio_de_teste.ts";
import {
  aprovarGateDoPlanejamento,
  cenarioDePlanejamento,
  CRITERIOS,
  plano,
  proporPlanoDoAgente,
  reprovarGateDoPlanejamento,
} from "../../../../../../apoio-testes/cenario_de_planejamento.ts";

test("CA-4: plano válido leva ao gate e fica como evidência do planejar", () => {
  const { banco } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  const depois = proporPlanoDoAgente(banco, "I-1", plano());
  assert.equal(depois.demanda.estado, "gate_planejamento");
  const gravado = carregarDemanda(banco, "I-1").evidencias.find((e) => e.tipo === "plano");
  assert.equal(gravado?.ticket_id, 1);
  assert.deepEqual((gravado.dados as { criterios: string[] }).criterios, CRITERIOS);
});

test("CA-2: plano com critério que nenhuma rodada cita é aceito e vai ao gate", () => {
  const { banco } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  const umPlano = plano();
  assert.ok(umPlano.rodadas.every((r) => !r.criterios.includes("CA-2")));
  assert.equal(proporPlanoDoAgente(banco, "I-1", umPlano).demanda.estado, "gate_planejamento");
});

test("CA-5: plano que cita CA inexistente é reprovado e nada é gravado", () => {
  const { banco } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  assert.throws(
    () => proporPlanoDoAgente(banco, "I-1", plano(["CA-1", "CA-99"])),
    /o plano cita CA-99, que a definição da demanda I-1 não tem/,
  );
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.estado, "planejar");
  assert.equal(
    ag.evidencias.some((e) => e.tipo === "plano"),
    false,
  );
});

test("a reprovação sem sessão do planejar só grava a decisão", async () => {
  const { banco, prompts } = cenarioDePlanejamento({
    estado: "gate_planejamento",
    estadoDoTicket: "em_execucao",
    comPlano: true,
  });
  await reprovarGateDoPlanejamento(banco, "falta");
  assert.deepEqual(prompts(), []);
});

test("CA-8: motivo vazio recusa a reprovação e nada é registrado", async () => {
  const { banco } = cenarioDePlanejamento({
    estado: "gate_planejamento",
    estadoDoTicket: "em_execucao",
    comPlano: true,
  });
  await assert.rejects(reprovarGateDoPlanejamento(banco, "   "), /informe o motivo da reprovação/);
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.estado, "gate_planejamento");
  assert.deepEqual(ag.decisoes, []);
});

const aprovacao = () =>
  cenarioDePlanejamento({ estado: "gate_planejamento", estadoDoTicket: "em_execucao", comPlano: true });

test("CA-9: aprovar cria as worktrees a partir da branch da demanda e prepara cada uma; a dependente fica para quando começar", async () => {
  const { c, banco } = aprovacao();
  await aprovarGateDoPlanejamento(banco);
  const dir = join(c.raiz, "worktrees", "loja", "I-1");
  const demandaTopo = rodarGit(c.repo, "rev-parse", "fabriquinha/I-1");
  for (const w of ["demanda", "rodadas/1"]) assert.ok(existsSync(join(dir, w, "preparado")), w);
  assert.equal(rodarGit(c.repo, "merge-base", "fabriquinha/I-1", "fabriquinha/I-1-1"), demandaTopo);
  // D04: a rodada 2 depende da 1 e nasce da ponta da demanda só quando começar.
  assert.equal(existsSync(join(dir, "rodadas/2")), false);
  assert.equal(rodarGit(c.repo, "branch", "--list", "fabriquinha/I-1-2"), "");
});

test("CA-10, CA-11: preparação que falha na rodada 1 deixa o gate aberto; corrigida, a aprovação conclui", async () => {
  const { c, banco, status } = aprovacao();
  writeFileSync(join(c.raiz, "quebra"), "");
  const caminho = join(c.raiz, "worktrees", "loja", "I-1", "rodadas", "1");
  await assert.rejects(
    aprovarGateDoPlanejamento(banco),
    (e: Error) =>
      e instanceof ErroDeRegra &&
      e.message.includes("a preparação da worktree falhou") &&
      e.message.endsWith(`(worktree ${caminho})`),
  );
  let ag = carregarDemanda(banco, "I-1");
  assert.deepEqual([ag.demanda.estado, ag.rodadas.length, ag.tickets.length], ["gate_planejamento", 0, 1]);
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "planejamento-I-1.log"), "utf8"),
    /preparação falhou em .*rodadas\/1/,
  );

  rmSync(join(c.raiz, "quebra"));
  await aprovarGateDoPlanejamento(banco, { resultado: "aprovado", nota: 4 });
  ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.demanda.estado, "em_execucao");
  assert.deepEqual(
    ag.rodadas.map((r) => [r.rodada_id, r.estado]),
    [
      [1, "implementar"],
      [2, "implementar"],
    ],
  );
  assert.deepEqual(
    ag.tickets.map((t) => [t.etapa, t.estado]),
    [
      ["planejar", "concluido"],
      ["implementar", "aberto"],
      ["implementar", "aberto"],
    ],
  );
  assert.equal(status(), "concluido");
});

test("CA-12: falha de gravação depois da primeira rodada desfaz tudo", async () => {
  const { banco } = aprovacao();
  banco.exec(
    "CREATE TRIGGER falha BEFORE INSERT ON rodada WHEN NEW.rodada_id = 2 BEGIN SELECT RAISE(ABORT, 'falha de gravação'); END",
  );
  const antes = carregarDemanda(banco, "I-1");
  await assert.rejects(aprovarGateDoPlanejamento(banco), /falha de gravação/);
  assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
});

test("aprovar fora do gate recusa antes de tocar o git", async () => {
  const { c, banco } = cenarioDePlanejamento();
  await assert.rejects(aprovarGateDoPlanejamento(banco), /só no estado gate_planejamento/);
  assert.equal(existsSync(join(c.raiz, "worktrees")), false);
});
