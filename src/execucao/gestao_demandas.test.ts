// Gestão de Demandas em banco temporário real (CA-1 a CA-29).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { AUDITOR } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { abrir } from "../persistencia/banco.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../persistencia/sessoes.ts";
import * as gestao from "./gestao_demandas.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-gestao-demandas-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const ctx = { agora: "2026-01-01T00:00:00.000Z" };
const autor = { ferramenta: "claude", sessao: "S1" };
const outra = { ferramenta: "claude", sessao: "S2" };

const novoBanco = () => {
  const b = abrir(mkdtempSync(join(base, "raiz-")));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('fabriquinha', '/repo/f', 'main', 'github', 'k')`);
  return b;
};

const registrar = (b: DatabaseSync, dependencias?: string[], quem = autor) =>
  gestao.registrar(
    b,
    { projeto: "fabriquinha", titulo: "Titulo", tipo: "funcionalidade", descricao: "Desc", dependencias },
    quem,
    ctx,
  ).demanda.id;

const criterios = {
  criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }],
};
const desenho = {
  resumo: "r",
  arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }],
};
const anexoHtml = { nome: "d.html", mime: "text/html; charset=utf-8", conteudo: Buffer.from("<p>x</p>") };
const html = [anexoHtml];
const custos = (sessao = "ext1") => ({
  sessoes: [
    {
      ferramenta: "claude",
      sessao,
      linhas: [
        {
          provedor: "a",
          modelo: "m",
          tokens_entrada: 1,
          tokens_saida: 1,
          tokens_cache_leitura: 0,
          tokens_cache_escrita: 0,
        },
      ],
    },
  ],
});

const submeter = (
  b: DatabaseSync,
  id: string,
  tipo: string,
  dados: unknown,
  arquivos?: gestao.EntradaEvidencia["arquivos"],
  quem = autor,
) => gestao.submeterEvidencia(b, id, { tipo, dados, arquivos } as gestao.EntradaEvidencia, quem, ctx);

const completar = (b: DatabaseSync, id: string) => {
  submeter(b, id, "criterios_aceite", criterios);
  submeter(b, id, "desenho_solucao", desenho, html);
  submeter(b, id, "custos_realizados", custos());
};

const evidencias = (b: DatabaseSync, id: string, tipo: string) =>
  carregarDemanda(b, id).evidencias.filter((e) => e.tipo === tipo);

test("CA-1: registra a demanda I-n em registro, com a origem do autor e sem evidência", () => {
  const b = novoBanco();
  const ag = gestao.registrar(
    b,
    { projeto: "fabriquinha", titulo: "T", tipo: "funcionalidade", descricao: "D" },
    autor,
    ctx,
  );
  assert.match(ag.demanda.id, /^I-\d+$/);
  assert.equal(ag.demanda.fase, "registro");
  assert.equal(ag.demanda.origem_ferramenta, "claude");
  assert.equal(ag.demanda.origem_sessao, "S1");
  assert.deepEqual(ag.evidencias, []);
  assert.equal(carregarDemanda(b, ag.demanda.id).demanda.titulo, "T");
});

test("registrar recusa projeto inexistente e campo inválido com campo e correção", () => {
  const b = novoBanco();
  assert.throws(
    () => gestao.registrar(b, { projeto: "x", titulo: "T", tipo: "funcionalidade", descricao: "D" }, autor, ctx),
    ErroDeInexistente,
  );
  assert.throws(
    () =>
      gestao.registrar(b, { projeto: "fabriquinha", titulo: "", tipo: "funcionalidade", descricao: "D" }, autor, ctx),
    (e: Error) => e instanceof ErroDeRegra && e.message.startsWith("titulo:") && e.message.includes("corrija"),
  );
});

test("CA-2: dependência em demanda inexistente recusa e não grava a demanda nem o ID", () => {
  const b = novoBanco();
  assert.throws(() => registrar(b, ["I-999"]), /I-999 não existe/);
  assert.equal(b.prepare("SELECT count(*) AS n FROM demanda").get()?.n, 0);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 0);
  assert.equal(registrar(b), "I-1");
});

test("CA-3: dependência que fecha ciclo é recusada e nenhuma aresta nova é gravada", () => {
  const b = novoBanco();
  const idB = registrar(b);
  const idA = registrar(b, [idB]);
  assert.throws(() => {
    gestao.registrarDependencia(b, idB, idA, autor);
  }, /ciclo de dependência/);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 1);
  assert.throws(() => {
    gestao.registrarDependencia(b, idB, idA, outra);
  }, ErroDeEscopo);
  const idC = registrar(b);
  gestao.registrarDependencia(b, idC, idB, autor);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 2);
});

test("CA-4: editar só o título mantém tipo e descrição", () => {
  const b = novoBanco();
  const id = registrar(b);
  const ag = gestao.editar(b, id, { titulo: "Novo" }, autor);
  assert.equal(ag.demanda.titulo, "Novo");
  assert.equal(carregarDemanda(b, id).demanda.tipo, "funcionalidade");
  assert.equal(carregarDemanda(b, id).demanda.descricao, "Desc");
  assert.throws(() => gestao.editar(b, id, {}, autor), /informe ao menos um campo/);
});

test("CA-5: demanda enviada tem o conteúdo congelado", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  assert.throws(() => gestao.editar(b, id, { descricao: "Outra" }, autor), /congelado/);
  assert.equal(carregarDemanda(b, id).demanda.descricao, "Desc");
});

test("CA-6: outra sessão não edita e o erro nomeia a sessão autora", () => {
  const b = novoBanco();
  const id = registrar(b);
  assert.throws(
    () => gestao.editar(b, id, { titulo: "X" }, outra),
    (e: Error) => e instanceof ErroDeEscopo && e.message.includes("S1"),
  );
  assert.equal(carregarDemanda(b, id).demanda.titulo, "Titulo");
});

test("CA-7: outra sessão não envia a demanda", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  assert.throws(() => gestao.enviar(b, id, outra, ctx), ErroDeEscopo);
  assert.equal(carregarDemanda(b, id).demanda.fase, "registro");
});

test("CA-8: outra sessão não submete evidência", () => {
  const b = novoBanco();
  const id = registrar(b);
  assert.throws(() => submeter(b, id, "criterios_aceite", criterios, undefined, outra), ErroDeEscopo);
  assert.deepEqual(evidencias(b, id, "criterios_aceite"), []);
});

test("CA-9: dados fora do schema recusam apontando o campo; tipo inválido também", () => {
  const b = novoBanco();
  const id = registrar(b);
  assert.throws(
    () => submeter(b, id, "criterios_aceite", { criterios: [{ id: "x" }] }),
    (e: Error) => e instanceof ErroDeRegra && e.message.startsWith("dados.criterios.0.id:"),
  );
  assert.throws(
    () => submeter(b, id, "plano", {}),
    (e: Error) => e.message.startsWith("tipo:"),
  );
  assert.deepEqual(evidencias(b, id, "criterios_aceite"), []);
});

test("CA-10: submeter de novo substitui a evidência", () => {
  const b = novoBanco();
  const id = registrar(b);
  submeter(b, id, "criterios_aceite", criterios);
  const novo = { criterios: [{ id: "CA-2", dado: "d", quando: "q", entao: "e" }] };
  submeter(b, id, "criterios_aceite", novo);
  const lista = evidencias(b, id, "criterios_aceite");
  assert.equal(lista.length, 1);
  assert.deepEqual(lista[0]?.dados, novo);
});

test("CA-11: o anexo fica no armazenamento pelo SHA-256 e a evidência o guarda", () => {
  const b = novoBanco();
  const id = registrar(b);
  submeter(b, id, "desenho_solucao", desenho, html);
  const linha = b.prepare("SELECT caminho, sha256, mime, bytes FROM arquivo_evidencia").get() as {
    caminho: string;
    sha256: string;
    bytes: number;
  };
  assert.equal(linha.caminho, "d.html");
  assert.equal(linha.bytes, 8);
  assert.equal(readFileSync(caminhoArquivo(b, linha.sha256)).toString(), "<p>x</p>");
});

test("anexos: quantidade, repetido, classe, tamanho e temClasse seguem o schema do tipo", () => {
  const b = novoBanco();
  const id = registrar(b);
  const texto = (nome: string, conteudo = Buffer.from("t")) => ({ nome, mime: "text/plain", conteudo });
  const cada: [string, string, gestao.EntradaEvidencia["arquivos"], RegExp][] = [
    ["desenho_solucao", "desenho", [], /pelo menos 1/],
    ["desenho_solucao", "desenho", [...html, ...html], /no máximo 1/],
    ["custos_realizados", "custos", html, /no máximo 0/],
    ["desenho_solucao", "desenho", [texto("a.txt")], /não é de uma classe aceita/],
    ["desenho_solucao", "desenho", [{ ...anexoHtml, mime: "application/x" }], /não é de uma classe aceita/],
    ["desenho_solucao", "desenho", [{ ...anexoHtml, conteudo: Buffer.alloc(5 * 1024 * 1024 + 1) }], /passa de/],
    ["prototipo", "proto", [texto("a.txt")], /vídeo ou print/],
    ["prototipo", "proto", [texto("a.txt"), texto("a.txt")], /dois anexos se chamam a.txt/],
  ];
  const dados: Record<string, unknown> = { desenho, custos: custos(), proto: { descricao: "d" } };
  for (const [tipo, d, arquivos, erro] of cada) assert.throws(() => submeter(b, id, tipo, dados[d], arquivos), erro);
  submeter(b, id, "prototipo", dados.proto, [{ nome: "p.png", mime: "image/png", conteudo: Buffer.from("x") }]);
  assert.equal(evidencias(b, id, "prototipo").length, 1);
  assert.equal(b.prepare("SELECT count(*) AS n FROM arquivo_evidencia").get()?.n, 1);
});

test("CA-12: sessão já contada em outra demanda vira aviso e não é contada duas vezes", () => {
  const b = novoBanco();
  const a = registrar(b);
  const c = registrar(b);
  assert.deepEqual(submeter(b, a, "custos_realizados", custos()).avisos, []);
  const { avisos } = submeter(b, c, "custos_realizados", custos());
  assert.equal(avisos.length, 1);
  assert.match(avisos[0] ?? "", new RegExp(`já consta na demanda ${a}`));
  assert.deepEqual({ ...b.prepare("SELECT demanda_id FROM sessao_externa_demanda").get() }, { demanda_id: a });
});

test("CA-SDLC-24: custos_realizados com rodada_id vira evidência da rodada e não substitui o da demanda", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  b.exec(`INSERT INTO rodada VALUES ('${id}', 1, 'r', 'desenvolvimento', 0, 'fabriquinha/${id}-1')`);
  const entrada = { tipo: "custos_realizados", dados: custos("ext-r1"), rodada_id: 1, arquivos: [] };
  gestao.submeterEvidencia(b, id, entrada as gestao.EntradaEvidencia, autor, ctx);
  assert.deepEqual(
    evidencias(b, id, "custos_realizados").map((e) => e.rodada_id),
    [undefined, 1],
  );
  assert.deepEqual(
    b
      .prepare("SELECT sessao FROM sessao_externa_demanda ORDER BY sessao")
      .all()
      .map((l) => l.sessao),
    ["ext-r1", "ext1"],
  );
});

test("CA-13: envio sem as obrigatórias lista as faltantes", () => {
  const b = novoBanco();
  const id = registrar(b);
  submeter(b, id, "criterios_aceite", criterios);
  assert.throws(
    () => gestao.enviar(b, id, autor, ctx),
    (e: Error) => e.message.includes("desenho_solucao, custos_realizados"),
  );
  assert.equal(carregarDemanda(b, id).demanda.enviada, false);
});

test("CA-14: com as três obrigatórias, enviar vai a aprovacao_demanda", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  const ag = gestao.enviar(b, id, autor, ctx);
  assert.equal(ag.demanda.fase, "aprovacao_demanda");
  assert.equal(carregarDemanda(b, id).demanda.enviada, true);
});

test("CA-15: depois do envio criterios_aceite está congelado e custos_realizados segue livre", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  assert.throws(
    () => submeter(b, id, "criterios_aceite", { criterios: [{ id: "CA-9", dado: "d", quando: "q", entao: "e" }] }),
    /congelada/,
  );
  assert.deepEqual(evidencias(b, id, "criterios_aceite")[0]?.dados, criterios);
  submeter(b, id, "custos_realizados", custos("ext2"));
  const [custo] = evidencias(b, id, "custos_realizados");
  assert.equal((custo?.dados as ReturnType<typeof custos>).sessoes[0]?.sessao, "ext2");
});

test("CA-27: arquivar demanda concluída muda só a fase", () => {
  const b = novoBanco();
  const id = registrar(b);
  b.prepare("UPDATE demanda SET fase = 'concluida' WHERE id = ?").run(id);
  const antes = carregarDemanda(b, id);
  const ag = gestao.arquivar(b, id, AUDITOR, ctx);
  assert.equal(ag.demanda.fase, "arquivada");
  assert.deepEqual({ ...ag.demanda, fase: 0, fase_alterada_em: 0 }, { ...antes.demanda, fase: 0, fase_alterada_em: 0 });
});

test("CA-28: arquivar fora de concluida é recusado", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  assert.throws(() => gestao.arquivar(b, id, AUDITOR, ctx), /só demanda concluída/);
  assert.equal(carregarDemanda(b, id).demanda.fase, "aprovacao_demanda");
});

test("CA-29: o módulo exporta as operações de registro, edição, dependência, evidência, envio, decisão, cancelamento e arquivamento", () => {
  const nomes = [
    "registrar",
    "editar",
    "registrarDependencia",
    "submeterEvidencia",
    "enviar",
    "decidir",
    "cancelar",
    "arquivar",
  ];
  for (const nome of nomes) {
    assert.equal(typeof (gestao as Record<string, unknown>)[nome], "function", nome);
  }
});

const fase = (b: DatabaseSync, id: string) => carregarDemanda(b, id).demanda.fase;
const poFase = (b: DatabaseSync, id: string, f: string) =>
  b.prepare("UPDATE demanda SET fase = ? WHERE id = ?").run(f, id);
const aguardando = (b: DatabaseSync, dependencias?: string[]) => {
  const id = registrar(b, dependencias);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  return id;
};
const aprovar = { aprovado: true };
const recusar = { aprovado: false, motivo: "fora do escopo" };

test("CA-16: aprovar leva a planejamento, grava a decisão e não cascateia", () => {
  const b = novoBanco();
  const a = aguardando(b);
  const dep = registrar(b, [a]);
  const { demanda, canceladas } = gestao.decidir(b, a, aprovar, AUDITOR, ctx);
  assert.equal(demanda.demanda.fase, "planejamento");
  assert.deepEqual(canceladas, []);
  assert.equal(demanda.decisoes[0]?.resultado, "aprovado");
  assert.equal(fase(b, dep), "registro");
});

test("CA-17: recusar com motivo cancela a demanda e as dependentes elegíveis", () => {
  const b = novoBanco();
  const a = aguardando(b);
  const dep = registrar(b, [a]);
  const feita = registrar(b, [a]);
  poFase(b, feita, "concluida");
  const { demanda, canceladas } = gestao.decidir(b, a, recusar, AUDITOR, ctx);
  assert.equal(demanda.demanda.fase, "cancelada");
  assert.deepEqual(canceladas, [a, dep]);
  assert.equal(fase(b, dep), "cancelada");
  assert.equal(fase(b, feita), "concluida");
});

test("CA-18: recusar sem motivo pede o motivo; outros erros de entrada seguem o padrão", () => {
  const b = novoBanco();
  const a = aguardando(b);
  assert.throws(() => gestao.decidir(b, a, { aprovado: false }, AUDITOR, ctx), /informe o motivo da recusa/);
  assert.throws(() => gestao.decidir(b, a, { aprovado: "x" }, AUDITOR, ctx), ErroDeRegra);
  assert.equal(fase(b, a), "aprovacao_demanda");
});

test("CA-19: o autor não decide", () => {
  const b = novoBanco();
  const a = aguardando(b);
  assert.throws(() => gestao.decidir(b, a, aprovar, { tipo: "agente", execucao: 1, ticket: 1 }, ctx), /Auditor/);
  assert.equal(fase(b, a), "aprovacao_demanda");
});

test("CA-20: demanda em registro não espera decisão", () => {
  const b = novoBanco();
  const a = registrar(b);
  assert.throws(() => gestao.decidir(b, a, aprovar, AUDITOR, ctx), /não espera decisão/);
  assert.equal(fase(b, a), "registro");
});

test("CA-21: cancelar leva dependentes diretas e indiretas de outros projetos e poupa as terminadas", () => {
  const b = novoBanco();
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('outro', '/repo/o', 'main', 'github', 'k2')`);
  const a = registrar(b);
  const bb = registrar(b, [a]);
  const c = gestao.registrar(
    b,
    { projeto: "outro", titulo: "T", tipo: "funcionalidade", descricao: "D", dependencias: [bb] },
    autor,
    ctx,
  ).demanda.id;
  const d = registrar(b, [a]);
  const e = registrar(b, [a]);
  poFase(b, d, "concluida");
  poFase(b, e, "arquivada");
  poFase(b, a, "execucao");
  const { canceladas } = gestao.cancelar(b, a, AUDITOR, ctx);
  assert.deepEqual([...canceladas].sort(), [a, bb, c].sort());
  assert.deepEqual(
    [a, bb, c, d, e].map((i) => fase(b, i)),
    ["cancelada", "cancelada", "cancelada", "concluida", "arquivada"],
  );
});

