// O lado do processo na Gestão de Demandas em banco temporário real: evidência, arquivamento e reabertura (CA-8 a CA-29).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { AUDITOR } from "../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { caminhoArquivo } from "../../../../shared/armazenamento/arquivos.ts";
import { carregarDemanda } from "../armazenamento/agregado_da_demanda.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import * as gestao from "./gestao_do_processo.ts";
import { registrarPedidoComProcesso } from "../../../../server/fluxos/registro_do_pedido.ts";
import { enviarAoDesenvolvimento } from "../../../../server/fluxos/envio_ao_desenvolvimento.ts";
import { montarDemandasDoBanco } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { cicloDeVidaNoContexto } from "../../../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_de_teste.ts";

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

const registrar = (b: DatabaseSync) =>
  registrarPedidoComProcesso(
    cicloDeVidaNoContexto(b, ctx),
    montarDemandasDoBanco(b),
    { projeto: "fabriquinha", titulo: "Titulo", tipo: "funcionalidade", descricao: "Desc" },
    autor,
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
) =>
  gestao.submeterEvidenciaDaEntradaExterna(b, id, { tipo, dados, arquivos } as gestao.EntradaEvidencia, quem, origens);

const completar = (b: DatabaseSync, id: string) => {
  submeter(b, id, "criterios_aceite", criterios);
  submeter(b, id, "desenho_solucao", desenho, html());
};

const evidencias = (b: DatabaseSync, id: string, tipo: string) =>
  carregarDemanda(b, id).evidencias.filter((e) => e.tipo === tipo);

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
    () => gestao.submeterEvidenciaDaEntradaExterna(b, id, entrada as gestao.EntradaEvidencia, autor, origens),
    /tem dono errado/,
  );
});

test("CA-15: depois do envio criterios_aceite está congelado", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  enviarAoDesenvolvimento(cicloDeVidaNoContexto(b, ctx), montarDemandasDoBanco(b), id, autor);
  assert.throws(
    () => submeter(b, id, "criterios_aceite", { criterios: [{ id: "CA-9", dado: "d", quando: "q", entao: "e" }] }),
    /congelada/,
  );
  assert.deepEqual(evidencias(b, id, "criterios_aceite")[0]?.dados, criterios);
});

test("CA-27: arquivar demanda concluída muda só o estado", () => {
  const b = novoBanco();
  const id = registrar(b);
  b.prepare("UPDATE processo_demanda SET estado = 'concluida' WHERE demanda_id = ?").run(id);
  const antes = carregarDemanda(b, id);
  const ag = gestao.arquivar(b, id, AUDITOR, ctx);
  assert.equal(ag.demanda.estado, "arquivada");
  assert.deepEqual(
    { ...ag.demanda, estado: 0, estado_alterado_em: 0 },
    { ...antes.demanda, estado: 0, estado_alterado_em: 0 },
  );
});

test("arquivarConcluidas: arquiva só as concluídas do projeto, no instante do relógio", () => {
  const b = novoBanco();
  const concluida = registrar(b);
  const andamento = registrar(b);
  b.prepare("UPDATE processo_demanda SET estado = 'concluida' WHERE demanda_id = ?").run(concluida);
  const relogio = relogioFixo("2026-03-01T00:00:00.000Z");
  const demandasDoProjeto = [andamento, concluida];
  assert.equal(gestao.arquivarConcluidas(b, demandasDoProjeto, relogio).length, 1);
  const arquivada = carregarDemanda(b, concluida).demanda;
  assert.equal(arquivada.estado, "arquivada");
  assert.equal(arquivada.estado_alterado_em, "2026-03-01T00:00:00.000Z");
  assert.notEqual(carregarDemanda(b, andamento).demanda.estado, "arquivada");
  assert.equal(gestao.arquivarConcluidas(b, demandasDoProjeto, relogio).length, 0);
});

test("CA-28: arquivar fora de concluida é reprovado", () => {
  const b = novoBanco();
  const id = registrar(b);
  completar(b, id);
  enviarAoDesenvolvimento(cicloDeVidaNoContexto(b, ctx), montarDemandasDoBanco(b), id, autor);
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

test("CA-29: o módulo exporta o lado do processo no registro e no envio, a evidência e o arquivamento", () => {
  const nomes = [
    "criarProcessoDoPedido",
    "levarAoGateDaDemanda",
    "submeterEvidenciaDaEntradaExterna",
    "arquivar",
    "arquivarConcluidas",
  ];
  for (const nome of nomes) {
    assert.equal(typeof (gestao as Record<string, unknown>)[nome], "function", nome);
  }
});
