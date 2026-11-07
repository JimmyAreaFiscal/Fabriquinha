// Gerente (F4 §2, §5.4, §6.6, §6.7) com um pi falso de verdade: a recusa de um comando na autônoma e na interativa, o
// relógio da autônoma parado enquanto um diálogo espera, o diálogo que expira, o aborto e a atividade do agente.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { executar } from "../processo.ts";
import { RESPOSTA_FORA_DA_REVISAO, triarPergunta } from "./auditor_automatico.ts";
import { causaDeInfraestrutura } from "./retomada_infraestrutura.ts";
import {
  abortar,
  atividadeDo,
  encerrar,
  mandar,
  type Processo,
  responderDialogo,
  rodarPi,
  situacao,
} from "./gerente.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-gerente-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** pi falso: responde ao prompt conforme $FALSO_PI (recusa, ocupado, dialogo, pergunta ou trabalha sem fim) e ao `abort`. */
const pi = join(base, "pi.mjs");
writeFileSync(
  pi,
  `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const variante = process.env.FALSO_PI;
const assistente = (stopReason) => emitir({ type: "message_end", message: { role: "assistant", content: [], stopReason } });
let prompts = 0;
function aoPrompt() {
  // Como o pi que já trabalha: o segundo prompt é recusado e o primeiro segue rodando.
  if (variante === "ocupado" && ++prompts > 1)
    return emitir({ type: "response", command: "prompt", success: false, error: "Agent is already processing." });
  if (variante === "recusa") return emitir({ type: "response", command: "prompt", success: false, error: "modelo inexistente" });
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  if (variante === "dialogo") {
    emitir({ type: "extension_ui_request", id: "c1", method: "confirm", title: "Seguir?", timeout: 150 });
    emitir({ type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a", "b"] });
  }
  if (variante === "pergunta") {
    emitir({ type: "tool_execution_start", toolCallId: "p1", toolName: "perguntar", args: { question: "Qual?" } });
    emitir({ type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a"] });
  }
  if (variante === "pergunta_opcoes") {
    const args = { question: "Corrijo o Sonar?", details: "S1", options: [{ label: " Sim " }, { label: "Não" }], multiSelect: true };
    emitir({ type: "tool_execution_start", toolCallId: "p2", toolName: "perguntar", args });
    emitir({ type: "extension_ui_request", id: "s2", method: "select", title: "Corrijo o Sonar?", options: ["Sim", "Não"] });
  }
  if (variante === "pergunta_sonar") {
    const args = { question: "Como confiro o SonarQube?", options: [{ label: "Usar a verificação anterior" }, { label: "Executar deploy de teste" }] };
    emitir({ type: "tool_execution_start", toolCallId: "p4", toolName: "perguntar", args });
    emitir({ type: "extension_ui_request", id: "s4", method: "select", title: "Como confiro o SonarQube?", options: ["Usar a verificação anterior", "Executar deploy de teste"] });
  }
  if (variante === "pergunta_banco") {
    emitir({ type: "tool_execution_start", toolCallId: "p5", toolName: "perguntar", args: { question: "Posso usar uma cópia do banco real?" } });
    emitir({ type: "extension_ui_request", id: "e5", method: "editor", title: "Posso usar uma cópia do banco real?" });
  }
  if (variante === "pergunta_livre") {
    emitir({ type: "tool_execution_start", toolCallId: "p3", toolName: "perguntar", args: { question: "Qual handle?", details: "do dev" } });
    emitir({ type: "extension_ui_request", id: "e3", method: "editor", title: "Qual handle?\\n\\ndo dev" });
  }
  // A resposta do modelo começa e não chega mais nada, como na I-259.T16.
  if (variante === "modelo_travado") emitir({ type: "message_start", message: { role: "assistant", content: [] } });
  // Uma ferramenta roda mais que o silêncio aceito do modelo, sem atualização parcial, e o agente termina depois.
  if (variante === "ferramenta_longa") {
    emitir({ type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "docker build ." } });
    setTimeout(() => {
      emitir({ type: "tool_execution_end", toolCallId: "b1", toolName: "bash", result: {}, isError: false });
      assistente("stop");
      emitir({ type: "agent_settled" });
    }, 600);
  }
}
// Como o pi que assenta ao receber o SIGTERM: o evento chega depois do fim da execução.
process.on("SIGTERM", () => {
  emitir({ type: "agent_settled" });
  setTimeout(() => process.exit(0), 50);
});
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type === "prompt") aoPrompt();
    if (c.type === "extension_ui_response" && c.value !== undefined) appendFileSync("respostas", c.value + "\\n");
    if (c.type === "extension_ui_response" && !c.cancelled) {
      assistente("stop");
      emitir({ type: "agent_settled" });
    }
    if (c.type === "abort") {
      assistente("aborted");
      emitir({ type: "agent_settled" });
    }
  }
});
`,
);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

