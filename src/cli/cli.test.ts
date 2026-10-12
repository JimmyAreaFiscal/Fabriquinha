// CLI do agente (F7 §7, CLI) contra banco real numa raiz temporária: cada linha da tabela 3.2 como agente da etapa
// certa, de outra etapa e de execução terminada; sem a variável; uso inválido; e o executável de verdade.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { AUDITOR, FABRIQUINHA } from "../dominio/agregado.ts";
import { iniciarExecucao, terminarExecucao } from "../dominio/execucao.ts";
import type { Etapa } from "../dominio/primitivos.ts";
import { abrir } from "../persistencia/banco.ts";
import { comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { comandoDoNavegador, principal } from "./cli.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-cli-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

interface Saida {
  codigo: number;
  out: string;
  err: string;
}

/** Roda o CLI no processo do teste, com `env` no lugar do ambiente e `stdin` como entrada. */
async function cli(env: NodeJS.ProcessEnv, args: string[], stdin = ""): Promise<Saida> {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([stdin]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
  });
  return { codigo, out, err };
}

/** O JSON de uma saída de sucesso, que é uma linha só. */
function json(s: Saida): Record<string, unknown> {
  assert.equal(s.err, "");
  assert.equal(s.codigo, 0);
  assert.match(s.out, /^[^\n]+\n$/);
  return JSON.parse(s.out) as Record<string, unknown>;
}

/** Falha com código 1 e a mensagem do F1 em uma linha no stderr. */
function falha(s: Saida, mensagem: string | RegExp): void {
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /^[^\n]+\n$/);
  if (typeof mensagem === "string") assert.equal(s.err, `${mensagem}\n`);
  else assert.match(s.err, mensagem);
}

/** Uso inválido: código 2, o motivo e a ajuda só do grupo. */
function usoInvalido(s: Saida, motivo: string | RegExp, grupo: string): void {
  assert.deepEqual([s.codigo, s.out], [2, ""]);
  const [primeira, ...resto] = s.err.split("\n");
  if (typeof motivo === "string") assert.equal(primeira, motivo);
  else assert.match(String(primeira), motivo);
  const usos = resto.filter((l) => l.startsWith("  fabriquinha "));
  assert.ok(usos.length > 0);
  for (const linha of usos) assert.ok(linha.startsWith(`  fabriquinha ${grupo} `), linha);
}

const FASE: Readonly<Record<Etapa, string>> = {
  registro: "registro",
  desenho: "desenho",
  desenvolvimento: "desenvolvimento",
  revisao: "revisao",
  encerramento: "encerramento",
  sessao: "ajuste_pr",
};

interface Cenario {
  raiz: string;
  banco: DatabaseSync;
  /** O ambiente do agente de T-1 na E-1. */
  env: NodeJS.ProcessEnv;
  saida: string;
  terminar(): void;
}

/**
 * I-1 do projeto `loja` com o ticket T-1 da `etapa` rodando na E-1, e I-2 (com T-2) para ser dependência. A etapa e a
 * fase entram por UPDATE: o que importa aqui é o escopo que o CLI repassa, não o caminho até a fase.
 */
