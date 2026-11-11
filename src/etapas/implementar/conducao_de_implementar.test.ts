// Condução do implementar com pi falso, banco real e git real; só as verificações são injetadas (concluir, reprovar e
// falhar: CA-1 a CA-16 do fechamento do ticket, agora feito pela condução).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Despacho, situacaoDeUmaDemanda } from "../../sdlc/nucleo/despacho/despacho.ts";
import { commitDoTicketDemanda } from "../../sdlc/armazenamento/commits_demanda.ts";
import { AmbienteHostLocal } from "../../sandbox/infra/host_local/ambiente_host_local.ts";
import {
  type CenarioDeImplementacao,
  cenarioDeImplementacao,
  coletor,
  DEMANDA,
  enderecoDoTicket,
  naoColeta,
  ref,
  ticket,
  TIPOS,
  todas,
  verif,
} from "../../../apoio-testes/cenario_de_implementacao.ts";
import { rodarGit } from "../../../apoio-testes/repositorio_de_teste.ts";
import { CondutorDeTrabalhos } from "../../trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { commitarTicketDemanda } from "../../repositorio/aplicacao/espaco/commit_ticket_demanda.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "./conducao_de_implementar.ts";

const conduzir = (
  c: CenarioDeImplementacao,
  n: number,
  opcoes: OpcoesDaImplementacao,
  condutor?: CondutorDeTrabalhos,
) => new ConducaoDeImplementar(c.deps(condutor), opcoes).conduzir(enderecoDoTicket(n));

test("CA-1 a CA-5: aprovado conclui, commita uma vez, grava as evidências com anexos e leva a rodada à revisão", async () => {
  const c = await cenarioDeImplementacao();
  await conduzir(c, 1, coletor(todas(true)));
  assert.equal(c.status(1)?.estado, "concluido");
  assert.deepEqual(c.commits(), ["feat: Cachear [I-1.T1]"]);
  const registrado = commitDoTicketDemanda(c.banco, DEMANDA, 1);
  assert.deepEqual(
    registrado?.arquivos.map((a) => [a.caminho, a.adicionadas]),
    [["novo.txt", 2]],
  );
  assert.match(rodarGit(c.worktree, "show", "--stat", "--format=", "HEAD"), /novo\.txt\s+\|\s+2 \+\+/);
  assert.deepEqual(c.evidencias(1), ["execucao_testes", "matriz_fitness", "relatorio_sonar"]);
  const anexos = c.banco.prepare("SELECT caminho FROM arquivo_evidencia ORDER BY caminho").all();
  assert.deepEqual(
    anexos.map((a) => a.caminho),
    TIPOS.map((t) => `${t}.log`).sort(),
  );
  const ag = c.ag();
  assert.deepEqual(
    ag.evidencias.map((evidencia) => evidencia.autor),
    TIPOS.map(() => ({ tipo: "fabriquinha" })),
  );
  assert.equal(ag.rodadas[0]?.estado, "revisar_rodada");
  assert.equal(ag.tickets.filter((t) => t.etapa === "revisar_rodada").length, 1);
});

test("CA-4: o Sonar no formato real (logs vazios) grava o relatório como anexo", async () => {
  const c = await cenarioDeImplementacao();
  await conduzir(c, 1, coletor([...todas(true).slice(0, 2), { ...verif("relatorio_sonar", true), logs: [] }]));
  assert.equal(c.status(1)?.estado, "concluido");
  const anexo = c.banco.prepare("SELECT caminho FROM arquivo_evidencia WHERE caminho LIKE 'relatorio_sonar%'").all();
  assert.deepEqual(
    anexo.map((a) => a.caminho),
    ["relatorio_sonar.log"],
  );
});