let n = 0;
/** Roda o pi falso na `variante`, no `modo`, com o `limiteMin`; devolve a sessão e a promessa do fim. */
function rodar(
  variante: string,
  modo: "autonomo" | "interativo",
  limiteMin = 1,
  triarPergunta?: Processo["triarPergunta"],
  silencioMaximoDoModeloMin?: number,
) {
  const sessao = `s-${String(++n)}`;
  const dir = mkdtempSync(join(base, "exec-"));
  const fim = rodarPi({
    execucao: { id: sessao, sessaoPi: sessao, modo },
    args: [],
    cwd: dir,
    env: { ...process.env, FALSO_PI: variante },
    log: join(dir, "log"),
    prompt: "trabalhe",
    limiteMin,
    aoLancar: () => undefined,
    triarPergunta,
    silencioMaximoDoModeloMin,
  });
  return { sessao, fim, dir };
}

async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 10) {
    assert.ok(espera < 5000, `${oQue} não aconteceu em 5 s`);
    await dormir(10);
  }
}

test("autônoma: o pi que recusa o prompt falha na hora, sem esperar o tempo limite", async () => {
  assert.equal(await rodar("recusa", "autonomo").fim, "o pi recusou o comando prompt: modelo inexistente");
});

test("interativa: a recusa do prompt só fica no log, a sessão fica ociosa e termina bem quando encerrada", async () => {
  const { sessao, fim } = rodar("recusa", "interativo");
  await ate(() => situacao(sessao)?.ocupado === false, "a sessão ociosa");
  encerrar(sessao);
  assert.equal(await fim, undefined);
});

test("interativa: o prompt recusado porque o agente já trabalha não deixa a sessão ociosa", async () => {
  const { sessao, fim, dir } = rodar("ocupado", "interativo");
  mandar(sessao, { type: "prompt", message: "mais uma" });
  await ate(
    () =>
      existsSync(join(dir, "log")) && readFileSync(join(dir, "log"), "utf8").includes("Agent is already processing"),
    "a recusa no log",
  );
  assert.equal(situacao(sessao)?.ocupado, true);
  encerrar(sessao);
  assert.equal(await fim, undefined);
});

test("autônoma: o relógio para enquanto o diálogo espera; o diálogo com tempo limite expira e o respondido segue", async () => {
  // 0,005 min = 300 ms: o diálogo fica pendente por mais tempo que isso sem a execução estourar o limite.
  const { sessao, fim } = rodar("dialogo", "autonomo", 0.005);
  await ate(() => (situacao(sessao)?.dialogos.length ?? 0) === 2, "os dois diálogos");
  assert.ok(situacao(sessao)?.dialogos.find((d) => d.id === "c1")?.expiraEm);
  await ate(() => situacao(sessao)?.dialogos.length === 1, "a expiração do confirm");
  await dormir(400);
  assert.equal(situacao(sessao)?.dialogos[0]?.id, "s1", "sem estourar o limite com o diálogo pendente");
  responderDialogo(sessao, "s1", { value: "a" });
  assert.throws(() => {
    responderDialogo(sessao, "s1", { value: "a" });
  }, ErroDeRegra);
  assert.equal(await fim, undefined);
});

test("autônoma: o select da perguntar vira a pergunta do chat; abortar dá a falha de abortada pelo Auditor", async () => {
  const { sessao, fim } = rodar("pergunta", "autonomo");
  await ate(() => situacao(sessao)?.dialogos.length === 1, "a pergunta");
  assert.equal(situacao(sessao)?.dialogos[0]?.pergunta, true);
  abortar(sessao);
  assert.equal(await fim, "abortada pelo Auditor");
});

