// Encerramento da rodada com banco real, git real, pi falso e hospedagem falsa (CA-2 a CA-12 da I-227).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  BRANCH_DEMANDA,
  BRANCH_RODADA,
  cenario,
  DEMANDA,
  hospedagem,
  MARCA,
  REF,
} from "../../../../../../apoio-testes/cenario_de_encerramento_rodada.ts";
import { commitarArquivo, rodarGit } from "../../../../../../apoio-testes/repositorio_de_teste.ts";
import { ErroDeRegra, ErroExterno } from "../../../../../shared/nucleo/erros.ts";
import { cursorDaBase, caminhoDaWorktreeRodada } from "../../../../repositorio/publico.ts";
import { anexosDaDemanda, schemaDoTipo } from "../../../evidencias/publico.ts";
import { conferirEncerramentoRodada } from "./encerramento_rodada.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";

const conferir = (banco: Parameters<typeof conferirEncerramentoRodada>[0], ref: typeof REF) =>
  conferirEncerramentoRodada(banco, relogioFixo("2026-01-01T00:00:00.000Z"), ref);

test("CA-2, CA-7, CA-12 e CA-13: o PR vai da branch da rodada para a da demanda, nunca para a base, e a rodada fica no gate", async () => {
  const { c, banco, ag, ticket, evidencia, noRemoto, rodada } = await cenario();

  await conferir(banco, REF);

  const prs = hospedagem.prs();
  assert.deepEqual(
    prs.map((p) => [p.head, p.base]),
    [[BRANCH_RODADA, BRANCH_DEMANDA]],
  );
  assert.equal(noRemoto(BRANCH_RODADA), rodarGit(rodada, "rev-parse", "HEAD"));
  assert.equal(noRemoto(BRANCH_DEMANDA), rodarGit(c.repo, "rev-parse", BRANCH_DEMANDA));
  assert.equal(ag().rodadas[0]?.estado, "gate_pr");
  assert.equal(ticket()?.estado, "em_execucao");
  const pr = prs[0];
  assert.ok(pr);
  assert.equal(pr.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.ok(pr.corpo.startsWith(MARCA));
  assert.match(pr.corpo, /I-206\.T3/);
  assert.match(pr.corpo, /I-206\.T4/);
  assert.doesNotMatch(`${pr.titulo}\n${pr.corpo}`, /T-\d/);
  assert.deepEqual(evidencia("pr_aberto")?.dados, {
    hospedagem: "github",
    id: "1",
    url: "https://github.com/org/loja/pull/1",
    branch: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    head: rodarGit(rodada, "rev-parse", "HEAD"),
    corpoCompleto: pr.corpo,
    condensado: false,
  });
  assert.deepEqual(evidencia("pr_aberto")?.autor, { tipo: "fabriquinha" });
  assert.deepEqual(
    ag().pull_requests.map(({ rodada_id, numero, url, head, estado }) => ({ rodada_id, numero, url, head, estado })),
    [
      {
        rodada_id: 2,
        numero: 1,
        url: "https://github.com/org/loja/pull/1",
        head: rodarGit(rodada, "rev-parse", "HEAD"),
        estado: "aberto",
      },
    ],
  );
  assert.deepEqual(evidencia("relatorio_produtividade")?.autor, { tipo: "fabriquinha" });
  // Sem custo medido em nenhum ticket: incompleto, nunca somado como zero (CA-12).
  const relatorio = evidencia("relatorio_produtividade")?.dados as {
    tickets: { ticket: string; custoIncompleto: boolean }[];
    total: { custoIncompleto: boolean };
  };
  assert.deepEqual(
    relatorio.tickets.map((t) => [t.ticket, t.custoIncompleto]),
    [
      ["I-206.T3", true],
      ["I-206.T4", true],
      ["I-206.T5", true],
      ["I-206.T8", true],
    ],
  );
  assert.equal(relatorio.total.custoIncompleto, true);
});

test("o pr_aberto gravado pelo encerramento passa no schema, sem anexo", async () => {
  const { banco, evidencia } = await cenario();

  await conferir(banco, REF);

  const gravada = evidencia("pr_aberto");
  assert.ok(gravada);
  assert.equal(schemaDoTipo("pr_aberto").dados.safeParse(gravada.dados).success, true);
  assert.deepEqual(
    anexosDaDemanda(banco, DEMANDA).filter((a) => a.ticket_id === 8),
    [],
  );
});

test("pr_aberto inválido (a hospedagem devolve uma url sem endereço): a conferência recusa e a evidência não é gravada", async () => {
  const { banco, evidencia, estado } = await cenario();
  hospedagem.responder("pr create", "/pull/7");

  await assert.rejects(conferir(banco, REF), (e: unknown) => e instanceof ErroDeRegra);

  assert.equal(evidencia("pr_aberto"), undefined);
  assert.equal(estado(), "encerrar_rodada");
});

test("CA-3: a ponta nova da demanda entra na rodada antes do PR, e o merge da D04 não barra a publicação", async () => {
  const { banco, demanda, rodada, noRemoto } = await cenario();
  const nova = commitarArquivo(demanda, "da-demanda.txt", "nova\n");

  await conferir(banco, REF);

  rodarGit(rodada, "merge-base", "--is-ancestor", nova, "HEAD");
  assert.equal(noRemoto(BRANCH_RODADA), rodarGit(rodada, "rev-parse", "HEAD"));
  assert.equal(hospedagem.prs().length, 1);
});

test("a base é varrida uma vez antes de publicar o PR, e a falha da varredura só vai ao log", async () => {
  const varrida = await cenario();
  await conferir(varrida.banco, REF);
  assert.equal(
    cursorDaBase(varrida.banco, "loja"),
    rodarGit(varrida.c.repo, "rev-parse", "refs/remotes/origin/integracao"),
  );

  const sem = await cenario();
  sem.banco.exec("DROP TABLE varredura_base"); // a varredura falha ao ler o cursor
  await conferir(sem.banco, REF);
  assert.equal(hospedagem.prs().length, 1);
  assert.match(
    readFileSync(join(sem.c.raiz, "execucoes", "encerramento-I-206.R2.log"), "utf8"),
    /varrerCommitsHumanos falhou: .*varredura_base/,
  );
});

test("CA-4: conflito com a ponta da demanda não publica PR e volta a desenvolvimento com um corretivo para o merge", async () => {
  const { banco, demanda, ag, estado, noRemoto } = await cenario();
  commitarArquivo(demanda, "a.txt", "da demanda\n");
  commitarArquivo(demanda, "b.txt", "da demanda\n");

  await conferir(banco, REF);

  assert.deepEqual(hospedagem.prs(), []);
  assert.equal(noRemoto(BRANCH_RODADA), "");
  assert.equal(estado(), "implementar");
  const corretivos = ag().tickets.filter((t) => t.ticket_id > 8);
  assert.equal(corretivos.length, 1);
  const [corretivo] = corretivos;
  assert.equal(corretivo?.etapa, "implementar");
  assert.deepEqual(
    ag()
      .caminhos_ticket.filter((x) => x.ticket_id === corretivo.ticket_id)
      .map((x) => x.caminho)
      .sort(),
    ["a.txt", "b.txt"],
  );
  assert.equal(ag().tickets.find((t) => t.ticket_id === 8)?.estado, "concluido");
});

test("CA-5 e CA-8: PR da queda adotado pela marca, sem PR novo, com conflito: volta a desenvolvimento e conclui o ticket", async () => {
  const { banco, ag, ticket, evidencia, estado } = await cenario();
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: `${MARCA}\nvelho`,
    estado: "aberto",
    conflito: true,
  });

  await conferir(banco, REF);

  const prs = hospedagem.prs();
  assert.equal(prs.length, 1);
  assert.equal(prs[0]?.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.equal(evidencia("pr_aberto")?.dados.id, "1");
  assert.equal(evidencia("pr_aberto")?.dados.url, "https://github.com/org/loja/pull/1");
  assert.equal(estado(), "implementar");
  assert.equal(ticket()?.estado, "concluido");
  const corretivo = ag().tickets.find((t) => t.ticket_id > 8);
  assert.match(corretivo?.titulo ?? "", /conflito do PR da I-206\.R2/);
  assert.doesNotMatch(corretivo?.descricao ?? "", /T-\d/);
});

