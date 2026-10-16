import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import type { Ator, Evidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { registrarEvidencia } from "../dominio/evidencia.ts";
import { iniciarExecucao, terminarExecucao } from "../dominio/execucao.ts";
import { decidirDesenho, decidirRegistro, enviarParaAprovacao } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
import { adicionarTicketDesenvolvimento } from "../dominio/tickets.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { abrir, escrever } from "../persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { coletarFitness, coletarTestes } from "./coletores.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-coletores-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const agente = (execucao: number, ticket: number): Ator => ({ tipo: "agente", execucao, ticket });

type Etapa = "desenho" | "desenvolvimento" | "revisao";

interface Cenario {
  banco: DatabaseSync;
  raiz: string;
  worktree: string;
  /** O ticket em execução na etapa pedida. */
  ticket: number;
  /** A evidência `tipo` do ticket em execução. */
  evidencia(tipo: string): Evidencia;
  /** O conteúdo guardado do anexo `nome` da evidência `tipo` do ticket em execução. */
  log(tipo: string, nome: string): string;
}

/** C5 pelo comIssue; devolve a execução criada. */
function iniciar(banco: DatabaseSync, ticket: number, modo: string): number {
  const ag = comIssue(banco, 1, "iniciarExecucao", fabriquinha, (atual, ctx) =>
    iniciarExecucao(atual, { ticket, modo, sessaoPi: randomUUID() }, fabriquinha, ctx),
  );
  return ag.execucoes.find((e) => e.ticket === ticket && e.resultado === "em_andamento")?.id ?? 0;
}

/**
 * O agente da `execucao` registra as evidências obrigatórias do `ticket`, o envia à aprovação (C25, registro e
 * desenho) e a execução termina com sucesso (C17, C6).
 */
function cumprir(banco: DatabaseSync, execucao: number, ticket: number, tipos: string[]): void {
  const ator = agente(execucao, ticket);
  for (const tipo of tipos) {
    comIssue(banco, 1, "registrarEvidencia", ator, (ag, ctx) =>
      registrarEvidencia(ag, { ticket, tipo, dados: {}, arquivos: [] }, ator, ctx),
    );
  }
  comIssue(banco, 1, "enviarParaAprovacao", ator, (ag, ctx) => enviarParaAprovacao(ag, { ticket }, ator, ctx));
  comIssue(banco, 1, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );
}

/**
 * I-1 do projeto `loja` levada pelos comandos reais até `etapa`, com o ticket dela em execução e a worktree criada:
 * registro (T-1) aprovado, desenho (T-2, interativo) que propõe o T-3 de desenvolvimento, gate de desenho aprovado.
 * Revisão ainda não tem a transição real (tickets 15 e 16): o T-3 passa a revisão por UPDATE e roda por C5.
 */
function cenario(
  testes: string[],
  fitness: { nome: string; comando: string; descricao: string }[] = [{ nome: "f", comando: "true", descricao: "d" }],
  etapa: Etapa = "desenvolvimento",
): Cenario {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo: "/repos/loja",
    branchBase: "main",
    hospedagem: "github",
    testes,
    sonar: { projectKey: "loja" },
    fitness,
  });
  registrarIssue(banco, { projeto: "loja" }, auditor);
  comIssue(banco, 1, "editarIssue", auditor, (ag) =>
    editarIssue(ag, { titulo: "Busca lenta", tipo: "problema" }, auditor),
  );
  cumprir(banco, iniciar(banco, 1, "interativo"), 1, ["comportamento", "criterios_aceite"]);
  comIssue(banco, 1, "decidirRegistro", auditor, (ag, ctx) => decidirRegistro(ag, { aprovado: true }, auditor, ctx));

  const desenho = iniciar(banco, 2, "interativo");
  const desenhista = agente(desenho, 2);
  comIssue(banco, 1, "adicionarTicketDesenvolvimento", desenhista, (ag, ctx) =>
    adicionarTicketDesenvolvimento(ag, { titulo: "Cache da busca" }, desenhista, ctx),
  );
  let ticket = 2;
  if (etapa !== "desenho") {
    cumprir(banco, desenho, 2, ["desenho_solucao", "relatorio_complexidade", "relatorio_impactos_arquitetura"]);
    comIssue(banco, 1, "decidirDesenho", auditor, (ag, ctx) => decidirDesenho(ag, { aprovado: true }, auditor, ctx));
    if (etapa === "revisao")
      banco.exec("UPDATE issue SET fase = 'revisao'; UPDATE ticket SET etapa = 'revisao' WHERE id = 3");
    iniciar(banco, 3, "autonomo");
    ticket = 3;
  }

  const worktree = join(raiz, "worktrees", "loja", "I-1");
  mkdirSync(worktree, { recursive: true });
  const evidencia = (tipo: string) => {
    const e = agregado(banco, 1)?.evidencias.find((x) => x.ticket === ticket && x.tipo === tipo);
    assert.ok(e, `T-${String(ticket)} sem ${tipo}`);
    return e;
  };
  return {
    banco,
    raiz,
    worktree,
    ticket,
    evidencia,
    log(tipo, nome) {
      const arquivo = evidencia(tipo).arquivos.find((a) => a.nome === nome);
      assert.ok(arquivo, `${tipo} sem o anexo ${nome}`);
      assert.equal(arquivo.mime, "text/plain; charset=utf-8");
      return readFileSync(caminhoArquivo(banco, arquivo.sha256), "utf8");
    },
  };
}