function cenario(etapa: Etapa): Cenario {
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
  registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  banco.prepare("UPDATE issue SET fase = ?, titulo = 'Busca lenta', tipo = 'problema' WHERE id = 1").run(FASE[etapa]);
  banco.prepare("UPDATE ticket SET etapa = ? WHERE id = 1").run(etapa);
  const modo = etapa === "registro" || etapa === "sessao" ? "interativo" : "autonomo";
  comIssue(banco, 1, "iniciarExecucao", FABRIQUINHA, (ag, ctx) =>
    iniciarExecucao(ag, { ticket: 1, modo, sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" }, FABRIQUINHA, ctx),
  );
  const saida = join(raiz, "execucoes", "E-1", "saida");
  mkdirSync(saida, { recursive: true });
  return {
    raiz,
    banco,
    env: { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "1" },
    saida,
    terminar() {
      comIssue(banco, 1, "terminarExecucao", FABRIQUINHA, (ag, ctx) =>
        terminarExecucao(ag, { execucao: 1, resultado: "sucesso" }, FABRIQUINHA, ctx),
      );
    },
  };
}

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const COMPORTAMENTO = { descricao: "login lento", comoReproduzir: ["abrir", "entrar"] };
const CRITERIOS = { criterios: [{ id: "CA-1", dado: "um usuário", quando: "entra", entao: "vê o painel" }] };

/** Submete `comportamento` com `--dados` de arquivo e um vídeo da saída da execução. */
async function submeterComportamento(c: Cenario): Promise<Saida> {
  const dados = join(c.raiz, "dados.json");
  writeFileSync(dados, JSON.stringify(COMPORTAMENTO));
  const video = join(c.saida, "tela.webm");
  writeFileSync(video, WEBM);
  return cli(c.env, ["evidencia", "add", "comportamento", "--dados", dados, "--arquivo", video]);
}

const ticketCriar = (c: Cenario) => cli(c.env, ["ticket", "criar", "I-1", "--titulo", "Cache na busca"]);

/** Uma linha da tabela 3.2. `outra` falta nas leituras, que valem em todas as etapas. */
interface Linha {
  args: string[];
  etapa: Etapa;
  stdin?: string;
  preparar?(c: Cenario): Promise<unknown>;
  confere(saida: Record<string, unknown>, c: Cenario): void;
  outra?: { etapa: Etapa; args?: string[]; erro: string | RegExp };
}

const quemPropoe = "quem pode é o Auditor ou o agente de desenho, revisao, sessao da I-1";

const TABELA: readonly Linha[] = [
  {
    args: ["projeto", "ver"],
    etapa: "desenho",
    confere: (s) => {
      assert.deepEqual([s.nome, s.repo], ["loja", "/repos/loja"]);
    },
  },
  {
    args: ["issue", "ver", "I-1"],
    etapa: "registro",
    confere: (s) => {
      assert.deepEqual([s.id, s.fase, (s.tickets as { id: number }[]).map((t) => t.id)], [1, "registro", [1]]);
    },
  },
  {
    args: ["issue", "editar", "I-1", "--titulo", "Busca lenta", "--tipo", "problema", "--descricao", "-"],
    etapa: "registro",
    stdin: "# Busca\n\nlenta com \"aspas\" e 'apóstrofos'",
    confere: (s) => {
      assert.deepEqual(
        [s.titulo, s.tipo, s.descricao],
        ["Busca lenta", "problema", "# Busca\n\nlenta com \"aspas\" e 'apóstrofos'"],
      );
    },
    outra: {
      etapa: "desenho",
      erro: "o agente de T-1 não pode editar a I-1 (quem pode é o Auditor ou o agente de registro da I-1)",
    },
  },
  {
    args: ["issue", "dep", "add", "I-1", "2"],
    etapa: "registro",
    confere: (s) => {
      assert.deepEqual(s.deps, [2]);
    },
    outra: {
      etapa: "desenho",
      erro: "o agente de T-1 não pode mudar as dependências da I-1 (quem pode é o Auditor ou o agente de registro da I-1)",
    },
  },
  {
    args: ["issue", "dep", "rm", "1", "I-2"],
    etapa: "registro",
    preparar: (c) => cli(c.env, ["issue", "dep", "add", "I-1", "I-2"]),
    confere: (s) => {
      assert.deepEqual(s.deps, []);
    },
    outra: {
      etapa: "revisao",
      erro: "o agente de T-1 não pode mudar as dependências da I-1 (quem pode é o Auditor ou o agente de registro da I-1)",
    },
  },
  {
    args: ["ticket", "ver", "T-2"],
    etapa: "sessao",
    confere: (s) => {
      assert.deepEqual([s.id, s.issue, s.etapa], [2, 2, "registro"]);
    },
  },
  {
    args: ["ticket", "criar", "I-1", "--titulo", "Cache na busca", "--descricao", "-"],
    etapa: "desenho",
    stdin: "Guardar o resultado.",
    confere: (s) => {
      assert.deepEqual(
        [s.id, s.etapa, s.titulo, s.descricao, s.status, s.origem, s.origemTicket],
        [3, "desenvolvimento", "Cache na busca", "Guardar o resultado.", "aberto", "agente", 1],
      );
    },
    outra: { etapa: "registro", erro: `o agente de T-1 não pode criar ticket na I-1 (${quemPropoe})` },
  },
  {
    args: ["ticket", "editar", "T-3", "--titulo", "Cache no catálogo"],
    etapa: "revisao",
    preparar: ticketCriar,
    confere: (s) => {
      assert.deepEqual([s.id, s.titulo], [3, "Cache no catálogo"]);
    },
    outra: {
      etapa: "registro",
      args: ["ticket", "editar", "T-1", "--titulo", "Outro"],
      erro: `o agente de T-1 não pode editar T-1 (${quemPropoe})`,
    },
  },
  {
    args: ["ticket", "remover", "3"],
    etapa: "sessao",
    preparar: ticketCriar,
    confere: (s, c) => {
      assert.deepEqual(s, { removido: 3 });
      assert.equal(c.banco.prepare("SELECT 1 FROM ticket WHERE id = 3").get(), undefined);
    },
    outra: {
      etapa: "registro",
      args: ["ticket", "remover", "T-1"],
      erro: `o agente de T-1 não pode remover T-1 (${quemPropoe})`,
    },
  },
  {
    args: ["revisao", "decidir", "T-1", "reprovar", "--motivo", "falta teste"],
    etapa: "revisao",
    confere: (s) => {
      assert.deepEqual([s.ticket, s.gate, s.aprovado, s.motivo, s.por], [1, "revisao", false, "falta teste", "agente"]);
    },
    outra: {
      etapa: "desenho",
      args: ["revisao", "decidir", "T-1", "aprovar"],
      erro: "T-1 é de desenho e está em_execucao, não é uma revisão em execução (só a revisão registra a decisão de revisão)",
    },
  },
  {
    args: ["evidencia", "add", "criterios_aceite", "--dados", "-"],
    etapa: "registro",
    stdin: JSON.stringify(CRITERIOS),
    confere: (s) => {
      assert.deepEqual([s.ticket, s.tipo, s.produtor, s.dados], [1, "criterios_aceite", "agente", CRITERIOS]);
    },
    outra: { etapa: "desenho", erro: /^criterios_aceite não é evidência da etapa desenho / },
  },
  {
    args: ["evidencia", "schema", "criterios_aceite"],
    etapa: "encerramento",
    confere: (s) => {
      assert.equal((s.dados as { type: string }).type, "object");
      assert.deepEqual(s.arquivos, { classes: ["video", "imagem", "html", "texto"], min: 0, max: 0 });
    },
  },
  {
    args: ["evidencia", "ver", "T-1", "comportamento"],
    etapa: "registro",
    preparar: submeterComportamento,
    confere: (s) => {
      assert.deepEqual(s.dados, COMPORTAMENTO);
      const [arquivo] = s.arquivos as { nome: string; caminho: string }[];
      assert.ok(arquivo && isAbsolute(arquivo.caminho));
      assert.equal(arquivo.nome, "tela.webm");
      assert.deepEqual(readFileSync(arquivo.caminho), WEBM);
    },
  },
];

for (const linha of TABELA) {
  const nome = linha.args.slice(0, 2).join(" ") + (linha.args[1] === "dep" ? ` ${String(linha.args[2])}` : "");

  test(`${nome}: o agente da etapa ${linha.etapa} recebe uma linha de JSON`, async () => {
    const c = cenario(linha.etapa);
    if (linha.preparar) assert.equal(((await linha.preparar(c)) as Saida).codigo, 0);
    linha.confere(json(await cli(c.env, linha.args, linha.stdin)), c);
    c.banco.close();
  });

  const { outra } = linha;
  if (outra) {
    test(`${nome}: o agente da etapa ${outra.etapa} recebe o erro do F1`, async () => {
      const c = cenario(outra.etapa);
      falha(await cli(c.env, outra.args ?? linha.args, linha.stdin), outra.erro);
      c.banco.close();
    });
  }

  test(`${nome}: o agente de execução terminada recebe ErroDeEscopo`, async () => {
    const c = cenario(linha.etapa);
    if (linha.preparar) await linha.preparar(c);
    c.terminar();
    falha(await cli(c.env, linha.args, linha.stdin), "a execução E-1 já terminou (peça ao Auditor uma nova execução)");
    c.banco.close();
  });
}

test("FABRIQUINHA_EXECUCAO de uma execução que não existe é ErroDeEscopo", async () => {
  const c = cenario("registro");
  falha(
    await cli({ ...c.env, FABRIQUINHA_EXECUCAO: "E-1" }, ["projeto", "ver"]),
    "a execução E-1 não existe (confira FABRIQUINHA_EXECUCAO)",
  );
  c.banco.close();
});

test("sem a variável, todo comando além de servidor, abrir e --help sai com ErroDeEscopo", async () => {
  const c = cenario("registro");
  const env = { FABRIQUINHA_ROOT: c.raiz };
  for (const { args, stdin } of TABELA) {
    falha(await cli(env, args, stdin), "este comando é do agente (o Auditor usa o web)");
  }
  assert.equal(c.banco.prepare("SELECT count(*) AS n FROM evidencia").get()?.n, 0);
  const ajuda = await cli(env, ["--help"]);
  assert.equal(ajuda.codigo, 0);
  assert.match(ajuda.out, /^ {2}fabriquinha servidor$/m);
  assert.match(ajuda.out, /^ {2}fabriquinha evidencia ver T-<n> <tipo>$/m);
  c.banco.close();
});

test("--help de um grupo imprime só a ajuda dele no stdout", async () => {
  const s = await cli({}, ["ticket", "criar", "-h"]);
  assert.deepEqual([s.codigo, s.err], [0, ""]);
  assert.match(s.out, /^ {2}fabriquinha ticket criar I-<n> --titulo <t> \[--descricao <arquivo\|->\]$/m);
  assert.doesNotMatch(s.out, /fabriquinha issue/);
});

test("uso inválido sai com 2 e imprime a ajuda do grupo", async () => {
  const c = cenario("revisao");
  usoInvalido(await cli(c.env, ["issue", "editar", "I-1", "--nome", "x"]), /^Unknown option '--nome'/, "issue");
  usoInvalido(await cli(c.env, ["issue", "editar", "I-1", "--titulo"]), /argument missing$/, "issue");
  usoInvalido(await cli(c.env, ["issue", "dep", "add", "I-1"]), "falta I-<m>", "issue");
  usoInvalido(await cli(c.env, ["ticket", "ver", "T-1", "T-2"]), "argumento a mais: T-2", "ticket");
  usoInvalido(await cli(c.env, ["issue", "ver", "T-1"]), "T-1 não é um I-<n>: use I-<n> ou só o número", "issue");
  usoInvalido(await cli(c.env, ["ticket", "ver", "T-0"]), "T-0 não é um T-<n>: use T-<n> ou só o número", "ticket");
  usoInvalido(await cli(c.env, ["ticket", "criar", "I-1"]), "falta --titulo <t>", "ticket");
  usoInvalido(await cli(c.env, ["issue", "apagar", "I-1"]), "comando desconhecido: issue apagar I-1", "issue");
  usoInvalido(
    await cli(c.env, ["revisao", "decidir", "T-1", "talvez"]),
    "talvez não é aprovar nem reprovar",
    "revisao",
  );
  usoInvalido(
    await cli(c.env, ["evidencia", "schema", "foto"]),
    /^foto não é um tipo de evidência; os tipos são: /,
    "evidencia",
  );
  // Sem grupo conhecido, a ajuda inteira.
  for (const args of [[], ["tick"]]) {
    const s = await cli(c.env, args);
    assert.equal(s.codigo, 2);
    assert.match(s.err, args.length === 0 ? /^falta o comando\n/ : /^comando desconhecido: tick\n/);
    assert.match(s.err, /^ {2}fabriquinha servidor$/m);
    assert.match(s.err, /^ {2}fabriquinha revisao decidir /m);
  }
  c.banco.close();
});

test("erros do F1, de schema e de entrada saem em uma linha com código 1", async () => {
  const c = cenario("registro");
  falha(await cli(c.env, ["issue", "ver", "I-9"]), "a issue I-9 não existe (confira o número da issue)");
  falha(await cli(c.env, ["ticket", "ver", "T-9"]), "o ticket T-9 não existe (confira o número do ticket)");
  falha(await cli(c.env, ["ticket", "remover", "T-9"]), "o ticket T-9 não existe (confira o número do ticket)");
  falha(
    await cli(c.env, ["evidencia", "ver", "T-9", "comportamento"]),
    "T-9 não tem evidência comportamento (confira o ticket e o tipo)",
  );
  falha(
    await cli(c.env, ["evidencia", "ver", "T-1", "comportamento"]),
    "T-1 não tem evidência comportamento (confira o ticket e o tipo)",
  );
  // ZodError do F1 e do F3, com o caminho do campo, numa linha só.
  falha(await cli(c.env, ["issue", "editar", "I-1", "--tipo", "melhoria"]), /→ at tipo\n$/);
  falha(
    await cli(c.env, ["evidencia", "add", "criterios_aceite", "--dados", "-"], '{"criterios": [{"id": "CA-1"}]}'),
    /→ at dados\.criterios\[0\]\.dado .*→ at dados\.criterios\[0\]\.entao\n$/,
  );
  falha(
    await cli(c.env, ["evidencia", "add", "criterios_aceite", "--dados", "-"], "{"),
    /^- não é um JSON válido: .* \(corrija o arquivo de dados\)\n$/,
  );
  falha(
    await cli(c.env, ["issue", "editar", "I-1", "--descricao", join(c.raiz, "nao-existe.md")]),
    /^ENOENT: no such file or directory/,
  );
  // Sem --dados, `dados` vai vazio e o schema do tipo diz o que falta.
  falha(await cli(c.env, ["evidencia", "add", "criterios_aceite"]), /→ at dados\.criterios\n$/);
  // Com arquivo e dados de arquivo: a evidência guardada.
  const s = json(await submeterComportamento(c));
  assert.equal((s.arquivos as unknown[]).length, 1);
  c.banco.close();
});

/** Uma porta livre em 127.0.0.1, para o serviço de teste não disputar a 4317 de outro serviço. */
async function portaLivre(): Promise<number> {
  const s = createServer().listen(0, "127.0.0.1");
  await new Promise((pronto) => s.once("listening", pronto));
  const { port } = s.address() as { port: number };
  await new Promise((fechou) => s.close(fechou));
  return port;
}

test("servidor sobe o serviço na raiz e para na parada; não sobe uma segunda instância; é recusado ao agente", async () => {
  const raiz = mkdtempSync(join(base, "servidor-"));
  process.env.FABRIQUINHA_PORTA = String(await portaLivre());
  const s = await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]);
  assert.deepEqual(s, { codigo: 0, out: `{"porta":${process.env.FABRIQUINHA_PORTA}}\n`, err: "" });
  assert.ok(existsSync(join(raiz, "fabriquinha.db")));

  const ocupada = createServer().listen(Number(process.env.FABRIQUINHA_PORTA), "127.0.0.1");
  await new Promise((pronto) => ocupada.once("listening", pronto));
  falha(await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]), /^a Fabriquinha não conseguiu abrir 127\.0\.0\.1:/);
  await new Promise((fechou) => ocupada.close(fechou));

  falha(
    await cli({ FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "1" }, ["servidor"]),
    "servidor não é comando do agente (o serviço já está rodando; siga com o seu ticket)",
  );
});

