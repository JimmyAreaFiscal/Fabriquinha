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
import type { Ator, TipoIssue } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "../dominio/erros.ts";
import { evidenciasFaltando, registrarEvidencia } from "../dominio/evidencia.ts";
import { iniciarExecucao, terminarExecucao } from "../dominio/execucao.ts";
import { decidirRegistro } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
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

const desenhista: Ator = { tipo: "agente", execucao: 2, ticket: 2 };
const SOLUCAO = {
  resumo: "cache na busca",
  arquivosPrevistos: [{ caminho: "src/busca/*.ts", acao: "alterar", motivo: "lê do cache" }],
};
const COMPLEXIDADE = {
  variaveis: [{ simbolo: "n", significado: "itens do catálogo" }],
  fluxos: [{ nome: "Busca", gatilho: "GET /busca", situacao: "novo", depois: { tempo: "O(log n)", espaco: "O(n)" } }],
};
const IMPACTOS = { impacto: "baixo", novasDependencias: [], novosAcoplamentos: [], riscos: [] };

/** O cenário com o registro aprovado: I-1 do tipo `tipo` em `desenho`, com T-2 rodando na E-2 (autônoma). */
function noDesenho(tipo: TipoIssue): Cenario & { saida2: string } {
  const c = cenario();
  submeter(c.banco, agente, "comportamento", COMPORTAMENTO, [c.arquivo(c.saida, "tela.webm", WEBM)]);
  submeter(c.banco, agente, "criterios_aceite", { criterios: [CRITERIO] }, []);
  comIssue(c.banco, 1, "editarIssue", auditor, (ag) => editarIssue(ag, { titulo: "Busca lenta", tipo }, auditor));
  comIssue(c.banco, 1, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao: 1, resultado: "sucesso" }, fabriquinha, ctx),
  );
  comIssue(c.banco, 1, "decidirRegistro", auditor, (ag, ctx) => decidirRegistro(ag, { aprovado: true }, auditor, ctx));
  comIssue(c.banco, 1, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(
      ag,
      { ticket: 2, modo: "autonomo", sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c" },
      fabriquinha,
      ctx,
    ),
  );
  const saida2 = join(c.raiz, "execucoes", "E-2", "saida");
  mkdirSync(saida2, { recursive: true });
  return { ...c, saida2 };
}

test("desenho: o agente submete as quatro evidências; prototipo só é obrigatório na funcionalidade", () => {
  for (const tipo of ["funcionalidade", "problema"] as const) {
    const c = noDesenho(tipo);
    const html = (nome: string) => c.arquivo(c.saida2, nome, HTML);
    const desenho = () => {
      const ag = agregado(c.banco, 1);
      assert.ok(ag);
      const ticket = ag.tickets.find((t) => t.id === 2);
      assert.ok(ticket);
      return evidenciasFaltando(ag, ticket);
    };
    assert.deepEqual(desenho(), [
      "desenho_solucao",
      ...(tipo === "funcionalidade" ? ["prototipo"] : []),
      "relatorio_complexidade",
      "relatorio_impactos_arquitetura",
    ]);
    submeter(c.banco, desenhista, "desenho_solucao", SOLUCAO, [html("desenho.html")]);
    submeter(c.banco, desenhista, "relatorio_complexidade", COMPLEXIDADE, [html("fluxos.html")]);
    const ag = submeter(c.banco, desenhista, "relatorio_impactos_arquitetura", IMPACTOS, [html("impactos.html")]);
    assert.deepEqual(desenho(), tipo === "funcionalidade" ? ["prototipo"] : []);
    assert.deepEqual(
      ag.evidencias.filter((e) => e.ticket === 2).map((e) => [e.tipo, e.arquivos.map((a) => a.mime)]),
      [
        ["desenho_solucao", ["text/html; charset=utf-8"]],
        ["relatorio_complexidade", ["text/html; charset=utf-8"]],
        ["relatorio_impactos_arquitetura", ["text/html; charset=utf-8"]],
      ],
    );
    assert.deepEqual(ag.evidencias.find((e) => e.tipo === "desenho_solucao")?.dados, { ...SOLUCAO, foraDeEscopo: [] });

    // Na issue de problema o protótipo é opcional, mas aceito.
    const prototipo = [c.arquivo(c.saida2, "demo.webm", WEBM), c.arquivo(c.worktree, "demo.ts", "export {};\n")];
    submeter(c.banco, desenhista, "prototipo", { descricao: "tela nova" }, prototipo);
    assert.deepEqual(desenho(), []);
    c.banco.close();
  }
});

