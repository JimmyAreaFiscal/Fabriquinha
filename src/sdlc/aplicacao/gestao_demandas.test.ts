// Gestão de Demandas em banco temporário real (CA-1 a CA-29).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import { AUDITOR, type Ator } from "../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeEscopo, ErroDeInexistente, ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { caminhoArquivo } from "../../compartilhado/armazenamento/arquivos.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import {
  carregarTrabalhosDoTicket,
  comTrabalhosDoTicket,
} from "../../trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { relogioFixo } from "../../compartilhado/nucleo/relogio.ts";
import { decidirGate } from "../../etapas/gates.ts";
import * as gestao from "./gestao_demandas.ts";
import { registrarDependenciaDemanda } from "./gestao_demandas.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const ctx = { agora: "2026-01-01T00:00:00.000Z" };
const autor = { tipo: "externo" as const, ferramenta: "claude", sessao: "S1" };
const outra = { tipo: "externo" as const, ferramenta: "claude", sessao: "S2" };

const novoBanco = () => {
  const b = abrirBancoTemporario().banco;
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
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
const raizDosAnexos = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-gestao-demandas-")));
after(() => {
  rmSync(raizDosAnexos, { recursive: true, force: true });
});
const origens = { worktree: raizDosAnexos, saida: raizDosAnexos, fora: "da pasta do teste", copie: "a pasta do teste" };
const HTML = "<!doctype html><p>x</p>";
/** Cada anexo vai para uma pasta própria, para dois anexos poderem ter o mesmo nome. */
const anexo = (nome: string, conteudo: string | Buffer): string => {
  const pasta = mkdtempSync(join(raizDosAnexos, "a-"));
  writeFileSync(join(pasta, nome), conteudo);
  return join(pasta, nome);
};
const html = () => [anexo("d.html", HTML)];
const submeter = (
  b: DatabaseSync,
  id: string,
  tipo: string,
  dados: unknown,
  arquivos?: gestao.EntradaEvidencia["arquivos"],
  quem = autor,
) => gestao.submeterEvidencia(b, id, { tipo, dados, arquivos } as gestao.EntradaEvidencia, quem, origens);

const completar = (b: DatabaseSync, id: string) => {
  submeter(b, id, "criterios_aceite", criterios);
  submeter(b, id, "desenho_solucao", desenho, html());
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
  assert.equal(ag.demanda.estado, "entender_e_desenhar");
  assert.deepEqual(ag.demanda.criada_por, autor);
  assert.deepEqual(ag.tickets[0]?.criado_por, { tipo: "fabriquinha" });
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

test("registrar recusa ator não externo sem gravar a demanda nem consumir o ID", () => {
  const banco = novoBanco();
  assert.throws(
    () =>
      gestao.registrar(
        banco,
        { projeto: "fabriquinha", titulo: "T", tipo: "funcionalidade", descricao: "D" },
        AUDITOR,
        ctx,
      ),
    ErroDeRegra,
  );
  assert.equal(banco.prepare("SELECT count(*) AS quantidade FROM demanda").get()?.quantidade, 0);
  assert.equal(registrar(banco), "I-1");
});

test("CA-2: dependência em demanda inexistente recusa e não grava a demanda nem o ID", () => {
  const b = novoBanco();
  assert.throws(() => registrar(b, ["I-999"]), /I-999 não existe/);
  assert.equal(b.prepare("SELECT count(*) AS n FROM demanda").get()?.n, 0);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 0);
  assert.equal(registrar(b), "I-1");
});

test("CA-3: dependência que fecha ciclo é reprovada e nenhuma aresta nova é gravada", () => {
  const b = novoBanco();
  const idB = registrar(b);
  const idA = registrar(b, [idB]);
  assert.throws(() => {
    registrarDependenciaDemanda(b, idB, idA);
  }, /ciclo de dependência/);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 1);
  const idC = registrar(b);
  registrarDependenciaDemanda(b, idC, idB);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 2);
});

