import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { z, ZodError } from "zod";
import type { Ator } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "../dominio/erros.ts";
import { iniciarExecucao, terminarExecucao } from "../dominio/execucao.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { submeter } from "./submissao.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-submissao-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const agente: Ator = { tipo: "agente", execucao: 1, ticket: 1 };
const MiB = 1024 * 1024;

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom")]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const HTML = "﻿ \n<!DOCTYPE html><html><body>oi</body></html>";
const COMPORTAMENTO = { descricao: "  login lento  ", comoReproduzir: ["abrir", "entrar"], extra: 1 };
const CRITERIO = { id: "CA-1", dado: "um usuário", quando: "entra", entao: "vê o painel" };

interface Cenario {
  raiz: string;
  banco: DatabaseSync;
  worktree: string;
  saida: string;
  /** Cria o arquivo `nome` em `pasta` e devolve o caminho. */
  arquivo(pasta: string, nome: string, conteudo: string | Buffer, tamanho?: number): string;
}

/** I-1 do projeto `loja` em `registro`, com o ticket T-1 rodando na E-1 (interativa), a worktree e a saída. */
function cenario(): Cenario {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo: "/repos/loja",
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "c", descricao: "d" }],
  });
  registrarIssue(banco, { projeto: "loja" }, auditor);
  comIssue(banco, 1, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(
      ag,
      { ticket: 1, modo: "interativo", sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
      fabriquinha,
      ctx,
    ),
  );
  const worktree = join(raiz, "worktrees", "loja", "I-1");
  const saida = join(raiz, "execucoes", "E-1", "saida");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(saida, { recursive: true });
  return {
    raiz,
    banco,
    worktree,
    saida,
    arquivo(pasta, nome, conteudo, tamanho) {
      const caminho = join(pasta, nome);
      writeFileSync(caminho, conteudo);
      // Arquivo esparso: os limites de tamanho são testados sem gravar centenas de MiB.
      if (tamanho !== undefined) truncateSync(caminho, tamanho);
      return caminho;
    },
  };
}

const sha = (conteudo: string | Buffer) => createHash("sha256").update(conteudo).digest("hex");
const contar = (banco: DatabaseSync, tabela: string) =>
  (banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get() as { n: number }).n;

/** Recusa com a mensagem e sem gravar nada: nem evidência, nem arquivo guardado. */
function recusa(c: Cenario, trabalho: () => unknown, classe: typeof ErroDeRegra | typeof ErroDeEscopo, msg: string) {
  assert.throws(trabalho, (e) => e instanceof classe && e.message === msg);
  assert.equal(contar(c.banco, "evidencia"), 0);
  const arquivos = join(c.raiz, "arquivos");
  assert.deepEqual(existsSync(arquivos) ? readdirSync(arquivos) : [], []);
}

test("submeter valida, guarda os arquivos por conteúdo e grava comportamento com os dados do schema", () => {
  const c = cenario();
  const video = c.arquivo(c.saida, "tela.webm", WEBM);
  const log = c.arquivo(c.worktree, "erro.log", "Error: timeout\n");
  const ag = submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [video, log]);

  assert.deepEqual(agregado(c.banco, 1), ag);
  const [evidencia] = ag.evidencias;
  assert.deepEqual(
    { ...evidencia, em: undefined },
    {
      id: 1,
      ticket: 1,
      tipo: "comportamento",
      produtor: "agente",
      dados: { descricao: "login lento", comoReproduzir: ["abrir", "entrar"] },
      arquivos: [
        { nome: "tela.webm", mime: "video/webm", sha256: sha(WEBM), bytes: WEBM.length },
        { nome: "erro.log", mime: "text/plain; charset=utf-8", sha256: sha("Error: timeout\n"), bytes: 15 },
      ],
      em: undefined,
    },
  );
  assert.deepEqual(readFileSync(caminhoArquivo(c.banco, sha(WEBM))), WEBM);
  assert.equal(c.banco.prepare("SELECT ator FROM comando WHERE nome = 'registrarEvidencia'").get()?.ator, "agente");
  c.banco.close();
});

