// Auditoria do Histórico: o histórico do mês em arquivos (mês, projetos e números de qualidade), contra banco real.
process.env.TZ = "America/Sao_Paulo"; // o mês é o do fuso do serviço; o teste não pode depender do da máquina

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { CANCELADA } from "../dominio/agregado.ts";
import { ErroDeInexistente, ErroDeRegra, ErroExterno } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import {
  abortarAuditoria,
  abrirAuditoria,
  enviarNaAuditoria,
  estadoDaAuditoria,
  iniciarAuditoria,
  prepararAuditoria,
  recuperarAuditorias,
  sessoesDoMes,
} from "./auditoria.ts";
import { encerrar, situacao } from "./gerente.ts";
import type { EventoPi } from "./pi.ts";

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-auditoria-")));
after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const S1 = "11111111-1111-4111-8111-111111111111"; // loja, setembro
const S2 = "22222222-2222-4222-8222-222222222222"; // loja, outubro
const S3 = "33333333-3333-4333-8333-333333333333"; // site, setembro
const SHA = "a".repeat(40);

/**
 * I-1 da loja: T-1 de desenho concluído em setembro (S1) e T-2 de desenvolvimento concluído em outubro (S2), que
 * mexeu em linhas do T-1; um humano também (3 linhas). I-2 do site, sem título e cancelada: T-3 de registro, cuja sessão (S3) terminou em setembro.
 * O Auditor devolveu o registro da I-1 uma vez.
 */
const banco = abrir(raiz);
banco.exec(`
  INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness) VALUES
    ('loja', '/r/loja', 'main', 'github', '["t"]', 'loja', '[{"nome":"f","comando":"c","descricao":"d"}]'),
    ('site', '/r/site', 'main', 'github', '["t"]', 'site', '[{"nome":"f","comando":"c","descricao":"d"}]');
  INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, cancelada_em) VALUES
    (1, 'loja', 'Timeout | checkout', 'problema', 'desenvolvimento', '2026-09-01T12:00:00.000Z', NULL),
    (2, 'site', NULL, NULL, 'registro', '2026-09-01T12:00:00.000Z', '2026-09-20T12:00:00.000Z');
  INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
    (1, 1, 'desenho', 'Desenhar', 'concluido', 'fabriquinha', '2026-09-01T12:00:00.000Z', '2026-09-10T12:00:00.000Z'),
    (2, 1, 'desenvolvimento', 'Buscar', 'concluido', 'fabriquinha', '2026-09-01T12:00:00.000Z', '2026-10-05T12:00:00.000Z'),
    (3, 2, 'registro', 'Registrar', 'concluido', 'fabriquinha', '2026-09-01T12:00:00.000Z', '2026-09-20T12:00:00.000Z');
  INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em) VALUES
    (1, 1, 'autonomo', '${S1}', 'sucesso', NULL, '2026-09-10T11:00:00.000Z', '2026-09-10T12:00:00.000Z'),
    (2, 2, 'autonomo', '${S2}', 'sucesso', NULL, '2026-10-05T11:00:00.000Z', '2026-10-05T12:00:00.000Z'),
    (3, 3, 'autonomo', '${S3}', 'falha', '${CANCELADA}', '2026-09-20T11:00:00.000Z', '2026-09-20T12:00:00.000Z');
  INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo) VALUES
    (1, 'anthropic', 'claude-opus-5-5', 2, 1, 1, 0, 0, 0.5),
    (3, 'anthropic', 'claude-opus-5-5', 1, 1, 1, 0, 0, 0.25);
  INSERT INTO decisao (issue, ticket, gate, aprovado, motivo, por, em)
    VALUES (1, 1, 'registro', 0, 'faltou', 'auditor', '2026-09-02T12:00:00.000Z');`);
gravarCommit(banco, 1, { sha: "c".repeat(40), mensagem: "m", em: "2026-09-10T12:00:00.000Z", arquivos: [] });
gravarCommit(banco, 2, { sha: SHA, mensagem: "m", em: "2026-10-05T12:00:00.000Z", arquivos: [] });
banco.exec(`INSERT INTO retrabalho (commit_alterador, ticket, autor, ticket_origem, linhas) VALUES
  ('${SHA}', 2, NULL, 1, 4),
  ('${"b".repeat(40)}', NULL, 'Ana <ana@exemplo.com>', 1, 3);`);