test("abrir lê web.url e abre o navegador; sem o arquivo, diz que o serviço não está rodando", async () => {
  const raiz = mkdtempSync(join(base, "abrir-"));
  const bin = mkdtempSync(join(base, "bin-"));
  const aberto = join(bin, "aberto");
  const navegador = join(bin, comandoDoNavegador(process.platform));
  writeFileSync(navegador, `#!/bin/sh\nprintf '%s' "$1" > ${aberto}\n`);
  chmodSync(navegador, 0o755);
  const env = { FABRIQUINHA_ROOT: raiz, PATH: bin };

  falha(
    await cli(env, ["abrir"]),
    `o serviço não está rodando: falta ${join(raiz, "web.url")} (suba-o com fabriquinha servidor)`,
  );

  const url = "http://127.0.0.1:4317/entrar?token=abc";
  writeFileSync(join(raiz, "web.url"), `${url}\n`);
  assert.deepEqual(json(await cli(env, ["abrir"])), { url });
  while (!existsSync(aberto)) await dormir(10);
  await dormir(10);
  assert.equal(readFileSync(aberto, "utf8"), url);

  falha(
    await cli({ ...env, PATH: raiz }, ["abrir"]),
    `a Fabriquinha não conseguiu abrir o navegador: spawn xdg-open ENOENT (abra ${url} no navegador)`,
  );
  falha(
    await cli({ ...env, FABRIQUINHA_EXECUCAO: "1" }, ["abrir"]),
    "abrir não é comando do agente (o serviço já está rodando; siga com o seu ticket)",
  );
});