test("resubmeter o mesmo tipo substitui a evidência; o arquivo antigo continua guardado", () => {
  const c = cenario();
  const primeiro = c.arquivo(c.saida, "a.webm", WEBM);
  submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [primeiro]);
  const segundo = c.arquivo(c.saida, "b.mp4", MP4);
  const ag = submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [segundo]);

  assert.deepEqual(
    ag.evidencias.map((e) => [e.id, e.arquivos.map((a) => [a.nome, a.mime])]),
    [[2, [["b.mp4", "video/mp4"]]]],
  );
  assert.equal(contar(c.banco, "evidencia_arquivo"), 1);
  assert.equal(existsSync(caminhoArquivo(c.banco, sha(WEBM))), true);
  c.banco.close();
});

test("criterios_aceite não aceita arquivo; comportamento exige pelo menos um", () => {
  const c = cenario();
  const dados = { criterios: [CRITERIO] };
  recusa(
    c,
    () => submeter(c.banco, agente, "criterios_aceite", dados, [c.arquivo(c.worktree, "x.txt", "x")]),
    ErroDeRegra,
    "criterios_aceite aceita no máximo 0 arquivo(s), e vieram 1 (submeta sem os excedentes)",
  );
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, []),
    ErroDeRegra,
    "comportamento precisa de pelo menos 1 arquivo(s), e veio 0 (anexe com --arquivo <caminho>)",
  );
  assert.equal(submeter(c.banco, agente, "criterios_aceite", dados, []).evidencias[0]?.tipo, "criterios_aceite");
  c.banco.close();
});

test("dados fora do schema: ZodError com o caminho de cada campo a partir de dados (z.prettifyError)", () => {
  const c = cenario();
  const dados = { criterios: [CRITERIO, { ...CRITERIO, id: "CA-2" }, { ...CRITERIO, id: "CA3", entao: undefined }] };
  let erro: unknown;
  try {
    submeter(c.banco, agente, "criterios_aceite", dados, []);
  } catch (error_) {
    erro = error_;
  }
  assert.ok(erro instanceof ZodError);
  const texto = z.prettifyError(erro);
  assert.match(texto, /→ at dados\.criterios\[2\]\.id/);
  assert.match(texto, /→ at dados\.criterios\[2\]\.entao/);
  assert.throws(() => submeter(c.banco, agente, "comportamento", undefined, []), ZodError);
  assert.throws(
    () => submeter(c.banco, agente, "video", {}, []),
    (e) => e instanceof ZodError && z.prettifyError(e).includes("→ at tipo"),
  );
  assert.equal(contar(c.banco, "evidencia"), 0);
  c.banco.close();
});

