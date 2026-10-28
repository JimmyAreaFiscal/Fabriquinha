// Avaliação de melhoria do SDLC: escopo, recusas, achados, uso fora das métricas, encaminhamento, contra banco real e pi falso.
import assert from "node:assert/strict";
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
import { ErroDeInexistente, ErroDeRegra, ErroExterno } from "../dominio/erros.ts";
import { metricasDaDemanda } from "../metricas/demanda.ts";
import { abrir } from "../persistencia/banco.ts";
import { recuperarAuditorias } from "./auditoria.ts";
import {
  abortarAvaliacao,
  abrir as abrirAv,
  encaminharAchado,
  enviarNaAvaliacao,
  estadoDaAvaliacao,
  iniciarAvaliacao,
} from "./avaliacao.ts";
import { encerrar, situacao } from "./gerente.ts";

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-avaliacao-")));
after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const banco = abrir(raiz);
const T = "'2026-10-10T10:00:00.000Z'";
banco.exec(`
  INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key) VALUES
    ('loja', '/r/loja', 'main', 'github', 'loja'),
    ('site', '/r/site', 'main', 'github', 'site'),
    ('vazio', '/r/vazio', 'main', 'github', 'vazio');
`);
// I-10 e I-11 da loja com sessão em 10/10; I-12 da loja só em setembro; I-13 do site.
for (const [id, projeto, fim] of [
  ["I-10", "loja", "2026-10-10T10:30:00.000Z"],
  ["I-11", "loja", "2026-10-10T11:00:00.000Z"],
  ["I-12", "loja", "2026-09-01T11:00:00.000Z"],
  ["I-13", "site", "2026-10-10T11:00:00.000Z"],
] as const) {
  banco.exec(
    `INSERT INTO demanda VALUES ('${id}', '${projeto}', 'Título ${id}', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/${id}');
     INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', ${T});
     INSERT INTO sessao VALUES ('s-${id}', '${id}', 1, 'autonomo', 'c');
     INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('e-${id}', 's-${id}', ${T}, '${fim}', 0);`,
  );
}
mkdirSync(join(raiz, "sessoes"));
writeFileSync(
  join(raiz, "sessoes", "2026-10-10T10-00-00-000Z_s-I-10.jsonl"),
  [
    { type: "session", id: "s-I-10" },
    { type: "message", message: { role: "user", content: "faça" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "feito" }] } },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n") + "\n",
);