test("CA-2 a CA-5: dependência recusada (enviada, autorreferência, repetida) não grava nada e fecha a transação", () => {
  const b = novoBanco();
  const idA = registrar(b);
  const idB = registrar(b, [idA]);
  b.exec(`UPDATE demanda SET enviada = 1 WHERE id = '${idA}'`);
  assert.throws(() => {
    registrarDependenciaDemanda(b, idA, idB);
  }, /já foi enviada/);
  assert.throws(() => {
    registrarDependenciaDemanda(b, idB, idB);
  }, /não pode depender de si mesma/);
  assert.throws(() => {
    registrarDependenciaDemanda(b, idB, idA);
  }, /já depende/);
  assert.equal(b.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n, 1);
  assert.equal(b.isTransaction, false);
});

test("dependência com demanda inexistente, dona ou predecessora, dá ErroDeInexistente", () => {
  const b = novoBanco();
  const id = registrar(b);
  assert.throws(() => {
    registrarDependenciaDemanda(b, "I-999", id);
  }, ErroDeInexistente);
  assert.throws(() => {
    registrarDependenciaDemanda(b, id, "I-999");
  }, ErroDeInexistente);
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
  assert.equal(carregarDemanda(b, id).demanda.estado, "entender_e_desenhar");
});

test("CA-8: outra sessão não submete evidência", () => {
  const b = novoBanco();
  const id = registrar(b);
  assert.throws(() => submeter(b, id, "criterios_aceite", criterios, undefined, outra), ErroDeRegra);
  assert.deepEqual(evidencias(b, id, "criterios_aceite"), []);
});

test("CA-9: dados fora do schema recusam apontando o campo; tipo inválido também", () => {
  const b = novoBanco();
  const id = registrar(b);
  assert.throws(
    () => submeter(b, id, "criterios_aceite", { criterios: [{ id: "x" }] }),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes("dados.criterios[0].id"),
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
  submeter(b, id, "desenho_solucao", desenho, html());
  const linha = b.prepare("SELECT caminho, sha256, mime, bytes FROM arquivo_evidencia").get() as {
    caminho: string;
    sha256: string;
    bytes: number;
  };
  assert.equal(linha.caminho, "d.html");
  assert.equal(linha.bytes, HTML.length);
  assert.equal(readFileSync(caminhoArquivo(b, linha.sha256)).toString(), HTML);
});

test("anexos: quantidade, repetido, classe, tamanho e temClasse seguem o schema do tipo", () => {
  const b = novoBanco();
  const id = registrar(b);
  const texto = (nome: string, conteudo: string | Buffer = "t") => anexo(nome, conteudo);
  const cada: [string, string, string[], RegExp][] = [
    ["desenho_solucao", "desenho", [], /pelo menos 1/],
    ["desenho_solucao", "desenho", [...html(), ...html()], /no máximo 1/],
    ["criterios_aceite", "criterios", html(), /no máximo 0/],
    ["desenho_solucao", "desenho", [texto("a.txt")], /é texto, e desenho_solucao aceita só html/],
    ["desenho_solucao", "desenho", [texto("a.html", Buffer.alloc(5 * 1024 * 1024 + 1, "a"))], /aceitam até/],
    ["prototipo", "proto", [texto("a.txt")], /vídeo ou print/],
    ["prototipo", "proto", [texto("a.txt"), texto("a.txt")], /dois anexos se chamam a.txt/],
  ];
  const dados: Record<string, unknown> = { desenho, criterios, proto: { descricao: "d" } };
  for (const [tipo, d, arquivos, erro] of cada) assert.throws(() => submeter(b, id, tipo, dados[d], arquivos), erro);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  submeter(b, id, "prototipo", dados.proto, [anexo("p.png", png)]);
  assert.equal(evidencias(b, id, "prototipo").length, 1);
  assert.equal(b.prepare("SELECT count(*) AS n FROM arquivo_evidencia").get()?.n, 1);
});

test("CA-SDLC-24: evidência com rodada_id é recusada: a definição da demanda não tem dono de rodada", () => {
  const b = novoBanco();
  const id = registrar(b);
  b.exec(
    `INSERT INTO rodada VALUES ('${id}', 1, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'fabriquinha/${id}-1')`,
  );
  const entrada = { tipo: "criterios_aceite", dados: criterios, rodada_id: 1, arquivos: [] };
  assert.throws(
    () => gestao.submeterEvidencia(b, id, entrada as gestao.EntradaEvidencia, autor, origens),
    /tem dono errado/,
  );
});

test("CA-13: envio sem as obrigatórias lista as faltantes", () => {
  const b = novoBanco();
  const id = registrar(b);
  submeter(b, id, "criterios_aceite", criterios);
  assert.throws(
    () => gestao.enviar(b, id, autor, ctx),
    (e: Error) => e.message.includes("desenho_solucao"),
  );
  assert.equal(carregarDemanda(b, id).demanda.enviada, false);
});

test("CA-14: com as obrigatórias, enviar vai a gate_demanda", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  const ag = gestao.enviar(b, id, autor, ctx);
  assert.equal(ag.demanda.estado, "gate_demanda");
  assert.equal(carregarDemanda(b, id).demanda.enviada, true);
});