test("autônoma: o Auditor automático responde a pergunta banal sozinho, com o rótulo; a resposta e a regra vão ao log", async () => {
  const perguntas: unknown[] = [];
  const { fim, dir } = rodar("pergunta_opcoes", "autonomo", 1, (p) => {
    perguntas.push(p);
    return Promise.resolve({ resposta: "Sim", justificativa: "issue do Sonar se corrige" });
  });
  assert.equal(await fim, undefined);
  assert.deepEqual(perguntas, [{ pergunta: "Corrijo o Sonar?", detalhes: "S1", opcoes: ["Sim", "Não"] }]);
  assert.equal(readFileSync(join(dir, "respostas"), "utf8"), '["Sim"]\n');
  assert.match(
    readFileSync(join(dir, "log"), "utf8"),
    /Auditor automático respondeu "Sim" a "Corrijo o Sonar\?": issue do Sonar/,
  );

  const simples = rodar("pergunta", "autonomo", 1, () =>
    Promise.resolve({ resposta: "a", justificativa: "recomendada" }),
  );
  assert.equal(await simples.fim, undefined);
  assert.equal(readFileSync(join(simples.dir, "respostas"), "utf8"), "a\n");
});

/** A triagem de verdade (`triarPergunta`) com o pi da triagem trocado por uma saída fixa do modelo. */
function triagemComSaida(etapa: string, saidaDoModelo: string): NonNullable<Processo["triarPergunta"]> {
  const piDaTriagem: typeof executar = () =>
    Promise.resolve({ codigo: 0, saida: saidaDoModelo, erro: "", limiteEstourado: false });
  return (p) => triarPergunta(undefined, { ticket: "I-7.T3", etapa, demanda: "Cadastro" }, p, piDaTriagem);
}
const foraDaRevisao = '{"decisao":"fora_da_revisao","justificativa":"pede o Sonar"}';

test("autônoma: a pergunta fora da revisão recebe o texto fixo, com ou sem opções, e o log registra a resposta", async () => {
  const sonar = rodar("pergunta_sonar", "autonomo", 1, triagemComSaida("revisar_rodada", foraDaRevisao));
  assert.equal(await sonar.fim, undefined);
  assert.equal(readFileSync(join(sonar.dir, "respostas"), "utf8"), `${RESPOSTA_FORA_DA_REVISAO}\n`);
  assert.match(
    readFileSync(join(sonar.dir, "log"), "utf8"),
    /Auditor automático respondeu "Fica fora da revisão; registre como verificado fora da revisão e decida pelo resto\." a "Como confiro o SonarQube\?": pede o Sonar/,
  );

  const banco = rodar("pergunta_banco", "autonomo", 1, triagemComSaida("revisar_demanda", foraDaRevisao));
  assert.equal(await banco.fim, undefined);
  assert.equal(readFileSync(join(banco.dir, "respostas"), "utf8"), `${RESPOSTA_FORA_DA_REVISAO}\n`);
});

test("autônoma: fora da revisão fora das etapas de revisão e oferta de deploy escalam, sem resposta ao agente", async () => {
  const oferta = '{"decisao":"responder","resposta":"Executar deploy de teste","justificativa":"autorizado"}';
  for (const [variante, etapa, saida] of [
    ["pergunta_banco", "implementar", foraDaRevisao],
    ["pergunta_sonar", "revisar_rodada", oferta],
    [
      "pergunta_banco",
      "revisar_demanda",
      '{"decisao":"responder","resposta":"Faça login na conta do Sonar e confira o projeto","justificativa":"banal"}',
    ],
  ] as const) {
    const escalada = rodar(variante, "autonomo", 1, triagemComSaida(etapa, saida));
    await ate(
      () =>
        existsSync(join(escalada.dir, "log")) && readFileSync(join(escalada.dir, "log"), "utf8").includes("escalou"),
      "a escalada",
    );
    assert.match(readFileSync(join(escalada.dir, "log"), "utf8"), /Auditor automático escalou ao Auditor: .+\?/);
    assert.equal(existsSync(join(escalada.dir, "respostas")), false);
    assert.equal(situacao(escalada.sessao)?.dialogos.length, 1);
    abortar(escalada.sessao);
    assert.equal(await escalada.fim, "abortada pelo Auditor");
  }
});

