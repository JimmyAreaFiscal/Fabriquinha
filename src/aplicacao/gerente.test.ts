// Gerente (F4 §2, §5.4, §6.6, §6.7) com um pi falso de verdade: a recusa de um comando na autônoma e na interativa, o
// relógio da autônoma parado enquanto um diálogo espera, o diálogo que expira, o aborto e a atividade do agente.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { instalarPiFalso, type PassoPi } from "../../apoio-testes/pi_falso.ts";
import { ErroDeRegra } from "../nucleo/erros.ts";
import type { executar } from "../infra/processo.ts";
import { RESPOSTA_FORA_DA_REVISAO, triarPergunta } from "./auditor_automatico.ts";
import { causaDeInfraestrutura } from "./retomada_infraestrutura.ts";
import {
  abortar,
  assinar,
  atividadeDo,
  encerrar,
  mandar,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type Processo,
  responderDialogo,
  rodarPi,
  situacao,
} from "./gerente.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-gerente-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Eventos da perguntar, incluindo as opções e descrições que a triagem recebe. */
function eventosDaPergunta(
  id: string,
  pergunta: string,
  opcoes?: { label: string; description?: string }[],
  argumentosExtras: object = {},
  metodo = "select",
  titulo = pergunta,
): NonNullable<PassoPi["eventos"]> {
  return [
    {
      type: "tool_execution_start",
      toolCallId: `p-${id}`,
      toolName: "perguntar",
      args: { question: pergunta, ...(opcoes && { options: opcoes }), ...argumentosExtras },
    },
    {
      type: "extension_ui_request",
      id,
      method: metodo,
      title: titulo,
      ...(opcoes && { options: opcoes.map((opcao) => opcao.label.trim()) }),
    },
  ];
}

const pergunta: NonNullable<PassoPi["eventos"]> = [
  { type: "tool_execution_start", toolCallId: "p1", toolName: "perguntar", args: { question: "Qual?" } },
  { type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a"] },
];
const perguntaBanco = eventosDaPergunta("e5", "Posso usar uma cópia do banco real?", undefined, {}, "editor");
const perguntaSonar = eventosDaPergunta("s4", "Como confiro o SonarQube?", [
  { label: "Usar a verificação anterior" },
  { label: "Executar deploy de teste" },
]);
const perguntaAcesso = eventosDaPergunta("s6", "Posso seguir?", [
  { label: "Sim", description: "Usar a chave privada fornecida" },
  { label: "Não" },
]);
const perguntaOpcoes = eventosDaPergunta("s2", "Corrijo o Sonar?", [{ label: " Sim " }, { label: "Não" }], {
  details: "S1",
  multiSelect: true,
});
const perguntaLivre = eventosDaPergunta(
  "e3",
  "Qual handle?",
  undefined,
  { details: "do dev" },
  "editor",
  "Qual handle?\n\ndo dev",
);
const dialogos: NonNullable<PassoPi["eventos"]> = [
  { type: "extension_ui_request", id: "c1", method: "confirm", title: "Seguir?", timeout: 150 },
  { type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a", "b"] },
];
const ferramentaLonga: PassoPi = {
  eventos: [
    { type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "docker build ." } },
    { pausaMs: 600 },
    { type: "tool_execution_end", toolCallId: "b1", toolName: "bash", result: {}, isError: false },
    // O pi que fecha uma mensagem sem `message` não derruba o ouvinte do gerente.
    { type: "message_end" },
  ],
};

let n = 0;
/** Roda o roteiro no `modo`, com o `limiteMin`; devolve a sessão, o registro e a promessa do fim. */
function rodar(
  passos: PassoPi[],
  modo: "autonomo" | "interativo",
  limiteMin = 1,
  triarPergunta?: Processo["triarPergunta"],
  silencioMaximoDoModeloMin?: number,
) {
  const sessao = `s-${String(++n)}`;
  const dir = mkdtempSync(join(base, "exec-"));
  const piFalso = instalarPiFalso(dir).roteirizar(
    passos.map((passo) => ({
      termina: "nunca",
      usuario: false,
      sessao: false,
      resposta: "",
      sigterm: "assenta",
      abortaComMensagem: true,
      ...passo,
    })),
  );
  const respostas = () =>
    piFalso
      .registro()
      .filter((entrada) => entrada.comando?.type === "extension_ui_response" && entrada.comando.value !== undefined)
      .map((entrada) => `${String(entrada.comando?.value)}\n`)
      .join("");
  const fim = rodarPi({
    execucao: { id: sessao, sessaoPi: sessao, modo },
    args: [],
    cwd: dir,
    env: { ...process.env, FABRIQUINHA_ROOT: dir },
    log: join(dir, "log"),
    prompt: "trabalhe",
    limiteMin,
    aoLancar: () => undefined,
    triarPergunta,
    silencioMaximoDoModeloMin,
  });
  return { sessao, fim, dir, respostas };
}

async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 10) {
    assert.ok(espera < 5000, `${oQue} não aconteceu em 5 s`);
    await dormir(10);
  }
}