test("sessoesDoMes: só as terminadas no mês, de todos os projetos", async () => {
  const setembro = await sessoesDoMes(banco, "2026-09");
  assert.deepEqual(
    setembro.map((s) => [s.sessao, s.projeto]),
    [
      [S1, "loja"],
      [S3, "site"],
    ],
  );
  assert.deepEqual(
    (await sessoesDoMes(banco, "2026-10")).map((s) => s.sessao),
    [S2],
  );
  assert.deepEqual(await sessoesDoMes(banco, "2026-08"), []);
});

test("prepararAuditoria: auditoria.json, um arquivo por sessão e o índice com custos e os números de qualidade", async () => {
  const dir = join(raiz, "auditoria");
  prepararAuditoria(banco, dir, "2026-09", await sessoesDoMes(banco, "2026-09"));

  assert.deepEqual(JSON.parse(readFileSync(join(dir, "auditoria.json"), "utf8")), {
    mes: "2026-09",
    sessoes: 2,
    projetos: { loja: 1, site: 1 },
  });
  assert.deepEqual(readdirSync(join(dir, "sessoes")), ["historico-T-1.md", "historico-T-3.md"]);

  const indice = readFileSync(join(dir, "indice.md"), "utf8");
  assert.match(indice, /^# Auditoria de setembro de 2026\n/);
  assert.match(indice, /- Sessões: 2\n- Projetos: loja \(1\), site \(1\)\n/);
  assert.match(
    indice,
    /\| 2026-09-10T12:00:00.000Z \| loja \| I-1 \| Timeout \\\| checkout \| T-1 \| desenho \| autonomo \| concluida \| US\$ 0.50 \| sessoes\/historico-T-1.md \|/,
  );
  assert.match(indice, /\| site \| I-2 \| \(sem título\) \| T-3 \| registro \| autonomo \| cancelada \|/);
  assert.match(indice, /## Custos do mês\n\nTotal: US\$ 0.75 em 3 chamadas\./);
  assert.match(indice, /\| anthropic\/claude-opus-5-5 \| 3 \| US\$ 0.75 \|/);
  assert.match(indice, /\| desenho \| 1 \| 0 \| 0 \| 3600 s \| US\$ 0.50 \|/);
  // Retrabalho (4 do T-2 e 3 de uma pessoa, depois do T-1), uma devolução do registro, nada nas demais colunas; a I-2 zerada.
  assert.match(
    indice,
    /\| I-1 \| 7 \| 3 \| 1 \| 0 \| 0 \| 0 \|\n\| I-2 \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|\n\| Total \| 7 \| 3 \| 1 \| 0 \| 0 \| 0 \|/,
  );
});

test("prepararAuditoria: mês sem sessão grava só os cabeçalhos", () => {
  const dir = join(raiz, "vazia");
  prepararAuditoria(banco, dir, "2026-08", []);
  assert.deepEqual(readdirSync(join(dir, "sessoes")), []);
  assert.match(
    readFileSync(join(dir, "indice.md"), "utf8"),
    /- Sessões: 0\n- Projetos: \n[\s\S]*\| Total \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|\n$/,
  );
});

// ---------------------------------------------------------------------------------------------------------------
// O agente: iniciar, conversar, retomar e falhar sem sobras, com um pi falso que fala o protocolo RPC.

/**
 * pi falso. Anota em $FALSO_PI_REGISTRO o início (argumentos, pasta, ambiente) e cada comando; grava a conversa no JSONL
 * da sessão e responde conforme $FALSO_PI:
 * - conversa: responde ao prompt e assenta;
 * - espera: fica trabalhando; `abort` o faz parar com stopReason aborted;
 * - morre: cria o JSONL da sessão, escreve a causa no stderr e sai com código 3 antes de qualquer evento.
 */
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const anotar = (o) => appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify(o) + "\\n");
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const env = process.env;
anotar({
  evento: "inicio", argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid,
  env: { auditoria: env.FABRIQUINHA_AUDITORIA, execucao: env.FABRIQUINHA_EXECUCAO, raiz: env.FABRIQUINHA_ROOT },
});
const dir = arg("--session-dir");
const id = arg("--session-id");
mkdirSync(dir, { recursive: true });
const existente = readdirSync(dir).find((nome) => nome.endsWith("_" + id + ".jsonl"));
const sessao = join(dir, existente ?? "2026-10-11T10-00-00-000Z_" + id + ".jsonl");
if (!existente) appendFileSync(sessao, JSON.stringify({ type: "session", version: 3, id }) + "\\n");
if (env.FALSO_PI === "morre") {
  process.stderr.write("erro: nenhum modelo configurado\\n");
  process.exit(3);
}
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
// Variante assenta: trabalha sem responder e, ao receber o SIGTERM do fim, ainda assenta antes de sair.
if (env.FALSO_PI === "assenta") process.on("SIGTERM", () => { emitir({ type: "agent_settled" }); setTimeout(() => process.exit(0), 50); });
const guardar = (message) =>
  appendFileSync(sessao, JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
const responder = (texto, stopReason = "stop") => {
  const message = { role: "assistant", content: [{ type: "text", text: texto }], stopReason };
  emitir({ type: "message_end", message });
  guardar(message);
  emitir({ type: "agent_settled" });
};
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    anotar({ evento: "comando", comando: c });
    if (c.type === "prompt") {
      emitir({ type: "response", command: "prompt", success: true });
      emitir({ type: "agent_start" });
      const usuario = { role: "user", content: c.message, timestamp: Date.now() };
      emitir({ type: "message_end", message: usuario });
      guardar(usuario);
      if (env.FALSO_PI !== "espera" && env.FALSO_PI !== "assenta") responder("## Oportunidades de melhoria\\n(scout)");
    }
    if (c.type === "abort") {
      emitir({ type: "response", command: "abort", success: true });
      responder("", "aborted");
    }
  }
});
`;
const pi = join(raiz, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;
process.env.FALSO_PI_REGISTRO = join(raiz, "registro.jsonl");

/** Uma linha do registro do pi falso. */
interface Registro {
  evento: "inicio" | "comando";
  argv: string[];
  cwd: string;
  pid: number;
  env: { auditoria?: string; execucao?: string; raiz: string };
  comando: { type: string; message?: string };
}
interface Rodada {
  registro(): Registro[];
}

/** Uma nova rodada do pi falso: o registro zerado e a variante. */
function pifalso(variante: "conversa" | "espera" | "morre" | "assenta"): Rodada {
  rmSync(process.env.FALSO_PI_REGISTRO ?? "", { force: true });
  process.env.FALSO_PI = variante;
  return {
    registro: () =>
      existsSync(process.env.FALSO_PI_REGISTRO ?? "")
        ? readFileSync(process.env.FALSO_PI_REGISTRO ?? "", "utf8")
            // O pi falso pode estar escrevendo a última linha agora: só conta a que já terminou em \n.
            .split("\n")
            .slice(0, -1)
            .map((l) => JSON.parse(l) as Registro)
        : [],
  };
}

/** Espera `condicao` ficar verdadeira, até 10 s. */
async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

/** Para o pi da auditoria, se vivo, e espera o fim da tarefa. */
async function parar(sessao: string): Promise<void> {
  if (situacao(sessao)) encerrar(sessao);
  await ate(() => estadoDaAuditoria(sessao) === "conversa" && !situacao(sessao), "a parada do pi");
}

const comandos = (r: Rodada) => r.registro().filter((x) => x.evento === "comando");
const inicios = (r: Rodada) => r.registro().filter((x) => x.evento === "inicio");
const auditorias = () => (existsSync(join(raiz, "auditorias")) ? readdirSync(join(raiz, "auditorias")) : []);
const arquivosDeSessao = () => (existsSync(join(raiz, "sessoes")) ? readdirSync(join(raiz, "sessoes")) : []);
const rejeitaCom = (mensagem: string) => (e: unknown) => e instanceof ErroDeRegra && e.message === mensagem;

test("iniciarAuditoria: sobe o pi só de leitura na pasta, com o prompt.md, e a conversa marca o prompt (CA-5, CA-7)", async () => {
  const f = pifalso("conversa");
  const sessao = await iniciarAuditoria(banco, "2026-09", await sessoesDoMes(banco, "2026-09"), { ociosidadeMin: 60 });
  const dir = join(raiz, "auditorias", sessao);
  assert.deepEqual(readdirSync(dir).toSorted(), [
    "auditoria.json",
    "indice.md",
    "log",
    "pgid",
    "prompt.md",
    "sessoes",
    "vazio",
  ]);
  const prompt = readFileSync(join(dir, "prompt.md"), "utf8");
  assert.match(prompt, /^# Auditoria de setembro de 2026 \(2026-09\)\n/);
  for (const trecho of [
    join(dir, "indice.md"),
    `${join(dir, "sessoes")}/`,
    "`subagent`",
    "`scout`",
    "## Oportunidades de melhoria",
    "## Custos",
    "## Qualidade",
    "## Melhorias propostas",
    "seção **Qualidade**",
    "só proponha",
  ]) {
    assert.ok(prompt.includes(trecho), trecho);
  }

  const inicio = inicios(f)[0];
  assert.ok(inicio);
  assert.equal(inicio.cwd, dir);
  assert.deepEqual(inicio.env, { auditoria: "1", raiz });
  assert.deepEqual(inicio.argv.slice(-2), ["--exclude-tools", "edit,write,bash,powershell"]);
  assert.equal(inicio.argv[inicio.argv.indexOf("--session-id") + 1], sessao);
  assert.equal(readFileSync(join(dir, "pgid"), "utf8"), String(inicio.pid));
  assert.deepEqual(comandos(f)[0]?.comando, { type: "prompt", message: prompt });

  await ate(() => estadoDaAuditoria(sessao) === "conversa", "a resposta do agente");
  const auditoria = abrirAuditoria(banco, sessao);
  assert.deepEqual(
    [auditoria.mes, auditoria.rotulo, auditoria.sessoes, auditoria.projetos, auditoria.estado],
    ["2026-09", "setembro de 2026", 2, { loja: 1, site: 1 }, "conversa"],
  );
  const conversa = auditoria.conversa as { fabriquinha?: boolean; message?: { role: string } }[];
  assert.deepEqual(
    conversa.map((e) => [e.message?.role, e.fabriquinha]),
    [
      [undefined, undefined],
      ["user", true],
      ["assistant", undefined],
    ],
  );
  await parar(sessao);
});

test("o modelo da Auditoria: a 1ª linha do log e os argumentos do pi o levam, no início e na retomada; sem modelo, sem flags (CA-3, CA-4)", async () => {
  const f = pifalso("conversa");
  const modelo = { provedor: "llamacpp", modelo: "qwen3-coder-30b" };
  const lista = await sessoesDoMes(banco, "2026-09");
  const com = await iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 0.003, modelo });
  const primeira = (sessao: string) => readFileSync(join(raiz, "auditorias", sessao, "log"), "utf8").split("\n")[0];
  assert.match(primeira(com) ?? "", /^\S+ pi .* --session-id \S+ --provider llamacpp --model qwen3-coder-30b -e /);
  await ate(() => !situacao(com) && estadoDaAuditoria(com) === "conversa", "a parada por ociosidade");

  enviarNaAuditoria(banco, com, "continue", { ociosidadeMin: 60, modelo });
  await ate(() => comandos(f).length === 2, "o prompt da retomada");
  assert.deepEqual(
    inicios(f).map((i) => i.argv.slice(i.argv.indexOf("--provider"), i.argv.indexOf("--provider") + 4)),
    [
      ["--provider", "llamacpp", "--model", "qwen3-coder-30b"],
      ["--provider", "llamacpp", "--model", "qwen3-coder-30b"],
    ],
  );
  await parar(com);

  const sem = await iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 60, modelo: null });
  assert.doesNotMatch(primeira(sem) ?? "", /--provider|--model/);
  await parar(sem);
});

test("iniciarAuditoria com pedido: prompt.md com o pedido entre os caminhos e o texto fixo; auditoria.json e abrirAuditoria o trazem; sem pedido, nada muda (CA-6, CA-7, CA-8)", async () => {
  pifalso("conversa");
  const lista = await sessoesDoMes(banco, "2026-09");
  const pedido = "Verifique se os agentes repetem perguntas que o prompt já responde";
  const com = await iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 60 }, pedido);
  const dir = join(raiz, "auditorias", com);
  const fixo = readFileSync(new URL("auditoria.md", import.meta.url), "utf8");
  assert.equal(
    readFileSync(join(dir, "prompt.md"), "utf8"),
    [
      "# Auditoria de setembro de 2026 (2026-09)",
      "",
      `Pasta da auditoria, o seu diretório de trabalho: ${dir}`,
      `- Índice: ${join(dir, "indice.md")}`,
      `- Sessões: ${join(dir, "sessoes")}/`,
      "",
      "## Pedido do Auditor",
      "",
      pedido,
      "",
      "O pedido é o foco da auditoria: oriente por ele as tarefas dos subagentes e cada seção da resposta.",
      "",
      fixo,
    ].join("\n"),
  );
  assert.equal((JSON.parse(readFileSync(join(dir, "auditoria.json"), "utf8")) as { pedido?: string }).pedido, pedido);
  assert.equal(abrirAuditoria(banco, com).pedido, pedido);
  await ate(() => estadoDaAuditoria(com) === "conversa", "a resposta do agente");
  await parar(com);

  const sem = await iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 60 });
  await ate(() => estadoDaAuditoria(sem) === "conversa", "a resposta do agente");
  const dirSem = join(raiz, "auditorias", sem);
  assert.ok(!readFileSync(join(dirSem, "prompt.md"), "utf8").includes("Pedido do Auditor"));
  assert.ok(!("pedido" in JSON.parse(readFileSync(join(dirSem, "auditoria.json"), "utf8"))));
  assert.equal(abrirAuditoria(banco, sem).pedido, undefined);
  await parar(sem);
});

test("enviarNaAuditoria: com o pi vivo e ocioso, prompt; depois da ociosidade, retoma a mesma sessão e pasta (CA-8)", async () => {
  const f = pifalso("conversa");
  const sessao = await iniciarAuditoria(banco, "2026-09", await sessoesDoMes(banco, "2026-09"), {
    ociosidadeMin: 0.003,
  });
  const dir = join(raiz, "auditorias", sessao);
  await ate(() => !situacao(sessao) && !existsSync(join(dir, "pgid")), "a parada por ociosidade");
  await ate(() => estadoDaAuditoria(sessao) === "conversa", "o fim da tarefa");
  const jsonl = arquivosDeSessao().filter((n) => n.endsWith(`_${sessao}.jsonl`));
  assert.equal(jsonl.length, 1);

  enviarNaAuditoria(banco, sessao, "e a primeira melhoria?", { ociosidadeMin: 60 });
  await ate(() => comandos(f).length === 2, "o prompt da retomada");
  await ate(() => estadoDaAuditoria(sessao) === "conversa", "a resposta da retomada");
  assert.deepEqual(
    inicios(f).map((i) => [i.cwd, i.argv[i.argv.indexOf("--session-id") + 1]]),
    [
      [dir, sessao],
      [dir, sessao],
    ],
  );
  assert.deepEqual(comandos(f)[1]?.comando, { type: "prompt", message: "e a primeira melhoria?" });
  assert.deepEqual(
    arquivosDeSessao().filter((n) => n.endsWith(`_${sessao}.jsonl`)),
    jsonl,
    "a mesma conversa, no mesmo arquivo",
  );
  const conversa = abrirAuditoria(banco, sessao).conversa as { fabriquinha?: boolean; message?: { role: string } }[];
  assert.deepEqual(
    conversa.filter((e) => e.message?.role === "user").map((e) => e.fabriquinha),
    [true, undefined],
  );

  // O pi da retomada continua vivo e ocioso: a pergunta seguinte vai a ele, sem pi novo.
  enviarNaAuditoria(banco, sessao, "e a segunda?", { ociosidadeMin: 60 });
  await ate(() => comandos(f).length === 3, "o prompt ao pi vivo");
  assert.equal(inicios(f).length, 2);
  await ate(() => estadoDaAuditoria(sessao) === "conversa", "a segunda resposta");

  // Parando, o pi ainda não pode receber: a segunda subida espera a primeira terminar.
  encerrar(sessao);
  assert.throws(() => {
    enviarNaAuditoria(banco, sessao, "já?", { ociosidadeMin: 60 });
  }, rejeitaCom("o agente da auditoria ainda está parando (tente de novo em alguns segundos)"));
  await parar(sessao);
});

test("enviarNaAuditoria recusa com o agente trabalhando; abortarAuditoria o para; assinar avisa a mudança de estado", async () => {
  const f = pifalso("espera");
  const sessao = await iniciarAuditoria(banco, "2026-09", await sessoesDoMes(banco, "2026-09"), { ociosidadeMin: 60 });
  const eventos: EventoPi[] = [];
  const cancelar = abrirAuditoria(banco, sessao).assinar((e) => eventos.push(e));
  assert.equal(estadoDaAuditoria(sessao), "rodando");
  assert.throws(() => {
    enviarNaAuditoria(banco, sessao, "oi", { ociosidadeMin: 60 });
  }, rejeitaCom("o agente da auditoria está trabalhando (espere a resposta, ou use Abortar)"));

  abortarAuditoria(sessao);
  await ate(() => estadoDaAuditoria(sessao) === "conversa", "o fim do aborto");
  cancelar();
  assert.deepEqual(
    comandos(f).map((c) => c.comando.type),
    ["prompt", "abort"],
  );
  assert.ok(eventos.some((e) => e.type === "estado" && e.estado === "conversa"));
  assert.ok(
    eventos.some((e) => e.type === "message_end" && e.fabriquinha === true),
    "o prompt, marcado",
  );
  const conversa = abrirAuditoria(banco, sessao).conversa as { message?: { stopReason?: string } }[];
  assert.equal(conversa.at(-1)?.message?.stopReason, "aborted");
  await parar(sessao);
});

test("parar a auditoria com o agente trabalhando: o assentar que chega depois do fim não arma relógio de ociosidade", async () => {
  pifalso("assenta");
  const sessao = await iniciarAuditoria(banco, "2026-09", await sessoesDoMes(banco, "2026-09"), { ociosidadeMin: 60 });
  const relogios = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const antes = relogios();
  await parar(sessao);
  await dormir(200);
  assert.ok(relogios() <= antes, "um relógio de 60 min ficou armado e seguraria o processo");
});

test("iniciarAuditoria: se o pi não sobe, lança ErroExterno e não deixa pasta nem JSONL (CA-10)", async () => {
  const pastas = auditorias();
  const sessoesAntes = arquivosDeSessao();
  const erro = (e: unknown) =>
    e instanceof ErroExterno &&
    /^o agente da auditoria não subiu: o pi saiu antes de terminar a execução \(código .*\)/.test(e.message) &&
    !e.message.includes("auditorias/");
  const lista = await sessoesDoMes(banco, "2026-09");

  process.env.FABRIQUINHA_PI = join(raiz, "nao-existe");
  await assert.rejects(iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 60 }), erro);
  process.env.FABRIQUINHA_PI = pi;
  assert.deepEqual([auditorias(), arquivosDeSessao()], [pastas, sessoesAntes], "pi inexistente");

  // Um pi que grava a sessão e morre: o JSONL também sai.
  const f = pifalso("morre");
  await assert.rejects(iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 60 }), erro);
  assert.equal(inicios(f).length, 1);
  assert.deepEqual([auditorias(), arquivosDeSessao()], [pastas, sessoesAntes], "pi que morre");
  await assert.rejects(
    iniciarAuditoria(banco, "2026-09", lista, { ociosidadeMin: 60 }),
    (e: unknown) => e instanceof ErroExterno && e.message.includes("erro: nenhum modelo configurado"),
    "a causa do stderr vai na mensagem",
  );
});

test("iniciarAuditoria: a preparação que falha também não deixa pasta", async () => {
  const pastas = auditorias();
  const [s] = await sessoesDoMes(banco, "2026-09");
  assert.ok(s);
  await assert.rejects(iniciarAuditoria(banco, "2026-09", [{ ...s, issue: 99 }], { ociosidadeMin: 60 }), ErroDeRegra);
  assert.deepEqual(auditorias(), pastas);
});

test("abrirAuditoria e enviarNaAuditoria: a auditoria que não existe é ErroDeInexistente", () => {
  const sessao = "99999999-9999-4999-8999-999999999999";
  assert.throws(() => {
    abrirAuditoria(banco, sessao);
  }, ErroDeInexistente);
  assert.throws(() => {
    enviarNaAuditoria(banco, sessao, "oi", { ociosidadeMin: 60 });
  }, ErroDeInexistente);
});

test("recuperarAuditorias: mata o grupo de cada pgid, apaga o arquivo e ignora o que não tem pgid", async () => {
  const outra = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-auditorias-")));
  try {
    recuperarAuditorias(outra); // nem pasta de auditorias
    const sem = join(outra, "auditorias", "sem-pgid");
    const com = join(outra, "auditorias", "com-pgid");
    mkdirSync(sem, { recursive: true });
    mkdirSync(com, { recursive: true });
    const sleep = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    const saiu = once(sleep, "exit");
    writeFileSync(join(com, "pgid"), String(sleep.pid));
    recuperarAuditorias(outra);
    assert.deepEqual(await saiu, [null, "SIGKILL"]);
    assert.deepEqual([existsSync(join(com, "pgid")), existsSync(sem)], [false, true]);
  } finally {
    rmSync(outra, { recursive: true, force: true });
  }
});