/**
 * pi falso: anota início e comandos; a cada prompt responde com uso (0,5 de custo) e, se $FALSO_PI é "conversa", grava
 * dois achados em achados.jsonl (só no primeiro prompt); "ruim" grava uma linha inválida; "espera" não responde;
 * "morre" sai com erro antes de qualquer evento.
 */
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const anotar = (o) => appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify(o) + "\\n");
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const env = process.env;
anotar({ evento: "inicio", argv: process.argv.slice(2), cwd: process.cwd() });
const dir = arg("--session-dir");
const id = arg("--session-id");
mkdirSync(dir, { recursive: true });
if (env.FALSO_PI === "morre-sem-sessao") {
  process.stderr.write("erro: nenhum modelo configurado\\n");
  process.exit(3);
}
const existente = readdirSync(dir).find((nome) => nome.endsWith("_" + id + ".jsonl"));
const sessao = join(dir, existente ?? "2026-10-11T10-00-00-000Z_" + id + ".jsonl");
if (!existente) appendFileSync(sessao, JSON.stringify({ type: "session", version: 3, id }) + "\\n");
if (env.FALSO_PI === "morre") {
  process.stderr.write("erro: nenhum modelo configurado\\n");
  process.exit(3);
}
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const guardar = (message) =>
  appendFileSync(sessao, JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
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
      guardar({ role: "user", content: c.message });
      emitir({ type: "message_end", message: { role: "user", content: c.message } });
      if (env.FALSO_PI === "espera") continue;
      const achados = join(process.cwd(), "achados.jsonl");
      if (env.FALSO_PI === "ruim") appendFileSync(achados, "{nao-json\\n");
      if (env.FALSO_PI === "conversa" && !existsSync(achados))
        for (const n of [1, 2]) appendFileSync(achados, JSON.stringify({ titulo: "Achado " + n, descricao: "desc " + n, evidencia: "ev " + n }) + "\\n");
      const message = { role: "assistant", provider: "p", model: "m", content: [{ type: "text", text: "ok" }], stopReason: "stop",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, ...(env.FALSO_PI === "semcusto" ? {} : { cost: { total: 0.5 } }) } };
      guardar(message);
      emitir({ type: "message_end", message });
      emitir({ type: "agent_end" });
      emitir({ type: "agent_settled" });
    }
    if (c.type === "abort") {
      emitir({ type: "response", command: "abort", success: true });
      emitir({ type: "agent_settled" });
    }
  }
});
`;
const pi = join(raiz, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;
process.env.FALSO_PI_REGISTRO = join(raiz, "registro.jsonl");

const opcoes = { ociosidadeMin: 5 };
const registro = () =>
  existsSync(process.env.FALSO_PI_REGISTRO ?? "")
    ? readFileSync(process.env.FALSO_PI_REGISTRO ?? "", "utf8")
        .split("\n")
        .slice(0, -1)
        .map(
          (l) =>
            JSON.parse(l) as {
              evento: string;
              argv: string[];
              cwd: string;
              comando?: { type: string; message: string };
            },
        )
    : [];
const pifalso = (variante: string) => {
  rmSync(process.env.FALSO_PI_REGISTRO ?? "", { force: true });
  process.env.FALSO_PI = variante;
};
async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}
async function parar(id: string): Promise<void> {
  if (situacao(id)) encerrar(id);
  await ate(() => estadoDaAvaliacao(id) === "concluida" && !situacao(id), "a parada do pi");
}
const recusa = (mensagem: RegExp) => (e: unknown) => e instanceof ErroDeRegra && mensagem.test(e.message);
const escopo = { projeto: "loja", de: "2026-10-01", ate: "2026-10-31" };

test("recusa o escopo sem demanda com sessão, citando período e projeto (CA-2), e a demanda de outro projeto ou sem sessão (CA-5)", async () => {
  pifalso("conversa");
  await assert.rejects(
    iniciarAvaliacao(banco, { ...escopo, projeto: "vazio" }, opcoes),
    recusa(/vazio.*2026-10-01.*2026-10-31/),
  );
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, demandas: ["I-13"] }, opcoes), recusa(/I-13.*site/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, demandas: ["I-12"] }, opcoes), recusa(/I-12.*loja/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, demandas: ["I-99"] }, opcoes), recusa(/I-99/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, de: "2026-11-01" }, opcoes), recusa(/inválido/));
  await assert.rejects(iniciarAvaliacao(banco, { ...escopo, ate: "31/10" }, opcoes), recusa(/inválido/));
  assert.equal(registro().length, 0);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM avaliacao").get()?.n, 0);
});

test("avalia: prepara a pasta, importa achados e uso, não mexe nas métricas, conversa e encaminha (CA-1, 3, 4, 7, 8, 9, 10, 13, 14, 15)", async () => {
  const antes = JSON.stringify(metricasDaDemanda(banco, "I-10"));
  pifalso("conversa");
  const id = await iniciarAvaliacao(banco, { ...escopo, demandas: ["I-10", "I-10"] }, opcoes);
  await ate(
    () => banco.prepare("SELECT count(*) AS n FROM achado_avaliacao").get()?.n === 2,
    "a importação dos achados",
  );
  const dir = join(raiz, "avaliacoes", id);
  assert.deepEqual(readdirSync(join(dir, "demandas")), ["I-10"]);
  assert.match(readFileSync(join(dir, "demandas", "I-10", "demanda.md"), "utf8"), /Título I-10/);
  assert.ok(existsSync(join(dir, "demandas", "I-10", "metricas.json")));
  const sessao = readFileSync(join(dir, "sessoes", "I-10-s-I-10.md"), "utf8");
  assert.match(sessao, /feito/);
  assert.match(readFileSync(join(dir, "indice.md"), "utf8"), /sessoes\/I-10-s-I-10\.md/);
  const [inicio] = registro();
  assert.equal(inicio?.cwd, dir);
  assert.ok(inicio.argv.includes("achado.ts") || inicio.argv.some((a) => a.endsWith("achado.ts")));
  assert.match(inicio.argv.join(" "), /--exclude-tools edit,write,bash,powershell/);

  await ate(() => banco.prepare("SELECT count(*) AS n FROM uso_avaliacao").get()?.n === 1, "o uso");
  const av = abrirAv(banco, id);
  assert.deepEqual(av.demandas, ["I-10"]);
  assert.equal(av.pedido, "");
  assert.equal(av.achados.length, 2);
  assert.equal(av.uso[0]?.custo, 0.5);
  assert.equal(JSON.stringify(metricasDaDemanda(banco, "I-10")), antes);

  await parar(id);
  assert.equal(abrirAv(banco, id).estado, "concluida");
  assert.ok(abrirAv(banco, id).conversa.length > 1);
  const marcadas = (abrirAv(banco, id).conversa as { fabriquinha?: boolean; message?: { role?: string } }[]).filter(
    (e) => e.fabriquinha,
  );
  assert.equal(marcadas.length, 1);
  assert.equal(marcadas[0]?.message?.role, "user");

  // pergunta: sobe um pi novo na mesma sessão e o uso é regravado pela soma
  const eventos: string[] = [];
  const cancelar = abrirAv(banco, id).assinar((e) =>
    eventos.push(
      e.type === "estado" ? `estado:${String(e.estado)}` : `${String(e.type)}${e.fabriquinha ? ":fabriquinha" : ""}`,
    ),
  );
  enviarNaAvaliacao(banco, id, "e o custo?", opcoes);
  await ate(() => registro().filter((r) => r.evento === "inicio").length === 2, "o segundo pi");
  await ate(() => banco.prepare("SELECT chamadas FROM uso_avaliacao").get()?.chamadas === 2, "o uso regravado");
  assert.equal(registro().find((r) => r.comando?.message === "e o custo?")?.comando?.type, "prompt");

  const demanda = encaminharAchado(banco, id, 1);
  assert.equal(demanda.demanda.fase, "registro");
  assert.equal(demanda.demanda.titulo, "Achado 1");
  assert.equal(demanda.demanda.projeto, "loja");
  assert.match(demanda.demanda.descricao, /desc 1[\s\S]*ev 1[\s\S]*achado 1/);
  assert.equal(demanda.demanda.origem_ferramenta, "avaliacao");
  assert.equal(demanda.demanda.origem_sessao, `${id}#1`);
  assert.equal(abrirAv(banco, id).achados[0]?.demanda_id, demanda.demanda.id);
  assert.throws(() => encaminharAchado(banco, id, 1), recusa(/já foi encaminhado/));
  assert.throws(() => encaminharAchado(banco, id, 9), recusa(/não existe/));
  assert.throws(() => encaminharAchado(banco, "nada", 1), ErroDeInexistente);
  // Com o pi vivo e ocioso, a pergunta vai a ele; parando, a próxima espera ele sair.
  await ate(() => estadoDaAvaliacao(id) === "concluida" && situacao(id) !== undefined, "o pi ocioso");
  enviarNaAvaliacao(banco, id, "e o prazo?", opcoes);
  await ate(() => registro().some((r) => r.comando?.message === "e o prazo?"), "a pergunta ao pi vivo");
  await ate(() => estadoDaAvaliacao(id) === "concluida", "a resposta");
  encerrar(id);
  assert.throws(
    () => {
      enviarNaAvaliacao(banco, id, "já?", opcoes);
    },
    recusa(/ainda está parando/),
  );
  await parar(id);
  cancelar();
  assert.ok(eventos.includes("agent_start"));
  assert.ok(eventos.includes("estado:concluida"));
  assert.ok(!eventos.includes("message_end:fabriquinha")); // a pergunta do Auditor não é o prompt

  // ao vivo, a mensagem igual ao prompt.md chega marcada
  const ao_vivo: string[] = [];
  const parar_ = abrirAv(banco, id).assinar((e) => ao_vivo.push(e.fabriquinha ? "marcada" : String(e.type)));
  enviarNaAvaliacao(banco, id, readFileSync(join(dir, "prompt.md"), "utf8"), opcoes);
  await ate(() => ao_vivo.includes("marcada"), "o prompt marcado ao vivo");
  await parar(id);
  parar_();
});