test("prototipo precisa de um vídeo ou print; os relatórios do desenho, de exatamente um HTML", () => {
  const c = noDesenho("funcionalidade");
  const recusar = (tipo: string, dados: unknown, caminhos: string[], msg: string) => {
    const evidencias = contar(c.banco, "evidencia");
    assert.throws(
      () => submeter(c.banco, desenhista, tipo, dados, caminhos),
      (e) => e instanceof ErroDeRegra && e.message === msg,
    );
    assert.equal(contar(c.banco, "evidencia"), evidencias);
  };
  const guardados = () => readdirSync(join(c.raiz, "arquivos"), { recursive: true }).length;
  const antes = guardados();
  const pagina = c.arquivo(c.saida2, "demo.html", HTML);
  const codigo = c.arquivo(c.saida2, "demo.ts", "export {};\n");
  recusar(
    "prototipo",
    { descricao: "tela nova" },
    [pagina, codigo],
    "protótipo precisa de pelo menos um vídeo ou print (anexe também um arquivo video ou imagem)",
  );
  // A recusa vem antes de guardar: nenhum dos dois anexos ficou.
  assert.equal(guardados(), antes);
  const print = c.arquivo(c.saida2, "tela.png", PNG);
  const ag = submeter(c.banco, desenhista, "prototipo", { descricao: "tela nova" }, [pagina, print]);
  assert.deepEqual(
    ag.evidencias.at(-1)?.arquivos.map((a) => a.mime),
    ["text/html; charset=utf-8", "image/png"],
  );

  recusar(
    "desenho_solucao",
    SOLUCAO,
    [print],
    `${print} é imagem, e desenho_solucao aceita só html (anexe um arquivo de uma dessas classes)`,
  );
  recusar(
    "relatorio_complexidade",
    COMPLEXIDADE,
    [pagina, c.arquivo(c.saida2, "outro.html", HTML)],
    "relatorio_complexidade aceita no máximo 1 arquivo(s), e vieram 2 (submeta sem os excedentes)",
  );
  recusar(
    "relatorio_impactos_arquitetura",
    IMPACTOS,
    [],
    "relatorio_impactos_arquitetura precisa de pelo menos 1 arquivo(s), e veio 0 (anexe com --arquivo <caminho>)",
  );
  c.banco.close();
});

test("relatorio_complexidade com símbolo não declarado: ZodError no caminho do Big-O a partir de dados", () => {
  const c = noDesenho("problema");
  const fluxo = { ...COMPLEXIDADE.fluxos[0], depois: { tempo: "O(n * k)", espaco: "O(n²)" } };
  let erro: unknown;
  try {
    submeter(c.banco, desenhista, "relatorio_complexidade", { ...COMPLEXIDADE, fluxos: [fluxo] }, []);
  } catch (error_) {
    erro = error_;
  }
  assert.ok(erro instanceof ZodError);
  assert.equal(
    z.prettifyError(erro),
    "✖ fora da gramática Big-O (ex.: O(1), O(n log n), O(n^2), O(n + m))\n  → at dados.fluxos[0].depois.espaco\n" +
      "✖ k não está declarado em variaveis\n  → at dados.fluxos[0].depois.tempo",
  );
  c.banco.close();
});

const RODADO = { comando: "c", codigoSaida: 0, estourou: false, duracaoMs: 1 };

/**
 * O cenário na revisão, com T-2 rodando na E-2. A revisão real só nasce do desenvolvimento (provado em
 * execucao/desenvolvimento.test.ts); aqui o T-2 vira revisão por UPDATE. `fitness`: as linhas da matriz que a
 * Fabriquinha coletou antes do pi; vazio, ela não foi coletada.
 */
function naRevisao(fitness: string[]): Cenario & { saida2: string } {
  const c = noDesenho("problema");
  c.banco.exec("UPDATE issue SET fase = 'revisao'; UPDATE ticket SET etapa = 'revisao' WHERE id = 2");
  if (fitness.length > 0) {
    const linhas = fitness.map((nome) => ({ nome, descricao: "d", ...RODADO, log: `${nome}.log` }));
    comIssue(c.banco, 1, "registrarEvidencia", fabriquinha, (ag, ctx) =>
      registrarEvidencia(
        ag,
        { ticket: 2, tipo: "matriz_fitness", aprovada: true, dados: { linhas }, arquivos: [] },
        fabriquinha,
        ctx,
      ),
    );
  }
  return c;
}