test("CA-15: depois do envio criterios_aceite está congelado", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  assert.throws(
    () => submeter(b, id, "criterios_aceite", { criterios: [{ id: "CA-9", dado: "d", quando: "q", entao: "e" }] }),
    /congelada/,
  );
  assert.deepEqual(evidencias(b, id, "criterios_aceite")[0]?.dados, criterios);
});

test("CA-27: arquivar demanda concluída muda só o estado", () => {
  const b = novoBanco();
  const id = registrar(b);
  b.prepare("UPDATE demanda SET estado = 'concluida' WHERE id = ?").run(id);
  const antes = carregarDemanda(b, id);
  const ag = gestao.arquivar(b, id, AUDITOR, ctx);
  assert.equal(ag.demanda.estado, "arquivada");
  assert.deepEqual(
    { ...ag.demanda, estado: 0, estado_alterado_em: 0 },
    { ...antes.demanda, estado: 0, estado_alterado_em: 0 },
  );
});

test("arquivarConcluidas: arquiva só as concluídas do projeto, no instante do relógio, e recusa o projeto inexistente", () => {
  const b = novoBanco();
  const concluida = registrar(b);
  const andamento = registrar(b);
  b.prepare("UPDATE demanda SET estado = 'concluida' WHERE id = ?").run(concluida);
  const relogio = relogioFixo("2026-03-01T00:00:00.000Z");
  const projeto = "fabriquinha";
  assert.deepEqual(gestao.arquivarConcluidas(b, projeto, relogio, "oriente"), { arquivadas: 1 });
  const arquivada = carregarDemanda(b, concluida).demanda;
  assert.equal(arquivada.estado, "arquivada");
  assert.equal(arquivada.estado_alterado_em, "2026-03-01T00:00:00.000Z");
  assert.notEqual(estado(b, andamento), "arquivada");
  assert.deepEqual(gestao.arquivarConcluidas(b, projeto, relogio, "oriente"), { arquivadas: 0 });
  assert.throws(
    () => gestao.arquivarConcluidas(b, "nao-existe", relogio, "oriente"),
    /o projeto nao-existe não existe/,
  );
});

test("CA-28: arquivar fora de concluida é reprovado", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  assert.throws(() => gestao.arquivar(b, id, AUDITOR, ctx), /só no estado concluida/);
  assert.equal(carregarDemanda(b, id).demanda.estado, "gate_demanda");
});

test("reabrir: só o Auditor reabre o ticket falho, com a instrução e o instante do relógio", () => {
  const b = novoBanco();
  const id = registrar(b);
  b.prepare("UPDATE ticket_demanda SET estado = 'falhou' WHERE demanda_id = ?").run(id);
  const relogio = relogioFixo("2026-02-01T00:00:00.000Z");
  assert.throws(
    () => gestao.reabrir(b, id, { ticket_id: 1, instrucao: "tente de novo" }, autor, relogio),
    /só o Auditor pode reabrir/,
  );
  assert.equal(carregarDemanda(b, id).tickets[0]?.estado, "falhou");
  const ticket = gestao.reabrir(b, id, { ticket_id: 1, instrucao: "tente de novo" }, AUDITOR, relogio);
  assert.deepEqual(
    [ticket.estado, ticket.instrucao, ticket.estado_alterado_em],
    ["aberto", "tente de novo", "2026-02-01T00:00:00.000Z"],
  );
  assert.throws(() => gestao.reabrir(b, id, { ticket_id: 1, instrucao: "de novo" }, AUDITOR, relogio), /falhou/);
});