test("o pedido do Auditor vai ao prompt; enviar com o agente trabalhando é recusado e abortar o para", async () => {
  pifalso("espera");
  const id = await iniciarAvaliacao(
    banco,
    { ...escopo, demandas: ["I-11", "I-10"], pedido: "  foque no custo  " },
    opcoes,
  );
  assert.equal(abrirAv(banco, id).pedido, "foque no custo");
  assert.deepEqual(abrirAv(banco, id).demandas, ["I-10", "I-11"]);
  assert.match(readFileSync(join(raiz, "avaliacoes", id, "prompt.md"), "utf8"), /foque no custo/);
  assert.equal(estadoDaAvaliacao(id), "rodando");
  assert.throws(
    () => {
      enviarNaAvaliacao(banco, id, "oi", opcoes);
    },
    recusa(/trabalhando/),
  );
  abortarAvaliacao(id);
  await ate(() => registro().some((r) => r.comando?.type === "abort"), "o abort");
  await parar(id);
});

test("sincronização com falha vai para o log e não para o serviço", async () => {
  pifalso("ruim");
  const id = await iniciarAvaliacao(banco, escopo, opcoes);
  const log = join(raiz, "avaliacoes", id, "log");
  await ate(() => readFileSync(log, "utf8").includes("sincronização falhou"), "o aviso no log");
  await parar(id);
});