test("CA-22: a execução órfã de uma dependente é interrompida e fica com o fim gravado", () => {
  const b = novoBanco();
  const a = registrar(b);
  const dep = registrar(b, [a]);
  const ref = { demanda_id: dep, ticket_id: 1 };
  comSessoesDoTicket(b, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e1", sessao_id: "s1", inicio: ctx.agora, falha: false }],
  }));
  const alheia = registrar(b);
  const refAlheia = { demanda_id: alheia, ticket_id: 1 };
  comSessoesDoTicket(b, refAlheia, (x) => ({
    ...x,
    sessoes: [{ id: "s2", ...refAlheia, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e2", sessao_id: "s2", inicio: ctx.agora, falha: false }],
  }));
  gestao.cancelar(b, a, AUDITOR, ctx);
  assert.equal(carregarSessoesDoTicket(b, refAlheia).execucoes[0]?.fim, null);
  const [exec] = carregarSessoesDoTicket(b, ref).execucoes;
  assert.ok(exec?.fim);
});

test("CA-23: o autor não cancela", () => {
  const b = novoBanco();
  const a = registrar(b);
  assert.throws(() => gestao.cancelar(b, a, { tipo: "agente", execucao: 1, ticket: 1 }, ctx), /Auditor/);
  assert.equal(fase(b, a), "registro");
});