test("origem: só da worktree ou da saída, pelo caminho real do descritor; link simbólico para fora é recusado", () => {
  const c = cenario();
  const fora = c.arquivo(c.raiz, "segredo.txt", "senha");
  const foraDaSaida = "fora da worktree da issue e do diretório de saída";
  const solucao = `(copie-o para $FABRIQUINHA_SAIDA (${c.saida}))`;

  // Link no último componente nunca é seguido, aponte para fora ou para dentro.
  symlinkSync(fora, join(c.worktree, "atalho.txt"));
  symlinkSync(c.arquivo(c.saida, "real.txt", "passo"), join(c.worktree, "link.txt"));
  for (const link of ["atalho.txt", "link.txt"]) {
    recusa(
      c,
      () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [join(c.worktree, link)]),
      ErroDeRegra,
      `${join(c.worktree, link)} é um link simbólico (anexe o próprio arquivo, não um link para ele)`,
    );
  }
  // Link de pasta no meio do caminho é resolvido: vale o lugar real do arquivo.
  symlinkSync(c.raiz, join(c.worktree, "pasta"));
  const viaPasta = join(c.worktree, "pasta", "segredo.txt");
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [viaPasta]),
    ErroDeRegra,
    `${viaPasta} está ${foraDaSaida} ${solucao}`,
  );
  const subindo = join(c.worktree, "..", "..", "..", "segredo.txt");
  assert.throws(() => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [subindo]), /fora da worktree/);
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [join(c.worktree, "nao-existe.txt")]),
    ErroDeRegra,
    `${join(c.worktree, "nao-existe.txt")} não existe (confira o caminho do arquivo)`,
  );
  mkdirSync(join(c.worktree, "src"));
  const fifo = join(c.worktree, "fifo");
  execFileSync("mkfifo", [fifo]);
  for (const especial of [join(c.worktree, "src"), fifo]) {
    recusa(
      c,
      () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [especial]),
      ErroDeRegra,
      `${especial} não é um arquivo regular (anexe um arquivo comum)`,
    );
  }

  const semLeitura = c.arquivo(c.worktree, "trancado.txt", "x");
  chmodSync(semLeitura, 0o000);
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [semLeitura]),
    ErroDeRegra,
    `sem permissão para ler ${semLeitura} (dê permissão de leitura ao arquivo)`,
  );
  // Outros erros de abertura sobem como vieram.
  assert.throws(() => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [join(semLeitura, "x")]), {
    code: "ENOTDIR",
  });
  const grande = c.arquivo(c.worktree, "grande.bin", "", 500 * 1024 * 1024 + 1);
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [grande]),
    ErroDeRegra,
    `${grande} tem 500.0 MiB, e nenhum anexo passa de 500.0 MiB (reduza o arquivo)`,
  );

  symlinkSync(c.saida, join(c.worktree, "saida"));
  const viaSaida = join(c.worktree, "saida", "real.txt");
  assert.deepEqual(
    submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [viaSaida]).evidencias[0]?.arquivos.map((a) => a.nome),
    ["real.txt"],
  );
  // A saída trocada por um link para fora não leva a origem junto: as raízes não são resolvidas pelo nome.
  rmSync(c.saida, { recursive: true });
  symlinkSync(c.raiz, c.saida);
  const viaSaidaTrocada = join(c.saida, "segredo.txt");
  assert.throws(
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [viaSaidaTrocada]),
    (e) => e instanceof ErroDeRegra && e.message === `${viaSaidaTrocada} está ${foraDaSaida} ${solucao}`,
  );
  // Sem o diretório de saída, a worktree continua valendo.
  rmSync(c.saida);
  const daWorktree = c.arquivo(c.worktree, "passo.txt", "passo 2");
  assert.equal(submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [daWorktree]).evidencias.length, 1);
  c.banco.close();
});

/**
 * Faz `vezes` submissões de `worktree/x.txt` enquanto um `/bin/sh` roda `script` sem parar, mexendo nele, e conta o
 * desfecho de cada uma: o que `guardado` diz do anexo guardado, ou a mensagem do erro.
 */
async function corrida(
  c: Cenario,
  script: string,
  vezes: number,
  guardado: (anexo: { conteudo: string; mime: string }) => string,
): Promise<Map<string, number>> {
  const fds = readdirSync("/proc/self/fd").length;
  const trocador = spawn("/bin/sh", ["-c", `while :; do ${script}; done`], { cwd: c.worktree, stdio: "ignore" });
  const fim = once(trocador, "close");
  await once(trocador, "spawn");
  const desfechos = new Map<string, number>();
  try {
    for (let i = 0; i < vezes; i++) {
      let desfecho: string;
      try {
        const ag = submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [join(c.worktree, "x.txt")]);
        const [anexo] = ag.evidencias[0]?.arquivos ?? [];
        assert.ok(anexo);
        desfecho = guardado({
          conteudo: readFileSync(caminhoArquivo(c.banco, anexo.sha256), "utf8"),
          mime: anexo.mime,
        });
      } catch (error_) {
        desfecho = String(error_);
      }
      desfechos.set(desfecho, (desfechos.get(desfecho) ?? 0) + 1);
    }
  } finally {
    trocador.kill();
    await fim;
  }
  assert.equal(trocador.signalCode, "SIGTERM", "o sh que mexe no arquivo rodou até o fim da corrida");
  assert.equal(readdirSync("/proc/self/fd").length, fds, "nenhum descritor fica aberto");
  return desfechos;
}

