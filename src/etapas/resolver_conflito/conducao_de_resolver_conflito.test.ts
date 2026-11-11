// Condução do resolver_conflito com pi falso, banco real e git real; só as verificações são injetadas (concluir, reprovar e
// falhar na worktree da demanda).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Despacho, situacaoDeUmaDemanda } from "../../sdlc/nucleo/despacho/despacho.ts";
import { podeTentarEncerramento } from "../../sdlc/nucleo/transicoes/transicoes_encerramento.ts";
import { commitDoTicketDemanda } from "../../repositorio/armazenamento/commits_demanda.ts";
import {
  type CenarioDeImplementacao,
  cenarioDeImplementacao,
  coletor,
  DEMANDA,
  enderecoDoTicket,
  todas,
  verif,
} from "../../../apoio-testes/cenario_de_implementacao.ts";
import { rodarGit } from "../../../apoio-testes/repositorio_de_teste.ts";
import type { OpcoesDaImplementacao } from "../implementar/conducao_de_implementar.ts";
import { ConducaoDeResolverConflito } from "./conducao_de_resolver_conflito.ts";

const RESOLVER = 3;
const conduzir = (c: CenarioDeImplementacao, opcoes: OpcoesDaImplementacao) =>
  new ConducaoDeResolverConflito(c.deps(), opcoes).conduzir(enderecoDoTicket(RESOLVER));

test("CA-12 e CA-13: aprovado conclui e o encerramento volta a ser tentado sozinho", async () => {
  const c = await cenarioDeImplementacao({ conflito: true });
  assert.equal(podeTentarEncerramento(c.ag()), false);
  await conduzir(c, coletor(todas(true)));
  assert.equal(c.status(RESOLVER)?.estado, "concluido");
  assert.deepEqual(c.commits(), ["feat: Cache [I-1.T3]"]);
  assert.equal(c.ag().encerramento?.sha_verificado, commitDoTicketDemanda(c.banco, DEMANDA, RESOLVER)?.sha);
  assert.equal(podeTentarEncerramento(c.ag()), true);
  assert.deepEqual(
    new Despacho().selecionar(situacaoDeUmaDemanda(c.ag(), true)).prontos.map((t) => t.etapa),
    ["encerrar_demanda"],
  );
});

test("resolver_conflito com merge sem alteração commita o merge e conclui", async () => {
  const c = await cenarioDeImplementacao({ conflito: true });
  c.piFalso.roteirizar([{}]);
  rodarGit(c.worktree, "checkout", "-qb", "outra");
  rodarGit(c.worktree, "commit", "-q", "--allow-empty", "-m", "outra");
  rodarGit(c.worktree, "checkout", "-q", "fabriquinha/I-1");
  rodarGit(c.worktree, "merge", "--no-ff", "--no-commit", "outra");
  await conduzir(c, coletor(todas(true)));
  assert.equal(c.status(RESOLVER)?.estado, "concluido");
  assert.equal(rodarGit(c.worktree, "log", "-1", "--format=%P").trim().split(" ").length, 2);
  assert.match(rodarGit(c.worktree, "log", "-1", "--format=%B"), /\[I-1\.T3\]/);
});

test("CA-14: resolver_conflito reprovado é devolvido ao agente, sem commit", async () => {
  const c = await cenarioDeImplementacao({ conflito: true });
  await conduzir(c, coletor([verif("execucao_testes", false, "t reprovou"), ...todas(true).slice(1)]));
  const t = c.status(RESOLVER);
  assert.deepEqual([t?.estado, c.reprovacoes(RESOLVER)], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /^- execucao_testes: t reprovou/);
  assert.deepEqual(c.commits(), []);
});

test("CA-14: resolver_conflito já devolvido duas vezes falha com o relatório no motivo", async () => {
  const c = await cenarioDeImplementacao({ conflito: true });
  c.reprovarDuasVezes(RESOLVER);
  await conduzir(c, coletor([verif("execucao_testes", false, "t reprovou"), ...todas(true).slice(1)]));
  assert.equal(c.status(RESOLVER)?.estado, "falhou");
  assert.match(c.motivo(RESOLVER) ?? "", /^- execucao_testes: t reprovou/);
});

test("resolver_conflito com o hook reprovado é devolvido, sem commit", async () => {
  const c = await cenarioDeImplementacao({ conflito: true });
  const hooks = join(c.worktree, "..", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho lint quebrou\nexit 1\n");
  chmodSync(join(hooks, "pre-commit"), 0o755);
  rodarGit(c.worktree, "config", "core.hooksPath", hooks);
  await conduzir(c, coletor(todas(true)));
  const t = c.status(RESOLVER);
  assert.deepEqual([t?.estado, c.reprovacoes(RESOLVER)], ["aberto", 1]);
  assert.deepEqual(c.commits(), []);
});

test("falha do agente no resolver_conflito falha o ticket e o encerramento continua parado", async () => {
  const c = await cenarioDeImplementacao({ conflito: true });
  c.piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await conduzir(c, coletor(todas(true)));
  assert.deepEqual([c.status(RESOLVER)?.estado, podeTentarEncerramento(c.ag())], ["falhou", false]);
});