const semDuracao = (dados: unknown) =>
  JSON.parse(JSON.stringify(dados, (k, v: unknown) => (k === "duracaoMs" ? 0 : v))) as unknown;

test("testes: roda todos na worktree, mesmo depois de falha; não encontrado e estouro reprovam", async () => {
  const c = cenario(["pwd; echo aviso >&2", "false", "comando-que-nao-existe-na-fabriquinha", "sleep 30", "true"]);
  const ag = await coletarTestes(c.banco, c.ticket, 300);

  assert.deepEqual(agregado(c.banco, 1), ag);
  const e = c.evidencia("execucao_testes");
  assert.deepEqual(
    { ...e, dados: semDuracao(e.dados), arquivos: e.arquivos.map((a) => a.nome) },
    {
      id: e.id,
      ticket: 3,
      tipo: "execucao_testes",
      produtor: "fabriquinha",
      aprovada: false,
      dados: {
        comandos: [
          { comando: "pwd; echo aviso >&2", codigoSaida: 0, estourou: false, duracaoMs: 0, log: "teste-1.log" },
          { comando: "false", codigoSaida: 1, estourou: false, duracaoMs: 0, log: "teste-2.log" },
          {
            comando: "comando-que-nao-existe-na-fabriquinha",
            codigoSaida: 127,
            estourou: false,
            duracaoMs: 0,
            log: "teste-3.log",
          },
          { comando: "sleep 30", codigoSaida: null, estourou: true, duracaoMs: 0, log: "teste-4.log" },
          { comando: "true", codigoSaida: 0, estourou: false, duracaoMs: 0, log: "teste-5.log" },
        ],
      },
      arquivos: ["teste-1.log", "teste-2.log", "teste-3.log", "teste-4.log", "teste-5.log"],
      em: e.em,
    },
  );
  const comandos = e.dados.comandos as { duracaoMs: number }[];
  assert.ok((comandos[3]?.duracaoMs ?? 0) >= 300);
  assert.equal(c.log("execucao_testes", "teste-1.log"), `${c.worktree}\naviso\n`);
  assert.match(c.log("execucao_testes", "teste-3.log"), /comando-que-nao-existe-na-fabriquinha: (command )?not found/);
  assert.equal(c.log("execucao_testes", "teste-5.log"), "");
  // C17 pelo caminho único: o comando fica registrado com o ator fabriquinha.
  assert.deepEqual(
    c.banco
      .prepare("SELECT nome, ator FROM comando ORDER BY id DESC LIMIT 1")
      .all()
      .map((l) => ({ ...l })),
    [{ nome: "registrarEvidencia", ator: "fabriquinha" }],
  );
});

test("testes: todos com código 0 aprovam, e coletar de novo substitui a evidência", async () => {
  const c = cenario(["true", "exit 0"]);
  await coletarTestes(c.banco, c.ticket);
  const primeira = c.evidencia("execucao_testes");
  const ag = await coletarTestes(c.banco, c.ticket);
  assert.deepEqual(
    ag.evidencias.filter((e) => e.ticket === c.ticket).map((e) => [e.id, e.tipo, e.aprovada]),
    [[primeira.id + 1, "execucao_testes", true]],
  );
});