for (const variante of ["morre", "morre-sem-sessao"])
  test(`pi que não sobe (${variante}): some avaliação e pasta, e a causa vai ao Auditor (CA-17)`, async () => {
    const antes = readdirSync(join(raiz, "avaliacoes")).length;
    const jsonls = readdirSync(join(raiz, "sessoes")).length;
    const avaliacoes = banco.prepare("SELECT count(*) AS n FROM avaliacao").get()?.n;
    pifalso(variante);
    await assert.rejects(
      iniciarAvaliacao(banco, escopo, opcoes),
      (e: unknown) => e instanceof ErroExterno && e.message.includes("nenhum modelo configurado"),
    );
    assert.equal(readdirSync(join(raiz, "avaliacoes")).length, antes);
    assert.equal(banco.prepare("SELECT count(*) AS n FROM avaliacao").get()?.n, avaliacoes);
    assert.equal(readdirSync(join(raiz, "sessoes")).length, jsonls);
  });

test("uso sem custo informado fica com custo desconhecido", async () => {
  pifalso("semcusto");
  const id = await iniciarAvaliacao(banco, escopo, opcoes);
  await ate(() => abrirAv(banco, id).uso.length === 1, "o uso");
  assert.equal(abrirAv(banco, id).uso[0]?.custo, null);
  await parar(id);
});

test("recuperarAuditorias também mata o pi das avaliações do reinício", () => {
  const dir = join(raiz, "avaliacoes", "antiga");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pgid"), "999999999");
  recuperarAuditorias(raiz);
  assert.ok(!existsSync(join(dir, "pgid")));
});