test("a rodada só avança com a última implementação concluída", async () => {
  const pendente = await cenarioDeImplementacao({
    tickets: [
      ticket(1, "implementar", "aberto", { rodada_id: 1 }),
      ticket(2, "implementar", "aberto", { rodada_id: 1 }),
    ],
  });
  await conduzir(pendente, 1, coletor(todas(true)));
  assert.equal(pendente.status(1)?.estado, "concluido");
  assert.equal(pendente.ag().rodadas[0]?.estado, "implementar");
  assert.deepEqual(pendente.commits(), ["feat: Cache [I-1.T1]"]); // sem título no ticket, vale o da demanda

  const ultima = await cenarioDeImplementacao({
    tickets: [
      ticket(1, "implementar", "aberto", { rodada_id: 1 }),
      ticket(2, "implementar", "concluido", { rodada_id: 1 }),
    ],
  });
  await conduzir(ultima, 1, coletor(todas(true)));
  assert.equal(ultima.ag().rodadas[0]?.estado, "revisar_rodada");
});

test("CA-6: a primeira reprovação técnica devolve ao agente com o relatório e o fim do log", async () => {
  const c = await cenarioDeImplementacao();
  await conduzir(
    c,
    1,
    coletor([verif("execucao_testes", false, "npm test saiu com código 1"), ...todas(true).slice(1)]),
  );
  const t = c.status(1);
  assert.deepEqual([t?.estado, c.reprovacoes(1)], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /^- execucao_testes: npm test saiu com código 1\n\na+FIM$/);
  assert.equal(t?.instrucao?.split("\n\n")[1]?.length, 2000);
  assert.deepEqual(c.commits(), []);
  // A recusada não vira evidência; a Tentativa de reprovação leva o relatório com o log.
  assert.deepEqual(c.evidencias(1), ["matriz_fitness", "relatorio_sonar"]);
  const [reprovacao] = c.ag().tentativas.filter((x) => x.resultado?.tipo === "reprovacao");
  assert.match(
    reprovacao?.resultado?.tipo === "reprovacao" ? reprovacao.resultado.motivo : "",
    /^- execucao_testes: .*FIM$/s,
  );
});

test("CA-7 e CA-8: na terceira reprovação o ticket falha e bloqueia a rodada até a reabertura", async () => {
  const c = await cenarioDeImplementacao({
    reprovacoesAnteriores: 2,
    tickets: [
      ticket(1, "implementar", "aberto", { rodada_id: 1 }),
      ticket(2, "implementar", "aberto", { rodada_id: 1 }),
    ],
  });
  await conduzir(c, 1, coletor([verif("matriz_fitness", false, "f reprovou"), ...todas(true).slice(0, 1)]));
  assert.equal(c.status(1)?.estado, "falhou");
  assert.match(c.motivo(1) ?? "", /^- matriz_fitness: f reprovou/);
  assert.deepEqual(new Despacho().selecionar(situacaoDeUmaDemanda(c.ag(), true)).prontos, []);
});

const MOTIVO_SEM_ALTERACAO = "o ticket I-1.T1 terminou sem alteração na worktree e não gera commit vazio";
const marcaDoTicket = (c: CenarioDeImplementacao) =>
  rodarGit(c.worktree, "log", "--fixed-strings", "--grep", "[I-1.T1]", "--format=%H");

test("implementar sem alteração na worktree é devolvido, sem commit", async () => {
  const c = await cenarioDeImplementacao();
  c.piFalso.roteirizar([{}]);
  await conduzir(c, 1, coletor(todas(true)));
  const t = c.status(1);
  assert.deepEqual([t?.estado, c.reprovacoes(1)], ["aberto", 1]);
  assert.ok(t?.instrucao?.startsWith(MOTIVO_SEM_ALTERACAO));
  assert.equal(marcaDoTicket(c), "");
});

test("implementar sem alteração já devolvido duas vezes falha, e a rodada segue em desenvolvimento", async () => {
  const c = await cenarioDeImplementacao();
  c.reprovarDuasVezes(1);
  c.piFalso.roteirizar([{}]);
  await conduzir(c, 1, coletor(todas(true)));
  assert.equal(c.status(1)?.estado, "falhou");
  assert.ok(c.motivo(1)?.startsWith(MOTIVO_SEM_ALTERACAO));
  assert.equal(marcaDoTicket(c), "");
  const ag = c.ag();
  assert.equal(ag.rodadas[0]?.estado, "implementar");
  assert.equal(ag.tickets.filter((x) => x.etapa === "revisar_rodada").length, 0);
});