test("CA-29: o módulo exporta as operações de registro, edição, evidência, envio, cancelamento e arquivamento", () => {
  const nomes = ["registrar", "editar", "submeterEvidencia", "enviar", "cancelar", "arquivar", "arquivarConcluidas"];
  for (const nome of nomes) {
    assert.equal(typeof (gestao as Record<string, unknown>)[nome], "function", nome);
  }
});

const estado = (b: DatabaseSync, id: string) => carregarDemanda(b, id).demanda.estado;
const poEstado = (b: DatabaseSync, id: string, f: string) =>
  b.prepare("UPDATE demanda SET estado = ? WHERE id = ?").run(f, id);
const aguardando = (b: DatabaseSync, dependencias?: string[]) => {
  const id = registrar(b, dependencias);
  completar(b, id);
  gestao.enviar(b, id, autor, ctx);
  return id;
};
const aprovar = { resultado: "aprovado" };
const reprovar = { resultado: "reprovado", motivo: "fora do escopo" };
const decidirGateDaDemandaComoAuditor = (b: DatabaseSync, id: string, entrada: unknown, ator: Ator = AUDITOR) =>
  decidirGate(b, "gate_demanda", Endereco.daDemanda(id), entrada, ator);

test("CA-16: aprovar leva a planejamento, grava a decisão e não cascateia", async () => {
  const b = novoBanco();
  const a = aguardando(b);
  const dep = registrar(b, [a]);
  const { demanda, canceladas } = await decidirGateDaDemandaComoAuditor(b, a, aprovar);
  assert.equal(demanda.demanda.estado, "planejar");
  assert.deepEqual(canceladas, []);
  assert.equal(demanda.decisoes[0]?.resultado, "aprovado");
  assert.equal(estado(b, dep), "entender_e_desenhar");
});

test("CA-17: reprovar com motivo cancela a demanda e as dependentes elegíveis", async () => {
  const b = novoBanco();
  const a = aguardando(b);
  const dep = registrar(b, [a]);
  const feita = registrar(b, [a]);
  poEstado(b, feita, "concluida");
  const { demanda, canceladas } = await decidirGateDaDemandaComoAuditor(b, a, reprovar);
  assert.equal(demanda.demanda.estado, "cancelada");
  assert.deepEqual(canceladas, [a, dep]);
  assert.equal(estado(b, dep), "cancelada");
  assert.equal(estado(b, feita), "concluida");
});

test("CA-17: reprovar a demanda interrompe a execução aberta da dependente cancelada", async () => {
  const b = novoBanco();
  const a = aguardando(b);
  const dep = registrar(b, [a]);
  const ref = { demanda_id: dep, ticket_id: 1 };
  comTrabalhosDoTicket(b, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e1", trabalho_id: "s1", inicio: ctx.agora, falha: false }],
  }));
  await decidirGateDaDemandaComoAuditor(b, a, reprovar);
  assert.ok(carregarTrabalhosDoTicket(b, ref).execucoes[0]?.fim);
});

test("CA-18: reprovar sem motivo pede o motivo; outros erros de entrada seguem o padrão", async () => {
  const b = novoBanco();
  const a = aguardando(b);
  await assert.rejects(
    decidirGateDaDemandaComoAuditor(b, a, { resultado: "reprovado" }),
    /informe o motivo da reprovação/,
  );
  await assert.rejects(decidirGateDaDemandaComoAuditor(b, a, { resultado: "x" }), ErroDeRegra);
  assert.equal(estado(b, a), "gate_demanda");
});

test("CA-19: o autor não decide", async () => {
  const b = novoBanco();
  const a = aguardando(b);
  await assert.rejects(decidirGateDaDemandaComoAuditor(b, a, aprovar, { tipo: "agente", trabalho_id: "1" }), /Auditor/);
  assert.equal(estado(b, a), "gate_demanda");
});

test("CA-20: demanda em registro não espera decisão", async () => {
  const b = novoBanco();
  const a = registrar(b);
  await assert.rejects(decidirGateDaDemandaComoAuditor(b, a, aprovar), /não espera decisão/);
  assert.equal(estado(b, a), "entender_e_desenhar");
});