const revisor = desenhista;

test("explicacao_fitness: exatamente uma explicação por linha da matriz_fitness do próprio ticket", () => {
  const c = naRevisao(["complexidade", "camadas"]);
  const explicar = (...nomes: string[]) =>
    submeter(
      c.banco,
      revisor,
      "explicacao_fitness",
      { explicacoes: nomes.map((nome) => ({ nome, explicacao: "ok" })) },
      [],
    );
  const recusar = (nomes: string[], msg: string) => {
    assert.throws(
      () => explicar(...nomes),
      (e) => e instanceof ErroDeRegra && e.message === msg,
    );
  };
  const tem =
    "e a matriz_fitness de T-2 tem as linhas [camadas, complexidade] " +
    "(submeta exatamente uma explicação por linha da matriz)";
  recusar(["complexidade"], `explicacao_fitness explica [complexidade], ${tem}`);
  recusar(
    ["complexidade", "camadas", "camadas"],
    `explicacao_fitness explica [camadas, camadas, complexidade], ${tem}`,
  );
  recusar(["complexidade", "cobertura"], `explicacao_fitness explica [cobertura, complexidade], ${tem}`);
  const ag = explicar("camadas", "complexidade");
  const e = ag.evidencias.find((x) => x.tipo === "explicacao_fitness");
  assert.deepEqual([e?.produtor, e?.aprovada], ["agente", undefined]);
  c.banco.close();

  const semMatriz = naRevisao([]);
  assert.throws(
    () =>
      submeter(semMatriz.banco, revisor, "explicacao_fitness", { explicacoes: [{ nome: "f", explicacao: "ok" }] }, []),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message.startsWith("explicacao_fitness explica [f], e a matriz_fitness de T-2 tem as linhas []"),
  );
  semMatriz.banco.close();
});

test("comprovacao_criterios: os critérios do registro, cada anexo citado presente; aprovada se todos atendidos", () => {
  const c = naRevisao(["f"]);
  const print = c.arquivo(c.saida2, "ca-1.png", PNG);
  const video = c.arquivo(c.saida2, "ca-1.webm", WEBM);
  const comprovar = (criterios: object[], anexos = [print]) =>
    submeter(c.banco, revisor, "comprovacao_criterios", { criterios }, anexos);
  const criterio = (troca: object = {}) => ({
    id: "CA-1",
    atendido: true,
    comoVerificado: "busquei mil itens",
    arquivos: ["ca-1.png"],
    ...troca,
  });
  const recusar = (criterios: object[], msg: string) => {
    const guardados = readdirSync(join(c.raiz, "arquivos"), { recursive: true }).length;
    assert.throws(
      () => comprovar(criterios),
      (e) => e instanceof ErroDeRegra && e.message === msg,
    );
    assert.equal(readdirSync(join(c.raiz, "arquivos"), { recursive: true }).length, guardados, "nada guardado");
  };
  const exatos =
    "e os critérios de aceite do registro são [CA-1] (submeta exatamente uma comprovação por critério de aceite)";
  recusar([], `comprovacao_criterios comprova [], ${exatos}`);
  // F3 §5: os arquivos (passo 4) são validados antes das regras cruzadas (passo 5).
  const pagina = c.arquivo(c.saida2, "ca-1.html", HTML);
  assert.throws(
    () => comprovar([], [pagina]),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message ===
        `${pagina} é html, e comprovacao_criterios aceita só video ou imagem (anexe um arquivo de uma dessas classes)`,
  );
  recusar([criterio(), criterio({ id: "CA-2" })], `comprovacao_criterios comprova [CA-1, CA-2], ${exatos}`);
  recusar([criterio(), criterio()], `comprovacao_criterios comprova [CA-1, CA-1], ${exatos}`);
  recusar(
    [criterio({ arquivos: ["ca-1.png", "ca-1.webm", "ca-1.webm"] })],
    "comprovacao_criterios cita ca-1.webm, que não está entre os anexos " +
      "(anexe cada arquivo citado com --arquivo <caminho>, com o mesmo nome)",
  );

  const aprovada = () => agregado(c.banco, 1)?.evidencias.find((e) => e.tipo === "comprovacao_criterios")?.aprovada;
  comprovar([criterio({ atendido: false })]);
  assert.equal(aprovada(), false);
  comprovar([criterio({ arquivos: ["ca-1.png", "ca-1.webm"] })], [print, video]);
  assert.equal(aprovada(), true);
  c.banco.close();
});