test("o navegador é aberto com open no macOS e xdg-open nos demais", () => {
  assert.equal(comandoDoNavegador("darwin"), "open");
  assert.equal(comandoDoNavegador("linux"), "xdg-open");
});

test("o executável roda o CLI direto, sem aviso no stderr, com os códigos de saída", () => {
  const bin = join(import.meta.dirname, "fabriquinha.ts");
  const rodar = (args: string[], env: NodeJS.ProcessEnv) => {
    const { status, stdout, stderr } = spawnSync(bin, args, {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
    });
    return { status, stdout, stderr };
  };
  const ajuda = rodar(["--help"], {});
  assert.deepEqual([ajuda.status, ajuda.stderr], [0, ""]);
  assert.match(ajuda.stdout, /^ {2}fabriquinha abrir$/m);
  assert.deepEqual(rodar(["projeto", "ver"], { FABRIQUINHA_ROOT: base, FABRIQUINHA_EXECUCAO: "7" }), {
    status: 1,
    stdout: "",
    stderr: "a execução 7 não existe (confira FABRIQUINHA_EXECUCAO)\n",
  });
  assert.equal(rodar([], {}).status, 2);
});

test("o executável sobe o servidor e para com SIGTERM, fechando o serviço", async () => {
  const raiz = mkdtempSync(join(base, "executavel-"));
  const porta = await portaLivre();
  const { FABRIQUINHA_EXECUCAO: _, ...env } = process.env;
  const servidor = spawn(join(import.meta.dirname, "fabriquinha.ts"), ["servidor"], {
    env: { ...env, FABRIQUINHA_ROOT: raiz, FABRIQUINHA_PORTA: String(porta) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [linha] = (await once(servidor.stdout, "data")) as [Buffer];
  assert.equal(linha.toString(), `{"porta":${String(porta)}}\n`);
  servidor.kill("SIGTERM");
  assert.deepEqual(await once(servidor, "exit"), [0, null]);
  assert.ok(existsSync(join(raiz, "fabriquinha.db")));
});