test("CA-9 e CA-10: falha do agente falha o ticket sem coletar nem gravar evidência", async () => {
  const c = await cenarioDeImplementacao();
  c.piFalso.roteirizar([{ parada: "error", erro: "timeout" }]);
  await conduzir(c, 1, naoColeta);
  assert.deepEqual(
    [c.status(1)?.estado, c.motivo(1) ?? "", c.reprovacoes(1)],
    ["falhou", "o agente parou com stopReason error: timeout", 0],
  );
  assert.deepEqual(c.evidencias(1), []);
});

test("CA-11: infraestrutura falha o ticket com o motivo, sem devolução nem evidência", async () => {
  const c = await cenarioDeImplementacao();
  await conduzir(
    c,
    1,
    coletor([...todas(true).slice(0, 2), verif("relatorio_sonar", undefined, "SonarQube fora do ar")]),
  );
  assert.deepEqual([c.status(1)?.estado, c.reprovacoes(1)], ["falhou", 0]);
  assert.match(c.motivo(1) ?? "", /infraestrutura:\n- SonarQube fora do ar/);
  assert.deepEqual(c.evidencias(1), []);
});

test("CA-15 e CA-16: repetido depois do commit, não coleta, não duplica commit nem evidência", async () => {
  const c = await cenarioDeImplementacao({
    tickets: [
      ticket(1, "implementar", "aberto", { rodada_id: 1 }),
      ticket(2, "implementar", "aberto", { rodada_id: 1 }),
    ],
  });
  await conduzir(c, 1, coletor(todas(true)));
  // queda depois do commit: o ticket foi reaberto, o registro do commit não foi gravado e o ticket 2 concluiu
  c.banco.exec("DELETE FROM arquivo_commit_demanda; DELETE FROM commit_ticket_demanda");
  c.banco.exec("UPDATE ticket_demanda SET estado = 'aberto' WHERE ticket_id = 1");
  c.banco.exec("UPDATE ticket_demanda SET estado = 'concluido' WHERE ticket_id = 2");
  await conduzir(c, 1, naoColeta);
  assert.equal(c.status(1)?.estado, "concluido");
  assert.equal(c.ag().rodadas[0]?.estado, "revisar_rodada");
  assert.equal(commitDoTicketDemanda(c.banco, DEMANDA, 1)?.arquivos.length, 1);
  assert.equal(c.commits().length, 1);
  assert.deepEqual(c.evidencias(1), ["execucao_testes", "matriz_fitness", "relatorio_sonar"]);
});

test("CA-16: commit sem as evidências devolve o ticket citando o que falta", async () => {
  const c = await cenarioDeImplementacao();
  writeFileSync(join(c.worktree, "novo.txt"), "x\ny\n");
  await commitarTicketDemanda(c.banco, ref(1), {
    ambiente: new AmbienteHostLocal(),
    worktree: c.worktree,
    tipo: "feat",
    titulo: "Cachear",
    etapa: "implementar",
  });
  await conduzir(c, 1, naoColeta);
  const t = c.status(1);
  assert.deepEqual([t?.estado, c.reprovacoes(1)], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /faltam as evidências: execucao_testes, matriz_fitness, relatorio_sonar/);
});

test("verificações reprovadas não viram evidência: o ticket é devolvido só com a Tentativa de reprovação", async () => {
  const c = await cenarioDeImplementacao();
  await conduzir(c, 1, coletor(todas(false)));
  assert.deepEqual([c.status(1)?.estado, c.reprovacoes(1)], ["aberto", 1]);
  assert.deepEqual(c.evidencias(1), []);
});

test("verificação que passou com dados que o schema recusa é devolvida com o motivo do Avaliador, sem evidência", async () => {
  const c = await cenarioDeImplementacao();
  const semComandos = { ...verif("execucao_testes", true), dados: { comandos: [] } };
  await conduzir(c, 1, coletor([semComandos, ...todas(true).slice(1)]));
  const t = c.status(1);
  assert.deepEqual([t?.estado, c.reprovacoes(1)], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /^- execucao_testes: .*comandos/s);
  assert.deepEqual(c.evidencias(1), ["matriz_fitness", "relatorio_sonar"]);
});