test("CA-21: cancelar leva dependentes diretas e indiretas de outros projetos e poupa as terminadas", () => {
  const b = novoBanco();
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
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
  poEstado(b, d, "concluida");
  poEstado(b, e, "arquivada");
  poEstado(b, a, "em_execucao");
  const { canceladas } = gestao.cancelar(b, a, AUDITOR, ctx);
  assert.deepEqual([...canceladas].sort(), [a, bb, c].sort());
  assert.deepEqual(
    [a, bb, c, d, e].map((i) => estado(b, i)),
    ["cancelada", "cancelada", "cancelada", "concluida", "arquivada"],
  );
});

test("CA-22: a execução órfã de uma dependente é interrompida e fica com o fim gravado", () => {
  const b = novoBanco();
  const a = registrar(b);
  const dep = registrar(b, [a]);
  const ref = { demanda_id: dep, ticket_id: 1 };
  comTrabalhosDoTicket(b, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e1", trabalho_id: "s1", inicio: ctx.agora, falha: false }],
  }));
  const alheia = registrar(b);
  const refAlheia = { demanda_id: alheia, ticket_id: 1 };
  comTrabalhosDoTicket(b, refAlheia, (x) => ({
    ...x,
    sessoes: [{ id: "s2", ...refAlheia, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e2", trabalho_id: "s2", inicio: ctx.agora, falha: false }],
  }));
  gestao.cancelar(b, a, AUDITOR, ctx);
  assert.equal(carregarTrabalhosDoTicket(b, refAlheia).execucoes[0]?.fim, null);
  const [exec] = carregarTrabalhosDoTicket(b, ref).execucoes;
  assert.ok(exec?.fim);
});

test("CA-23: o autor não cancela", () => {
  const b = novoBanco();
  const a = registrar(b);
  assert.throws(() => gestao.cancelar(b, a, { tipo: "agente", trabalho_id: "1" }, ctx), /Auditor/);
  assert.equal(estado(b, a), "entender_e_desenhar");
});

test("CA-24: demanda terminada não se cancela (a integração confirmada é regra do domínio)", () => {
  const b = novoBanco();
  const a = registrar(b);
  poEstado(b, a, "concluida");
  assert.throws(() => gestao.cancelar(b, a, AUDITOR, ctx), /já terminou/);
  assert.equal(estado(b, a), "concluida");
});

test("CA-25: cancelar mantém decisões, evidências e execuções", async () => {
  const b = novoBanco();
  const a = aguardando(b);
  const ref = { demanda_id: a, ticket_id: 1 };
  comTrabalhosDoTicket(b, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e1", trabalho_id: "s1", inicio: ctx.agora, falha: false, fim: ctx.agora }],
  }));
  await decidirGateDaDemandaComoAuditor(b, a, aprovar);
  const antes = { ag: carregarDemanda(b, a), ex: carregarTrabalhosDoTicket(b, ref).execucoes };
  const { demanda } = gestao.cancelar(b, a, AUDITOR, ctx);
  assert.deepEqual(demanda.decisoes, antes.ag.decisoes);
  assert.deepEqual(demanda.evidencias, antes.ag.evidencias);
  assert.deepEqual(carregarTrabalhosDoTicket(b, ref).execucoes, antes.ex);
});

test("CA-26: falha na gravação de uma dependente desfaz a demanda e todas as dependentes", () => {
  const b = novoBanco();
  const a = registrar(b);
  const bb = registrar(b, [a]);
  const c = registrar(b, [a]);
  b.exec(`CREATE TRIGGER falha BEFORE UPDATE OF estado ON demanda WHEN NEW.id = '${c}' AND NEW.estado = 'cancelada'
    BEGIN SELECT RAISE(ABORT, 'falhou'); END`);
  assert.throws(() => gestao.cancelar(b, a, AUDITOR, ctx), /falhou/);
  assert.deepEqual(
    [a, bb, c].map((i) => estado(b, i)),
    ["entender_e_desenhar", "entender_e_desenhar", "entender_e_desenhar"],
  );
});