test("CA-6: check de CI falho volta a desenvolvimento com uma correção por check, sem chegar ao gate", async () => {
  const { banco, ag, estado } = await cenario();
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: `${MARCA}\nvelho`,
    estado: "aberto",
    checks: [
      { nome: "lint", estado: "falho" },
      { nome: "ci/teste", estado: "falho" },
      { nome: "build", estado: "aprovado" },
    ],
  });

  await conferir(banco, REF);

  assert.equal(estado(), "implementar");
  assert.deepEqual(
    ag()
      .tickets.filter((t) => t.ticket_id > 8)
      .map((t) => t.titulo),
    ["Corrigir o check lint do PR da I-206.R2", "Corrigir o check ci/teste do PR da I-206.R2"],
  );
  assert.match(
    ag().tickets.find((t) => t.titulo === "Corrigir o check lint do PR da I-206.R2")?.descricao ?? "",
    /https:\/\/ci.exemplo.com\/lint/,
  );
});

test("o PR de um encerrar_rodada anterior da rodada é conhecido, mesmo sem a marca do ticket atual", async () => {
  const { banco, estado, ag } = await cenario({ anterior: true });
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: "sem marca",
    estado: "aberto",
  });

  await conferir(banco, REF);

  assert.equal(hospedagem.prs().length, 1);
  assert.equal(hospedagem.prs()[0]?.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.equal(estado(), "gate_pr");
  assert.deepEqual(
    ag().pull_requests.map((pr) => [pr.rodada_id, pr.numero]),
    [[2, 1]],
  );
});