const TEXTO = "text/plain; charset=utf-8";

test("regressão TOCTOU: trocar o anexo por um link para fora durante a submissão nunca guarda o conteúdo de fora", async () => {
  const c = cenario();
  const segredo = c.arquivo(c.raiz, "segredo.txt", "SEGREDO\n");
  c.arquivo(c.worktree, "regular", "inocente\n");
  c.arquivo(c.worktree, "x.txt", "inocente\n");
  const linkRecusado = `ErroDeRegra: ${join(c.worktree, "x.txt")} é um link simbólico (anexe o próprio arquivo, não um link para ele)`;
  // Troca x.txt, atomicamente, entre um arquivo regular e um link para fora.
  const desfechos = await corrida(
    c,
    `cp regular r.tmp; mv -f r.tmp x.txt; ln -sf '${segredo}' l.tmp; mv -fT l.tmp x.txt`,
    3000,
    ({ conteudo, mime }) => `${mime} ${conteudo}`,
  );
  // Os dois desfechos aparecem, então a troca aconteceu durante a corrida; nenhum outro aparece.
  assert.deepEqual([...desfechos.keys()].sort(), [linkRecusado, `${TEXTO} inocente\n`].sort());
  c.banco.close();
});

test("regressão TOCTOU: reescrever o anexo no mesmo inode durante a submissão não guarda o que não foi validado", async () => {
  const c = cenario();
  c.arquivo(c.worktree, "x.txt", "inocente\n");
  const htmlRecusado = `ErroDeRegra: ${join(c.worktree, "x.txt")} é html, e comportamento aceita só video ou texto (anexe um arquivo de uma dessas classes)`;
  // Mesmo tamanho, mesmo inode: alterna entre um texto e um HTML, que comportamento não aceita.
  const desfechos = await corrida(
    c,
    `printf 'inocente\\n' 1<> x.txt; printf '<html>!!!' 1<> x.txt`,
    1000,
    ({ conteudo, mime }) => (/^\s*<html/i.test(conteudo) ? `HTML guardado como ${mime}` : mime),
  );
  // Leitura no meio de uma escrita pode misturar os dois; o que importa é que o guardado é o que foi classificado.
  assert.deepEqual([...desfechos.keys()].sort(), [htmlRecusado, TEXTO].sort());
  c.banco.close();
});