function hook(c: CenarioDeImplementacao, corpo: string) {
  const hooks = join(c.worktree, "..", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\n${corpo}\n`);
  chmodSync(join(hooks, "pre-commit"), 0o755);
  rodarGit(c.worktree, "config", "core.hooksPath", hooks);
}

test("o hook que reprova o commit devolve o ticket com a saída, sem commit; na 3ª falha", async () => {
  const c = await cenarioDeImplementacao();
  hook(c, "echo lint quebrou\nexit 1");
  await conduzir(c, 1, coletor(todas(true)));
  const t = c.status(1);
  assert.deepEqual([t?.estado, c.reprovacoes(1)], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /lint quebrou/);
  assert.deepEqual(c.commits(), []);

  const e = await cenarioDeImplementacao();
  hook(e, "echo lint quebrou\nexit 1");
  e.reprovarDuasVezes(1);
  await conduzir(e, 1, coletor(todas(true)));
  assert.equal(e.status(1)?.estado, "falhou");
  assert.match(e.motivo(1) ?? "", /lint quebrou/);
});

test("o erro que não é reprovação do commit falha o ticket e vai ao log, sem deixá-lo em execução", async () => {
  const c = await cenarioDeImplementacao({ tickets: [ticket(1, "implementar", "aberto", { rodada_id: 1 })] });
  c.banco.exec(`INSERT INTO commit_ticket_demanda (sha, demanda_id, ticket_id, mensagem, em)
    VALUES ('${"a".repeat(40)}', 'I-1', 1, 'outro', '2026-01-01T00:00:00.000Z')`);
  await conduzir(c, 1, coletor(todas(true)));
  assert.equal(c.status(1)?.estado, "falhou");
  assert.match(c.motivo(1) ?? "", /^fechamento falhou: .*já tem commit/);
});

test("o commit que passa do limite falha por infraestrutura, sem devolução", async () => {
  const c = await cenarioDeImplementacao();
  hook(c, "exec sleep 5");
  await conduzir(c, 1, { ...coletor(todas(true)), limiteCommitMs: 300 });
  assert.deepEqual([c.status(1)?.estado, c.reprovacoes(1)], ["falhou", 0]);
  assert.match(c.motivo(1) ?? "", /^falha de infraestrutura/);
});

test("problema commita como fix; sem coletor injetado o real roda e o Sonar sem ambiente é infraestrutura", async () => {
  const c = await cenarioDeImplementacao({ tipo: "problema" });
  await conduzir(c, 1, coletor(todas(true)));
  assert.deepEqual(c.commits(), ["fix: Cachear [I-1.T1]"]);
  const d = await cenarioDeImplementacao({ tipo: "problema" });
  delete process.env.SONAR_HOST_URL;
  await conduzir(d, 1, {});
  assert.match(d.motivo(1) ?? "", /^falha de infraestrutura:\n- SONAR_HOST_URL/);
});

test("I-246.T15: parada marcada depois da coleta, com o hook reprovando o commit ou depois do commit: falha 'serviço reiniciado', sem devolução", async () => {
  // `chamada` é a consulta à parada que responde sim: 1 depois da coleta, 2 no erro do commit ou depois dele.
  for (const [chamada, hookCorpo] of [
    [1, undefined],
    [2, "echo lint quebrou\nexit 1"],
    [2, undefined],
  ] as const) {
    const c = await cenarioDeImplementacao();
    if (hookCorpo) hook(c, hookCorpo);
    let consultas = 0;
    class CondutorQueParaNaConsulta extends CondutorDeTrabalhos {
      override emParada(): boolean {
        return ++consultas === chamada;
      }
    }
    await conduzir(c, 1, coletor(todas(true)), new CondutorQueParaNaConsulta());
    const t = c.status(1);
    assert.deepEqual([t?.estado, c.reprovacoes(1), c.motivo(1)], ["falhou", 0, "serviço reiniciado"]);
    if (chamada === 1) assert.deepEqual(c.evidencias(1), []);
  }
});