test("CA-9: commit que nenhum ticket registrou falha antes do push, diz como desfazer e não cria PR", async () => {
  const { banco, rodada, evidencia, noRemoto, c } = await cenario();
  const orfao = commitarArquivo(rodada, "fora.txt", "fora\n");

  await assert.rejects(
    conferir(banco, REF),
    (e: unknown) =>
      e instanceof ErroDeRegra &&
      e.message.includes(orfao.slice(0, 12)) &&
      e.message.includes("nenhum ticket de desenvolvimento da I-206.R2 registrou") &&
      e.message.includes(`git -C ${caminhoDaWorktreeRodada(c.raiz, "loja", REF)} reset --hard HEAD~1`),
  );

  assert.equal(noRemoto(BRANCH_RODADA), "");
  assert.deepEqual(hospedagem.prs(), []);
  assert.equal(evidencia("pr_aberto"), undefined);
});

test("commit da base publicada trazido por merge para a rodada não é órfão", async () => {
  const { banco, rodada, c, estado } = await cenario();
  commitarArquivo(c.repo, "da-base.txt", "base nova\n");
  rodarGit(c.repo, "push", "-q", "origin", "integracao");
  rodarGit(rodada, "fetch", "-q", "origin", "integracao");
  rodarGit(rodada, "merge", "-q", "--no-ff", "--no-edit", "FETCH_HEAD");

  await conferir(banco, REF);

  assert.equal(estado(), "gate_pr");
});