test("CA-24: demanda terminada não se cancela (a integração confirmada é regra do domínio)", () => {
  const b = novoBanco();
  const a = registrar(b);
  poFase(b, a, "concluida");
  assert.throws(() => gestao.cancelar(b, a, AUDITOR, ctx), /já terminou/);
  assert.equal(fase(b, a), "concluida");
});

test("CA-25: cancelar mantém decisões, evidências e execuções", () => {
  const b = novoBanco();
  const a = aguardando(b);
  const ref = { demanda_id: a, ticket_id: 1 };
  comSessoesDoTicket(b, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e1", sessao_id: "s1", inicio: ctx.agora, falha: false, fim: ctx.agora }],
  }));
  gestao.decidir(b, a, aprovar, AUDITOR, ctx);
  const antes = { ag: carregarDemanda(b, a), ex: carregarSessoesDoTicket(b, ref).execucoes };
  const { demanda } = gestao.cancelar(b, a, AUDITOR, ctx);
  assert.deepEqual(demanda.decisoes, antes.ag.decisoes);
  assert.deepEqual(demanda.evidencias, antes.ag.evidencias);
  assert.deepEqual(carregarSessoesDoTicket(b, ref).execucoes, antes.ex);
});

test("CA-26: falha na gravação de uma dependente desfaz a demanda e todas as dependentes", () => {
  const b = novoBanco();
  const a = registrar(b);
  const bb = registrar(b, [a]);
  const c = registrar(b, [a]);
  b.exec(`CREATE TRIGGER falha BEFORE UPDATE OF fase ON demanda WHEN NEW.id = '${c}' AND NEW.fase = 'cancelada'
    BEGIN SELECT RAISE(ABORT, 'falhou'); END`);
  assert.throws(() => gestao.cancelar(b, a, AUDITOR, ctx), /falhou/);
  assert.deepEqual(
    [a, bb, c].map((i) => fase(b, i)),
    ["registro", "registro", "registro"],
  );
});