test("classe pelos bytes iniciais, não pela extensão, e o limite de cada classe", () => {
  const c = cenario();
  const tentar = (nome: string, conteudo: string | Buffer, tamanho?: number) => () =>
    submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [c.arquivo(c.saida, nome, conteudo, tamanho)]);
  const caminho = (nome: string) => join(c.saida, nome);

  recusa(
    c,
    tentar("foto.txt", PNG),
    ErroDeRegra,
    `${caminho("foto.txt")} é imagem, e comportamento aceita só video ou texto (anexe um arquivo de uma dessas classes)`,
  );
  assert.throws(tentar("foto.webm", JPEG), /é imagem, e comportamento aceita só video ou texto/);
  assert.throws(tentar("pagina.txt", HTML), /pagina\.txt é html, e comportamento/);
  const naoAceito =
    "não é vídeo WebM/MP4, imagem PNG/JPEG nem texto UTF-8 sem byte nulo (anexe um arquivo de um desses formatos)";
  recusa(
    c,
    tentar("binario.log", Buffer.from([0x00, 0x01, 0x02])),
    ErroDeRegra,
    `${caminho("binario.log")} ${naoAceito}`,
  );
  recusa(
    c,
    tentar("latin1.txt", Buffer.from([0x61, 0xc3, 0x28])),
    ErroDeRegra,
    `${caminho("latin1.txt")} ${naoAceito}`,
  );
  recusa(
    c,
    tentar("grande.webm", WEBM, 500 * MiB + 1),
    ErroDeRegra,
    `${caminho("grande.webm")} tem 500.0 MiB, e nenhum anexo passa de 500.0 MiB (reduza o arquivo)`,
  );
  assert.throws(tentar("grande.png", PNG, 20 * MiB + 1), /grande\.png tem 20\.0 MiB, e imagem aceita até 20\.0 MiB/);
  recusa(
    c,
    tentar("grande.txt", "a", 5 * MiB + 1),
    ErroDeRegra,
    `${caminho("grande.txt")} tem 5.0 MiB e não é vídeo WebM/MP4 nem imagem PNG/JPEG (texto e HTML aceitam até 5.0 MiB)`,
  );

  const nos = [
    c.arquivo(c.saida, "filme.mp4", MP4),
    c.arquivo(c.saida, "no-limite.txt", "a".repeat(5 * MiB)),
    c.arquivo(c.saida, "vazio.txt", ""),
  ];
  const ag = submeter(c.banco, agente, "comportamento", COMPORTAMENTO, nos);
  assert.deepEqual(
    ag.evidencias[0]?.arquivos.map((a) => [a.nome, a.mime, a.bytes]),
    [
      ["filme.mp4", "video/mp4", MP4.length],
      ["no-limite.txt", "text/plain; charset=utf-8", 5 * MiB],
      ["vazio.txt", "text/plain; charset=utf-8", 0],
    ],
  );
  c.banco.close();
});

test("nomes de anexo: únicos na submissão e de até 200 caracteres", () => {
  const c = cenario();
  const a = c.arquivo(c.worktree, "passos.txt", "1");
  const b = c.arquivo(c.saida, "passos.txt", "2");
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [a, b]),
    ErroDeRegra,
    "dois anexos se chamam passos.txt (renomeie um deles)",
  );
  const longo = "a".repeat(201);
  recusa(
    c,
    () => submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [c.arquivo(c.saida, longo, "1")]),
    ErroDeRegra,
    `o nome ${longo} passa de 200 caracteres (renomeie o arquivo)`,
  );
  c.banco.close();
});

test("escopo: só o agente do ticket em execução, com tipo da etapa e produzido por agente", () => {
  const c = cenario();
  const log = c.arquivo(c.worktree, "passos.txt", "1");
  const enviar =
    (ator: Ator, tipo = "comportamento") =>
    () =>
      submeter(c.banco, ator, tipo, COMPORTAMENTO, [log]);
  recusa(
    c,
    enviar(auditor),
    ErroDeEscopo,
    "só o agente do ticket submete evidência (a Fabriquinha registra as dela nos coletores)",
  );
  recusa(
    c,
    enviar(fabriquinha),
    ErroDeEscopo,
    "só o agente do ticket submete evidência (a Fabriquinha registra as dela nos coletores)",
  );
  recusa(
    c,
    enviar({ tipo: "agente", execucao: 1, ticket: 9 }),
    ErroDeEscopo,
    "o ticket T-9 não existe (confira a execução em FABRIQUINHA_EXECUCAO)",
  );
  recusa(
    c,
    enviar(agente, "desenho_solucao"),
    ErroDeRegra,
    "desenho_solucao não é evidência da etapa registro (a etapa registro aceita: comportamento, criterios_aceite)",
  );
  comIssue(c.banco, 1, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao: 1, resultado: "sucesso" }, fabriquinha, ctx),
  );
  recusa(c, enviar(agente), ErroDeEscopo, "a execução E-1 já terminou (peça ao Auditor uma nova execução)");
  c.banco.close();
});