test("CA-10: a hospedagem recusa o PR, o erro traz a saída do comando e o pr_aberto não é gravado", async () => {
  const { banco, evidencia, estado } = await cenario();
  hospedagem.falhar("pr create", "GraphQL: sem permissão");

  await assert.rejects(
    conferir(banco, REF),
    (e: unknown) => e instanceof ErroExterno && e.message.includes("GraphQL: sem permissão"),
  );

  assert.equal(evidencia("pr_aberto"), undefined);
  assert.equal(estado(), "encerrar_rodada");
});

test("CA-11: sem a documentação do agente o domínio recusa a conferência; o ticket segue em execução e nada é publicado", async () => {
  const { banco, ticket, evidencia } = await cenario({ documentacao: false });

  await assert.rejects(
    conferir(banco, REF),
    (e: unknown) => e instanceof ErroDeRegra && e.message.startsWith("a documentação ainda não foi entregue"),
  );

  assert.equal(ticket()?.estado, "em_execucao");
  assert.equal(evidencia("relatorio_produtividade"), undefined);
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("pré-condições: rodada fora de encerramento, rodada ou ticket inexistente e ticket fora de execução recusam sem efeito", async () => {
  const fora = await cenario({ estado: "implementar" });
  await assert.rejects(conferir(fora.banco, REF), /está em implementar e a demanda em em_execucao/);

  const inexistente = await cenario();
  await assert.rejects(conferir(inexistente.banco, { ...REF, rodada_id: 9 }), /rodada I-206\.R9 não existe/);

  const sem = await cenario({ semTicketEncerrar: true });
  await assert.rejects(conferir(sem.banco, REF), /não tem ticket encerrar_rodada/);

  const aberto = await cenario({ statusEncerrar: "aberto" });
  await assert.rejects(conferir(aberto.banco, REF), /I-206\.T8 está aberto/);
  assert.equal(aberto.ticket()?.estado, "aberto");
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("corpo além do limite da hospedagem: o pi padrão resume a demanda e o custo, e as seções do mensagem_pr ficam inteiras", async () => {
  const { c, banco, evidencia, piFalso } = await cenario({ descricao: `longa${"x".repeat(75)} `.repeat(900) });
  piFalso.roteirizar([{ chamadaUnica: { saida: "Resumo da I-206." } }]);

  await conferir(banco, REF);

  const corpo = hospedagem.prs()[0]?.corpo ?? "";
  assert.ok(corpo.length <= 65_536);
  assert.ok(corpo.startsWith(`${MARCA}\n\n## Contexto (resumido)\n\nResumo da I-206.\n\n## O que mudou`));
  assert.match(corpo, /## Como revisar\n\n1\. Leia o diff\./);
  assert.doesNotMatch(corpo, /longa/);
  const resumo = piFalso
    .registro()
    .filter((entrada) => entrada.evento === "chamada_unica")
    .map((entrada) => entrada.argv?.at(-1))
    .find((prompt) => prompt?.startsWith("Resuma"));
  assert.match(String(resumo), /## Por quê[\s\S]*longa[\s\S]*## Autoria e custo/);
  assert.doesNotMatch(String(resumo), /## Como revisar/);
  assert.equal((evidencia("pr_aberto")?.dados as { condensado: boolean }).condensado, true);
  assert.doesNotMatch(readFileSync(join(c.raiz, "execucoes", "encerramento-I-206.R2.log"), "utf8"), /não resumiu/);
});

test("corpo além do limite e o pi sem resumo: o PR vai sem o contexto, e o log diz por quê", async () => {
  const { c, banco } = await cenario({ descricao: `longa${"x".repeat(75)} `.repeat(900) });

  await conferir(banco, REF);

  const corpo = hospedagem.prs()[0]?.corpo ?? "";
  assert.ok(corpo.startsWith(`${MARCA}\n\n## O que mudou`));
  assert.match(corpo, /## Como revisar\n\n1\. Leia o diff\./);
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "encerramento-I-206.R2.log"), "utf8"),
    /I-206\.R2: o pi não resumiu o contexto do PR em [\d]+ caracteres; vai sem ele/,
  );
});