test("autônoma: o pi que recusa o prompt falha na hora, sem esperar o tempo limite", async () => {
  assert.equal(
    await rodar([{ recusa: "modelo inexistente" }], "autonomo").fim,
    "o pi recusou o comando prompt: modelo inexistente",
  );
});

test("interativa: a recusa do prompt só fica no log, a sessão fica ociosa e termina bem quando encerrada", async () => {
  const { sessao, fim } = rodar([{ recusa: "modelo inexistente" }], "interativo");
  await ate(() => situacao(sessao)?.ocupado === false, "a sessão ociosa");
  encerrar(sessao);
  assert.equal(await fim, undefined);
});

test("interativa: o prompt recusado porque o agente já trabalha não deixa a sessão ociosa", async () => {
  const { sessao, fim, dir } = rodar([{}, { recusa: "Agent is already processing." }], "interativo");
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
  const { sessao, fim } = rodar([{ eventos: dialogos }], "autonomo", 0.005);
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
  const { sessao, fim } = rodar([{ eventos: pergunta }], "autonomo");
  await ate(() => situacao(sessao)?.dialogos.length === 1, "a pergunta");
  assert.equal(situacao(sessao)?.dialogos[0]?.pergunta, true);
  abortar(sessao);
  assert.equal(await fim, "abortada pelo Auditor");
});

test("autônoma: o Auditor automático responde a pergunta banal sozinho, com o rótulo; a resposta e a regra vão ao log", async () => {
  const perguntas: unknown[] = [];
  const { fim, dir, respostas, sessao } = rodar([{ eventos: perguntaOpcoes }], "autonomo", 1, (p) => {
    perguntas.push(p);
    return Promise.resolve({ resposta: "Sim", justificativa: "issue do Sonar se corrige" });
  });
  const noChat: Record<string, unknown>[] = [];
  const desassinar = assinar(sessao, (evento) => noChat.push(evento));
  assert.equal(await fim, undefined);
  desassinar();
  // I-266.T7: quem respondeu é o Agente da execução em curso, no log e no chat; a escalada não tem resposta
  const registro = {
    resposta: "Sim",
    justificativa: "issue do Sonar se corrige",
    ator: { tipo: "agente", trabalho_id: sessao },
    chamada: "p-s2",
    pergunta: "Corrijo o Sonar?",
  };
  assert.deepEqual(
    noChat.filter((e) => e.type === "resposta_automatica"),
    [{ type: "resposta_automatica", ...registro }],
  );
  assert.ok(
    readFileSync(join(dir, "log"), "utf8").includes(`${PREFIXO_DA_RESPOSTA_AUTOMATICA}${JSON.stringify(registro)}\n`),
  );
  assert.deepEqual(perguntas, [{ pergunta: "Corrijo o Sonar?", detalhes: "S1", opcoes: ["Sim", "Não"] }]);

  const descritas = rodar([{ eventos: perguntaAcesso }], "autonomo", 1, (p) => {
    assert.deepEqual(p.descricoes, ["Usar a chave privada fornecida", ""]);
    return Promise.resolve(undefined);
  });
  await ate(() => existsSync(join(descritas.dir, "log")), "a escalada");
  abortar(descritas.sessao);
  await descritas.fim;
  assert.equal(respostas(), '["Sim"]\n');
  assert.match(
    readFileSync(join(dir, "log"), "utf8"),
    /Auditor automático respondeu "Sim" a "Corrijo o Sonar\?": issue do Sonar/,
  );

  const simples = rodar([{ eventos: pergunta }], "autonomo", 1, () =>
    Promise.resolve({ resposta: "a", justificativa: "recomendada" }),
  );
  assert.equal(await simples.fim, undefined);
  assert.equal(simples.respostas(), "a\n");
});

/** A triagem de verdade (`triarPergunta`) com o pi da triagem trocado por uma saída fixa do modelo. */
function triagemComSaida(etapa: string, saidaDoModelo: string): NonNullable<Processo["triarPergunta"]> {
  const piDaTriagem: typeof executar = () =>
    Promise.resolve({ codigo: 0, saida: saidaDoModelo, erro: "", limiteEstourado: false });
  return (p) => triarPergunta(undefined, { ticket: "I-7.T3", etapa, demanda: "Cadastro" }, p, piDaTriagem);
}
const foraDaRevisao = '{"decisao":"fora_da_revisao","justificativa":"pede o Sonar"}';

test("autônoma: a pergunta fora da revisão recebe o texto fixo, com ou sem opções, e o log registra a resposta", async () => {
  const sonar = rodar([{ eventos: perguntaSonar }], "autonomo", 1, triagemComSaida("revisar_rodada", foraDaRevisao));
  assert.equal(await sonar.fim, undefined);
  assert.equal(sonar.respostas(), `${RESPOSTA_FORA_DA_REVISAO}\n`);
  assert.match(
    readFileSync(join(sonar.dir, "log"), "utf8"),
    /Auditor automático respondeu "Fica fora da revisão; registre como verificado fora da revisão e decida pelo resto\." a "Como confiro o SonarQube\?": pede o Sonar/,
  );

  const banco = rodar([{ eventos: perguntaBanco }], "autonomo", 1, triagemComSaida("revisar_demanda", foraDaRevisao));
  assert.equal(await banco.fim, undefined);
  assert.equal(banco.respostas(), `${RESPOSTA_FORA_DA_REVISAO}\n`);
});

