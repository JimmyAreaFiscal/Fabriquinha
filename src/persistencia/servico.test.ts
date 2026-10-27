// Configuração do serviço e consultas do agendador (F4 §3, §4.1, §10), com as issues levadas às fases pelos comandos
// do F1, como o serviço as encontraria.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ZodError } from "zod";
import type { Ator } from "../dominio/agregado.ts";
import { falharTicket, iniciarConsulta, iniciarExecucao, terminarExecucao } from "../dominio/execucao.ts";
import { registrarEvidencia } from "../dominio/evidencia.ts";
import { decidirDesenho, decidirRegistro, enviarParaAprovacao } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
import { adicionarTicketDesenvolvimento } from "../dominio/tickets.ts";
import { abrir } from "./banco.ts";
import { comIssue, registrarIssue } from "./issues.ts";
import { registrarProjeto } from "./projetos.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import {
  alterarLimiteParalelismo,
  autonomasEmAndamento,
  limiteParalelismo,
  configuracao,
  execucoesEmAndamento,
  salvarConfiguracao,
  ticketsElegiveis,
  ticketsAutonomosEmExecucao,
} from "./servico.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-servico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };

function novoBanco(): DatabaseSync {
  const banco = abrir(mkdtempSync(join(base, "raiz-")));
  registrarProjeto(banco, {
    nome: "loja",
    repo: "/repos/loja",
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
  return banco;
}

/** C5; devolve a execução nova. */
function iniciar(banco: DatabaseSync, issue: number, ticket: number, modo: string): number {
  const ag = comIssue(banco, issue, "iniciarExecucao", fabriquinha, (a, ctx) =>
    iniciarExecucao(a, { ticket, modo, sessaoPi: randomUUID() }, fabriquinha, ctx),
  );
  return ag.execucoes.at(-1)?.id ?? 0;
}

const terminar = (banco: DatabaseSync, issue: number, execucao: number) =>
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (a, ctx) =>
    terminarExecucao(a, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );

/** O agente da execução registra as evidências de `tipos` no ticket (C17). */
function evidencias(banco: DatabaseSync, issue: number, execucao: number, ticket: number, tipos: string[]): void {
  const agente: Ator = { tipo: "agente", execucao, ticket };
  for (const tipo of tipos) {
    comIssue(banco, issue, "registrarEvidencia", agente, (a, ctx) =>
      registrarEvidencia(a, { ticket, tipo, dados: {}, arquivos: [] }, agente, ctx),
    );
  }
}

/** O agente da execução envia o ticket à aprovação do Auditor (C25). */
const enviar = (banco: DatabaseSync, issue: number, execucao: number, ticket: number) => {
  const agente: Ator = { tipo: "agente", execucao, ticket };
  comIssue(banco, issue, "enviarParaAprovacao", agente, (a, ctx) => enviarParaAprovacao(a, { ticket }, agente, ctx));
};

/** C1, a sessão de registro e o gate aprovado (C10): a issue em `desenho`, com o ticket de desenho aberto. */
function emDesenho(banco: DatabaseSync, deps: number[] = []): { issue: number; desenho: number } {
  const { issue, tickets } = registrarIssue(banco, { projeto: "loja", deps }, auditor);
  const registro = tickets[0]?.id ?? 0;
  const execucao = iniciar(banco, issue.id, registro, "interativo");
  evidencias(banco, issue.id, execucao, registro, ["comportamento", "criterios_aceite"]);
  comIssue(banco, issue.id, "editarIssue", auditor, (a) =>
    editarIssue(a, { titulo: "Busca", tipo: "problema" }, auditor),
  );
  enviar(banco, issue.id, execucao, registro);
  terminar(banco, issue.id, execucao);
  const ag = comIssue(banco, issue.id, "decidirRegistro", auditor, (a, ctx) =>
    decidirRegistro(a, { aprovado: true }, auditor, ctx),
  );
  return { issue: issue.id, desenho: ag.tickets.at(-1)?.id ?? 0 };
}

/**
 * Até o gate de desenho: o desenho propõe tickets de desenvolvimento com os `titulos` e é enviado (C25), e a issue fica
 * em `aprovacao_desenho`. Com `aprovar`, o Auditor aprova (C15) e ela vai ao `desenvolvimento`.
 */
function desenhada(
  banco: DatabaseSync,
  titulos: string[],
  aprovar = true,
): { issue: number; desenho: number; desenvolvimento: number[] } {
  const { issue, desenho } = emDesenho(banco);
  const execucao = iniciar(banco, issue, desenho, "interativo");
  const agente: Ator = { tipo: "agente", execucao, ticket: desenho };
  for (const titulo of titulos) {
    comIssue(banco, issue, "adicionarTicketDesenvolvimento", agente, (a, ctx) =>
      adicionarTicketDesenvolvimento(a, { titulo }, agente, ctx),
    );
  }
  evidencias(banco, issue, execucao, desenho, [
    "desenho_solucao",
    "relatorio_complexidade",
    "relatorio_impactos_arquitetura",
  ]);
  enviar(banco, issue, execucao, desenho);
  terminar(banco, issue, execucao);
  const ag = aprovar
    ? comIssue(banco, issue, "decidirDesenho", auditor, (a, ctx) => decidirDesenho(a, { aprovado: true }, auditor, ctx))
    : undefined;
  return {
    issue,
    desenho,
    desenvolvimento: ag?.tickets.filter((t) => t.etapa === "desenvolvimento").map((t) => t.id) ?? [],
  };
}

test("configuração: linha única, agendador desligado por padrão, salvar validado por zod", () => {
  const banco = novoBanco();
  assert.deepEqual(configuracao(banco), {
    agendadorAtivo: false,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    modeloAuditoria: null,
  });

  const nova = {
    agendadorAtivo: true,
    intervaloMin: 1,
    timeoutMin: 1440,
    ociosidadeMin: 5,
    modeloAuditoria: { provedor: "anthropic", modelo: "claude-opus-5-5" },
  };
  assert.deepEqual(salvarConfiguracao(banco, nova), nova);
  assert.deepEqual(configuracao(banco), nova);
  // Campo ausente volta ao padrão do schema.
  assert.deepEqual(salvarConfiguracao(banco, { agendadorAtivo: true }), {
    agendadorAtivo: true,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    modeloAuditoria: null, // o modelo da Auditoria também volta ao padrão do pi
  });

  for (const errada of [
    { modeloAuditoria: { provedor: "anthropic" } },
    { modeloAuditoria: { provedor: "Maiúscula", modelo: "m" } },
    { intervaloMin: 0 },
    { timeoutMin: 9 },
    { ociosidadeMin: 1441 },
    { intervaloMin: 1.5 },
  ]) {
    assert.throws(() => salvarConfiguracao(banco, errada), ZodError);
  }
  assert.equal(configuracao(banco).agendadorAtivo, true, "a recusada não gravou nada");
  assert.throws(() => {
    banco.exec("INSERT INTO configuracao (id) VALUES (2)");
  }, /CHECK constraint/);
  banco.close();
});

test("elegíveis: um ticket por issue, o mais antigo dela, da issue mais antiga à mais nova", () => {
  const banco = novoBanco();
  const i1 = desenhada(banco, ["Índice", "Cache"]);
  const i2 = emDesenho(banco);
  const [indice = 0, cache = 0] = i1.desenvolvimento;
  assert.ok(indice < cache);
  assert.deepEqual(ticketsElegiveis(banco), [indice, i2.desenho], "CA-3: da I-1 só o mais antigo");
  assert.deepEqual(ticketsElegiveis(banco, i2.issue), [i2.desenho], "com issue, só os dela");
  assert.deepEqual(autonomasEmAndamento(banco), []);

  const execucao = iniciar(banco, i1.issue, indice, "autonomo");
  assert.partialDeepStrictEqual(autonomasEmAndamento(banco), [{ execucao, ticket: indice, issue: i1.issue }]);
  assert.match(String(autonomasEmAndamento(banco)[0]?.iniciadaEm), /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(ticketsElegiveis(banco), [i2.desenho], "CA-2: a I-1 está ocupada; a I-2 segue");
  assert.deepEqual(ticketsElegiveis(banco, i1.issue), []);
  comIssue(banco, i1.issue, "terminarExecucao", fabriquinha, (a, ctx) =>
    terminarExecucao(a, { execucao, resultado: "falha", erro: "pi saiu" }, fabriquinha, ctx),
  );
  comIssue(banco, i1.issue, "falharTicket", fabriquinha, (a) =>
    falharTicket(a, { ticket: indice, erro: "pi saiu" }, fabriquinha),
  );
  assert.deepEqual(autonomasEmAndamento(banco), []);
  assert.deepEqual(ticketsElegiveis(banco), [i2.desenho], "o que falhou trava os seguintes da I-1 até concluir (C5)");
  banco.close();
});

test("não elegível: etapa interativa, fase que não casa, dependência aberta e issue com execução ou ticket em execução", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "loja" }, auditor); // I-1 no registro, ticket interativo
  desenhada(banco, ["Índice"], false); // I-2 em aprovacao_desenho, com o ticket proposto aberto
  // I-3: consulta viva sobre o desenho concluído; C5 recusaria a issue inteira.
  const i3 = desenhada(banco, ["Cache"]);
  const cacheI3 = i3.desenvolvimento[0] ?? 0;
  const consulta = comIssue(banco, i3.issue, "iniciarConsulta", auditor, (a, ctx) =>
    iniciarConsulta(a, { ticket: i3.desenho, sessaoPi: randomUUID() }, auditor, ctx),
  ).execucoes.at(-1)?.id;
  // I-4: o ticket terminou o pi (C6) e está na coleta, ainda `em_execucao`; outro da issue violaria a invariante 1.
  const i4 = desenhada(banco, ["Log", "Métrica"]);
  const [log = 0] = i4.desenvolvimento;
  terminar(banco, i4.issue, iniciar(banco, i4.issue, log, "autonomo"));
  // I-5 depende da I-1, que não concluiu.
  emDesenho(banco, [1]);
  assert.deepEqual(ticketsElegiveis(banco), [], "CA-2, CA-7: nenhuma issue serve");

  assert.deepEqual(ticketsAutonomosEmExecucao(banco), [{ id: log, issue: i4.issue }]);
  assert.deepEqual(execucoesEmAndamento(banco), [{ id: consulta, issue: i3.issue, pgid: null }]);
  banco.exec(`UPDATE execucao SET pgid_pi = 4242 WHERE id = ${String(consulta)}`);
  assert.equal(execucoesEmAndamento(banco)[0]?.pgid, 4242);
  comIssue(banco, i3.issue, "terminarExecucao", fabriquinha, (a, ctx) =>
    terminarExecucao(a, { execucao: consulta, resultado: "sucesso" }, fabriquinha, ctx),
  );
  assert.deepEqual(ticketsElegiveis(banco), [cacheI3], "a consulta terminou: a I-3 volta a ser elegível");
  banco.close();
});

test("CA-6, CA-7, CA-8: limite de paralelismo tem padrão, altera e recusa inválido", () => {
  const banco = novoBanco();
  assert.equal(limiteParalelismo(banco), 4);
  alterarLimiteParalelismo(banco, 3);
  alterarLimiteParalelismo(banco, 5);
  assert.equal(limiteParalelismo(banco), 5);
  alterarLimiteParalelismo(banco, 3);
  for (const ruim of [0, -1, 1.5, "dois"]) {
    assert.throws(() => {
      alterarLimiteParalelismo(banco, ruim as number);
    }, ErroDeRegra);
  }
  assert.equal(limiteParalelismo(banco), 3);
  assert.equal(configuracao(banco).intervaloMin, 5, "só a coluna do limite muda");
  banco.close();
});