test("autônoma: a pergunta estratégica fica com o Auditor; a resposta dele antes da triagem vale e a triagem não repete", async () => {
  const escalada = rodar("pergunta_livre", "autonomo", 1, (p) => {
    assert.deepEqual(p, { pergunta: "Qual handle?", detalhes: "do dev", opcoes: [] });
    return Promise.resolve(undefined);
  });
  await ate(
    () => existsSync(join(escalada.dir, "log")) && readFileSync(join(escalada.dir, "log"), "utf8").includes("escalou"),
    "a escalada",
  );
  assert.equal(situacao(escalada.sessao)?.dialogos.length, 1);
  responderDialogo(escalada.sessao, "e3", { value: "jimmy" });
  assert.equal(await escalada.fim, undefined);

  let liberar: (r: { resposta: string; justificativa: string }) => void = () => undefined;
  const atrasada = rodar("pergunta", "autonomo", 1, () => new Promise((pronto) => (liberar = pronto)));
  await ate(() => situacao(atrasada.sessao)?.dialogos.length === 1, "a pergunta");
  responderDialogo(atrasada.sessao, "s1", { value: "a" });
  liberar({ resposta: "a", justificativa: "j" });
  assert.equal(await atrasada.fim, undefined);
  assert.equal(readFileSync(join(atrasada.dir, "respostas"), "utf8"), "a\n");

  // Interativa: a triagem não entra.
  const interativa = rodar("pergunta", "interativo", 1, () => assert.fail("a interativa não faz triagem"));
  await ate(() => situacao(interativa.sessao)?.dialogos.length === 1, "a pergunta da interativa");
  encerrar(interativa.sessao);
  assert.equal(await interativa.fim, undefined);
});

test("encerrar a autônoma com um diálogo de tempo limite pendente para o relógio dele; o assentar depois do fim não arma relógio", async () => {
  const comDialogo = rodar("dialogo", "autonomo");
  await ate(() => (situacao(comDialogo.sessao)?.dialogos.length ?? 0) === 2, "os diálogos");
  encerrar(comDialogo.sessao);
  assert.equal(await comDialogo.fim, undefined);

  const trabalhando = rodar("trabalha", "interativo");
  await ate(() => situacao(trabalhando.sessao)?.ocupado === true, "o agente trabalhando");
  encerrar(trabalhando.sessao);
  assert.equal(await trabalhando.fim, undefined);
  assert.equal(situacao(trabalhando.sessao), undefined);
});

test("o modelo que para de responder no meio da resposta encerra a execução como falha de infraestrutura retomável", async () => {
  // 0,005 min = 300 ms de silêncio aceito; o limite da execução inteira (1 min) não chega a contar.
  const { fim, dir } = rodar("modelo_travado", "autonomo", 1, undefined, 0.005);
  const falha = await fim;
  assert.equal(falha, "o modelo ficou 0.005 min sem responder (tempo limite sem eventos do pi)");
  assert.equal(causaDeInfraestrutura(falha), "transitoria");
  assert.match(readFileSync(join(dir, "log"), "utf8"), /o modelo ficou 0\.005 min sem responder/);
});

test("ferramenta longa e sessão interativa ociosa não disparam o vigia do modelo", async () => {
  assert.equal(await rodar("ferramenta_longa", "autonomo", 1, undefined, 0.005).fim, undefined);

  const ociosa = rodar("ferramenta_longa", "interativo", 1, undefined, 0.005);
  await ate(() => situacao(ociosa.sessao)?.ocupado === false, "a sessão ociosa");
  await dormir(400);
  assert.ok(situacao(ociosa.sessao), "a sessão ociosa segue viva além do silêncio aceito");
  encerrar(ociosa.sessao);
  assert.equal(await ociosa.fim, undefined);
});

test("atividade: a ferramenta com o comando ou o caminho, a primeira linha do texto, cortada em 100 caracteres", () => {
  assert.equal(
    atividadeDo({ type: "tool_execution_start", toolName: "read", args: { path: "src/a.ts" } }),
    "read src/a.ts",
  );
  assert.equal(atividadeDo({ type: "tool_execution_start", toolName: "ls" }), "ls");
  const longo = "x".repeat(120);
  const fala = (content: unknown) => atividadeDo({ type: "message_end", message: { role: "assistant", content } });
  assert.equal(fala([{ type: "text", text: `\n  ${longo}\noutra` }]), `${"x".repeat(99)}…`);
  assert.equal(fala("texto solto"), undefined);
  assert.equal(fala([{ type: "toolCall" }]), undefined);
  assert.equal(atividadeDo({ type: "message_end", message: null }), undefined);
  assert.equal(atividadeDo({ type: "agent_start" }), undefined);
});