test("fitness: cada fitness function vira uma linha da matriz, com nome, descrição e log", async () => {
  const fitness = [
    { nome: "dominio-sem-io", comando: "echo limpo", descricao: "domínio não faz I/O" },
    { nome: "lento", comando: "sleep 30", descricao: "estoura" },
  ];
  const c = cenario(["true"], fitness, "revisao");
  await coletarFitness(c.banco, c.ticket, 300);
  const e = c.evidencia("matriz_fitness");
  assert.deepEqual([e.ticket, e.produtor, e.aprovada], [3, "fabriquinha", false]);
  assert.deepEqual(semDuracao(e.dados), {
    linhas: [
      { ...fitness[0], codigoSaida: 0, estourou: false, duracaoMs: 0, log: "dominio-sem-io.log" },
      { ...fitness[1], codigoSaida: null, estourou: true, duracaoMs: 0, log: "lento.log" },
    ],
  });
  assert.equal(c.log("matriz_fitness", "dominio-sem-io.log"), "limpo\n");

  const verde = cenario(["true"], [{ nome: "ok", comando: "true", descricao: "passa" }]);
  await coletarFitness(verde.banco, verde.ticket);
  assert.equal(verde.evidencia("matriz_fitness").aprovada, true);
});

test("os comandos rodam fora de transação: outra conexão escreve enquanto eles rodam", async () => {
  const c = cenario(["while [ ! -f liberado ]; do sleep 0.05; done; echo fim"]);
  const coleta = coletarTestes(c.banco, c.ticket);
  // Com o lock de escrita preso, esta escrita esperaria o busy_timeout e falharia com SQLITE_BUSY.
  const outra = abrir(c.raiz);
  const inicio = Date.now();
  escrever(outra, () => {
    outra.exec("UPDATE issue SET descricao = 'mexida' WHERE id = 1");
  });
  assert.ok(Date.now() - inicio < 1000);
  outra.close();
  writeFileSync(join(c.worktree, "liberado"), "");
  const ag = await coleta;
  assert.equal(ag.issue.descricao, "mexida");
  assert.equal(c.log("execucao_testes", "teste-1.log"), "fim\n");
});

test("C17 e a worktree são conferidos antes de rodar: nada roda com ticket inexistente, fora de execução, de outra etapa ou sem worktree", async () => {
  const c = cenario(["touch rodou"], [{ nome: "f", comando: "touch rodou", descricao: "d" }], "desenho");
  await assert.rejects(
    coletarTestes(c.banco, 9),
    (e) => e instanceof ErroDeRegra && e.message === "o ticket T-9 não existe (confira o número do ticket)",
  );
  await assert.rejects(
    coletarFitness(c.banco, 2),
    (e) => e instanceof ErroDeRegra && e.message.startsWith("matriz_fitness não é evidência da etapa desenho"),
  );
  // O T-3, proposto pelo desenho, ainda está aberto.
  await assert.rejects(coletarTestes(c.banco, 3), /T-3 está aberto, não em execução/);
  assert.equal(existsSync(join(c.worktree, "rodou")), false);

  const semWorktree = cenario(["touch rodou"]);
  rmSync(semWorktree.worktree, { recursive: true });
  await assert.rejects(
    coletarTestes(semWorktree.banco, semWorktree.ticket),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message ===
        `a worktree da I-1 não existe em ${semWorktree.worktree} ` +
          "(execute o ticket de novo: a execução cria a worktree antes da coleta)",
  );
  for (const { banco } of [c, semWorktree]) {
    assert.deepEqual(
      agregado(banco, 1)?.evidencias.filter((e) => e.produtor === "fabriquinha"),
      [],
    );
  }
});

test("os comandos rodam sem credenciais de hospedagem nem do SonarQube; erro de sintaxe vai para o log", async (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });
  process.env = { ...original, GH_TOKEN: "segredo-gh", SONAR_TOKEN: "segredo-sonar" };
  const c = cenario(['echo "[$GH_TOKEN][$SONAR_TOKEN]"; test -z "$(ls -A "$GH_CONFIG_DIR")"', "npm test ("]);
  await coletarTestes(c.banco, c.ticket);
  assert.deepEqual(
    (c.evidencia("execucao_testes").dados.comandos as { codigoSaida: number }[]).map((x) => x.codigoSaida),
    [0, 2],
  );
  assert.equal(c.log("execucao_testes", "teste-1.log"), "[][]\n");
  assert.match(c.log("execucao_testes", "teste-2.log"), /syntax error/i);
});