test("autônoma: fora da revisão fora das etapas de revisão e oferta de deploy escalam, sem resposta ao agente", async () => {
  const oferta = '{"decisao":"responder","resposta":"Executar deploy de teste","justificativa":"autorizado"}';
  for (const [eventos, etapa, saida] of [
    [perguntaBanco, "implementar", foraDaRevisao],
    [perguntaSonar, "revisar_rodada", oferta],
    [
      perguntaBanco,
      "revisar_demanda",
      '{"decisao":"responder","resposta":"Faça login na conta do Sonar e confira o projeto","justificativa":"banal"}',
    ],
    // "Sim" contextual: a descrição da opção é que oferece a chave, e a triagem a recebe.
    [perguntaAcesso, "implementar", '{"decisao":"responder","resposta":"Sim","justificativa":"banal"}'],
    [
      perguntaBanco,
      "implementar",
      '{"decisao":"responder","resposta":"Utilize a chave privada fornecida","justificativa":"banal"}',
    ],
    // Sem as palavras de credencial: ainda é orientação de acesso e não chega ao agente.
    [
      perguntaBanco,
      "implementar",
      '{"decisao":"responder","resposta":"Entre no painel do Sonar e confira o projeto","justificativa":"banal"}',
    ],
  ] as const) {
    const escalada = rodar([{ eventos: [...eventos] }], "autonomo", 1, triagemComSaida(etapa, saida));
    await ate(
      () =>
        existsSync(join(escalada.dir, "log")) && readFileSync(join(escalada.dir, "log"), "utf8").includes("escalou"),
      "a escalada",
    );
    assert.match(readFileSync(join(escalada.dir, "log"), "utf8"), /Auditor automático escalou ao Auditor: .+\?/);
    assert.equal(escalada.respostas(), "");
    assert.equal(situacao(escalada.sessao)?.dialogos.length, 1);
    abortar(escalada.sessao);
    assert.equal(await escalada.fim, "abortada pelo Auditor");
  }
});

test("autônoma: a pergunta estratégica fica com o Auditor; a resposta dele antes da triagem vale e a triagem não repete", async () => {
  const escalada = rodar([{ eventos: perguntaLivre }], "autonomo", 1, (p) => {
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
  const atrasada = rodar([{ eventos: pergunta }], "autonomo", 1, () => new Promise((pronto) => (liberar = pronto)));
  await ate(() => situacao(atrasada.sessao)?.dialogos.length === 1, "a pergunta");
  responderDialogo(atrasada.sessao, "s1", { value: "a" });
  liberar({ resposta: "a", justificativa: "j" });
  assert.equal(await atrasada.fim, undefined);
  assert.equal(atrasada.respostas(), "a\n");

  // Interativa: a triagem não entra.
  const interativa = rodar([{ eventos: pergunta }], "interativo", 1, () => assert.fail("a interativa não faz triagem"));
  await ate(() => situacao(interativa.sessao)?.dialogos.length === 1, "a pergunta da interativa");
  encerrar(interativa.sessao);
  assert.equal(await interativa.fim, undefined);
});

test("encerrar a autônoma com um diálogo de tempo limite pendente para o relógio dele; o assentar depois do fim não arma relógio", async () => {
  const comDialogo = rodar([{ eventos: dialogos }], "autonomo");
  await ate(() => (situacao(comDialogo.sessao)?.dialogos.length ?? 0) === 2, "os diálogos");
  encerrar(comDialogo.sessao);
  assert.equal(await comDialogo.fim, undefined);

  const trabalhando = rodar([{}], "interativo");
  await ate(() => situacao(trabalhando.sessao)?.ocupado === true, "o agente trabalhando");
  encerrar(trabalhando.sessao);
  assert.equal(await trabalhando.fim, undefined);
  assert.equal(situacao(trabalhando.sessao), undefined);
});

test("o modelo que para de responder no meio da resposta encerra a execução como falha de infraestrutura retomável", async () => {
  // 0,005 min = 300 ms de silêncio aceito; o limite da execução inteira (1 min) não chega a contar.
  const { fim, dir } = rodar([{ mensagemAberta: true }], "autonomo", 1, undefined, 0.005);
  const falha = await fim;
  assert.equal(falha, "o modelo ficou 0.005 min sem responder (tempo limite sem eventos do pi)");
  assert.equal(causaDeInfraestrutura(falha), "transitoria");
  assert.match(readFileSync(join(dir, "log"), "utf8"), /o modelo ficou 0\.005 min sem responder/);
});

test("ferramenta longa e sessão interativa ociosa não disparam o vigia do modelo", async () => {
  assert.equal(
    await rodar([{ ...ferramentaLonga, termina: "assenta" }], "autonomo", 1, undefined, 0.005).fim,
    undefined,
  );

  const ociosa = rodar([{ ...ferramentaLonga, termina: "assenta" }], "interativo", 1, undefined, 0.005);
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
