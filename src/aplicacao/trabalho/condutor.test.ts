// Condutor (F4 §2, §5.4, §6.6, §6.7) com um pi falso de verdade: a recusa de um comando na autônoma e na interativa, o
// relógio da autônoma parado enquanto um diálogo espera, o diálogo que expira, o aborto e a atividade do agente.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { abrirBancoTemporario } from "../../../apoio-testes/banco_temporario.ts";
import { instalarDockerFalso } from "../../../apoio-testes/docker_falso.ts";
import { instalarPiFalso, type PassoPi } from "../../../apoio-testes/pi_falso.ts";
import { AmbienteContainer, dirDoPiDoAmbiente } from "../../infra/ambiente/container/ambiente_container.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import type { executar } from "../../infra/processo.ts";
import { RESPOSTA_FORA_DA_REVISAO, triarPergunta } from "../auditor_automatico.ts";
import { type Relogio, relogioFixo } from "../../nucleo/relogio.ts";
import { falhaPorServicoReiniciado, falhaQueExigeOAuditor } from "../../nucleo/tentativa.ts";
import { atividadeDo, condutor, PREFIXO_DA_RESPOSTA_AUTOMATICA, type PedidoDeProcesso } from "./condutor.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-condutor-"));
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
    // O pi que fecha uma mensagem sem `message` não derruba o ouvinte do condutor.
    { type: "message_end" },
  ],
};

let n = 0;
/** Roda o roteiro no `modo`, com o `limiteMin`; devolve a sessão, o registro e a promessa do fim. */
function rodar(
  passos: PassoPi[],
  modo: "autonomo" | "interativo",
  limiteMin = 1,
  triarPergunta?: PedidoDeProcesso["triarPergunta"],
  silencioMaximoDoModeloMin?: number,
  relogio?: Relogio,
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
  let grupoDoPi = 0;
  const fim = condutor.iniciar(
    {
      execucao: { id: sessao, sessaoPi: sessao, modo },
      args: [],
      cwd: dir,
      env: { ...process.env, FABRIQUINHA_ROOT: dir },
      log: join(dir, "log"),
      prompt: "trabalhe",
      limiteMin,
      aoLancar: (grupo) => {
        grupoDoPi = grupo;
      },
      triarPergunta,
      silencioMaximoDoModeloMin,
    },
    relogio,
  );
  return { sessao, fim, dir, respostas, grupoDoPi };
}

async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 10) {
    assert.ok(espera < 5000, `${oQue} não aconteceu em 5 s`);
    await dormir(10);
  }
}

test("autônoma: o pi que recusa o prompt falha na hora, sem esperar o tempo limite", async () => {
  assert.deepEqual(
    await rodar([{ recusa: "modelo inexistente" }], "autonomo").fim,
    falhaQueExigeOAuditor("o pi recusou o comando prompt: modelo inexistente"),
  );
});

test("interativa: a recusa do prompt só fica no log, a sessão fica ociosa e termina bem quando encerrada", async () => {
  const { sessao, fim } = rodar([{ recusa: "modelo inexistente" }], "interativo");
  await ate(() => condutor.situacao(sessao)?.ocupado === false, "a sessão ociosa");
  condutor.encerrar(sessao);
  assert.equal(await fim, undefined);
});

test("interativa: o prompt rejeitado porque o agente já trabalha não deixa a sessão ociosa", async () => {
  const { sessao, fim, dir } = rodar([{}, { recusa: "Agent is already processing." }], "interativo");
  condutor.mandar(sessao, { type: "prompt", message: "mais uma" });
  await ate(
    () =>
      existsSync(join(dir, "log")) && readFileSync(join(dir, "log"), "utf8").includes("Agent is already processing"),
    "a recusa no log",
  );
  assert.equal(condutor.situacao(sessao)?.ocupado, true);
  condutor.encerrar(sessao);
  assert.equal(await fim, undefined);
});

test("autônoma: o relógio para enquanto o diálogo espera; o diálogo com tempo limite expira e o respondido segue", async () => {
  // 0,005 min = 300 ms: o diálogo fica pendente por mais tempo que isso sem a execução estourar o limite.
  const { sessao, fim } = rodar([{ eventos: dialogos }], "autonomo", 0.005);
  await ate(() => (condutor.situacao(sessao)?.dialogos.length ?? 0) === 2, "os dois diálogos");
  assert.ok(condutor.situacao(sessao)?.dialogos.find((d) => d.id === "c1")?.expiraEm);
  await ate(() => condutor.situacao(sessao)?.dialogos.length === 1, "a expiração do confirm");
  await dormir(400);
  assert.equal(condutor.situacao(sessao)?.dialogos[0]?.id, "s1", "sem estourar o limite com o diálogo pendente");
  condutor.responder(sessao, "s1", { value: "a" });
  assert.throws(() => {
    condutor.responder(sessao, "s1", { value: "a" });
  }, ErroDeRegra);
  assert.equal(await fim, undefined);
});

test("o diálogo e a situação da sessão usam o instante do relógio recebido; o tempo limite soma ao instante", async () => {
  const instante = "2026-01-02T03:04:05.000Z";
  const { sessao, fim } = rodar([{ eventos: dialogos }], "interativo", 1, undefined, undefined, relogioFixo(instante));
  await ate(() => (condutor.situacao(sessao)?.dialogos.length ?? 0) >= 1, "o diálogo");
  assert.equal(condutor.situacao(sessao)?.desde, instante);
  const confirmar = condutor.situacao(sessao)?.dialogos.find((d) => d.id === "c1");
  assert.equal(confirmar?.em, instante);
  assert.equal(confirmar.expiraEm, "2026-01-02T03:04:05.150Z");
  condutor.encerrar(sessao);
  await fim;
});

test("autônoma: o select da perguntar vira a pergunta do chat; abortar dá a falha de abortada pelo Auditor", async () => {
  const { sessao, fim } = rodar([{ eventos: pergunta }], "autonomo");
  await ate(() => condutor.situacao(sessao)?.dialogos.length === 1, "a pergunta");
  assert.equal(condutor.situacao(sessao)?.dialogos[0]?.pergunta, true);
  condutor.abortar(sessao);
  assert.deepEqual(await fim, { tipo: "interrompida", por: { tipo: "auditor" }, motivo: "abortada pelo Auditor" });
});

test("autônoma: o Auditor automático responde a pergunta banal sozinho, com o rótulo; a resposta e a regra vão ao log", async () => {
  const perguntas: unknown[] = [];
  const { fim, dir, respostas, sessao } = rodar([{ eventos: perguntaOpcoes }], "autonomo", 1, (p) => {
    perguntas.push(p);
    return Promise.resolve({ resposta: "Sim", justificativa: "issue do Sonar se corrige" });
  });
  const noChat: Record<string, unknown>[] = [];
  const desassinar = condutor.assinar(sessao, (evento) => noChat.push(evento));
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
  condutor.abortar(descritas.sessao);
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
function triagemComSaida(etapa: string, saidaDoModelo: string): NonNullable<PedidoDeProcesso["triarPergunta"]> {
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
    assert.equal(condutor.situacao(escalada.sessao)?.dialogos.length, 1);
    condutor.abortar(escalada.sessao);
    assert.deepEqual(await escalada.fim, {
      tipo: "interrompida",
      por: { tipo: "auditor" },
      motivo: "abortada pelo Auditor",
    });
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
  assert.equal(condutor.situacao(escalada.sessao)?.dialogos.length, 1);
  condutor.responder(escalada.sessao, "e3", { value: "jimmy" });
  assert.equal(await escalada.fim, undefined);

  let liberar: (r: { resposta: string; justificativa: string }) => void = () => undefined;
  const atrasada = rodar([{ eventos: pergunta }], "autonomo", 1, () => new Promise((pronto) => (liberar = pronto)));
  await ate(() => condutor.situacao(atrasada.sessao)?.dialogos.length === 1, "a pergunta");
  condutor.responder(atrasada.sessao, "s1", { value: "a" });
  liberar({ resposta: "a", justificativa: "j" });
  assert.equal(await atrasada.fim, undefined);
  assert.equal(atrasada.respostas(), "a\n");

  // Interativa: a triagem não entra.
  const interativa = rodar([{ eventos: pergunta }], "interativo", 1, () => assert.fail("a interativa não faz triagem"));
  await ate(() => condutor.situacao(interativa.sessao)?.dialogos.length === 1, "a pergunta da interativa");
  condutor.encerrar(interativa.sessao);
  assert.equal(await interativa.fim, undefined);
});

test("encerrar a autônoma com um diálogo de tempo limite pendente para o relógio dele; o assentar depois do fim não arma relógio", async () => {
  const comDialogo = rodar([{ eventos: dialogos }], "autonomo");
  await ate(() => (condutor.situacao(comDialogo.sessao)?.dialogos.length ?? 0) === 2, "os diálogos");
  condutor.encerrar(comDialogo.sessao);
  assert.equal(await comDialogo.fim, undefined);

  const trabalhando = rodar([{}], "interativo");
  await ate(() => condutor.situacao(trabalhando.sessao)?.ocupado === true, "o agente trabalhando");
  condutor.encerrar(trabalhando.sessao);
  assert.equal(await trabalhando.fim, undefined);
  assert.equal(condutor.situacao(trabalhando.sessao), undefined);
});

test("o modelo que para de responder no meio da resposta encerra a execução como falha de infraestrutura retomável", async () => {
  // 0,005 min = 300 ms de silêncio aceito; o limite da execução inteira (1 min) não chega a contar.
  const { fim, dir } = rodar([{ mensagemAberta: true }], "autonomo", 1, undefined, 0.005);
  const falha = await fim;
  assert.deepEqual(falha, {
    tipo: "falha_infraestrutura",
    causa: "modelo_sem_resposta",
    motivo: "o modelo ficou 0.005 min sem responder (tempo limite sem eventos do pi)",
  });
  assert.match(readFileSync(join(dir, "log"), "utf8"), /o modelo ficou 0\.005 min sem responder/);
});

test("ferramenta longa e sessão interativa ociosa não disparam o vigia do modelo", async () => {
  assert.equal(
    await rodar([{ ...ferramentaLonga, termina: "assenta" }], "autonomo", 1, undefined, 0.005).fim,
    undefined,
  );

  const ociosa = rodar([{ ...ferramentaLonga, termina: "assenta" }], "interativo", 1, undefined, 0.005);
  await ate(() => condutor.situacao(ociosa.sessao)?.ocupado === false, "a sessão ociosa");
  await dormir(400);
  assert.ok(condutor.situacao(ociosa.sessao), "a sessão ociosa segue viva além do silêncio aceito");
  condutor.encerrar(ociosa.sessao);
  assert.equal(await ociosa.fim, undefined);
});

test("falhas do provedor conservam o motivo e resolvem a causa tipada; os demais erros pedem o Auditor", async () => {
  for (const [erro, causa] of [
    ["Claude quota exceeded — rate limit", "cota"],
    ["Codex error: The usage limit has been reached", "cota"],
    ["ETIMEDOUT", "tempo_limite"],
    ["TimeoutError", "tempo_limite"],
    ["HTTP 504", "servico_externo_inacessivel"],
    ["ECONNRESET", "servico_externo_inacessivel"],
    ["overloaded_error", "servico_externo_inacessivel"],
    ["ENOSPC: no space left on device", undefined],
  ] as const) {
    const motivo = `o agente parou com stopReason error: ${erro}`;
    assert.deepEqual(
      await rodar([{ termina: "assenta", parada: "error", erro }], "autonomo").fim,
      causa ? { tipo: "falha_infraestrutura", causa, motivo } : falhaQueExigeOAuditor(motivo),
    );
  }
  assert.deepEqual(
    await rodar([{ termina: "assenta", parada: "aborted" }], "autonomo").fim,
    falhaQueExigeOAuditor("o agente parou com stopReason aborted"),
  );
});

test("tempo ativo estourado, saída com código e morte por sinal resolvem falhas distintas", async () => {
  assert.deepEqual(await rodar([{}], "autonomo", 0.005).fim, {
    tipo: "falha_infraestrutura",
    causa: "tempo_limite",
    motivo: "tempo limite de 0.005 min",
  });
  const saida = rodar([{ sai: { codigo: 7 } }], "autonomo");
  assert.deepEqual(
    await saida.fim,
    falhaQueExigeOAuditor(`o pi saiu antes de terminar a execução (código 7); veja o log em ${join(saida.dir, "log")}`),
  );
  const sinal = rodar([{ sigterm: "ignora" }], "autonomo");
  process.kill(-sinal.grupoDoPi, "SIGKILL");
  assert.deepEqual(await sinal.fim, falhaPorServicoReiniciado);
  const ociosa = rodar([{ termina: "assenta" }], "interativo", 0.005);
  assert.equal(await ociosa.fim, undefined);
  assert.match(readFileSync(join(ociosa.dir, "log"), "utf8"), /sessão ociosa por 0.005 min/);
});

test("assinar no meio da mensagem ou após seu fim repassa o retrato; ouvinte que lança só vai ao log", async () => {
  const eventos = [
    { type: "message_start", message: { role: "assistant" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "oi" } },
  ];
  for (const encerrada of [false, true]) {
    const execucao = rodar(
      [
        {
          eventos: [
            ...eventos,
            ...(encerrada ? [{ type: "message_end", message: { role: "assistant", content: [] } }] : []),
            { pausaMs: 800 },
            { type: "response", command: "steer", success: false, error: "rejeitado" },
            { type: "extension_ui_request", method: "notify" },
          ],
        },
      ],
      "interativo",
    );
    await dormir(300);
    const recebidos: string[] = [];
    const pararRetrato = condutor.assinar(execucao.sessao, (evento) => recebidos.push(String(evento.type)));
    assert.deepEqual(recebidos, encerrada ? ["message_end"] : ["message_start", "message_update"]);
    const pararFalho = condutor.assinar(execucao.sessao, (evento) => {
      if (evento.type === "response") throw new Error("ouvinte indisponível");
    });
    await ate(
      () =>
        existsSync(join(execucao.dir, "log")) &&
        readFileSync(join(execucao.dir, "log"), "utf8").includes("ouvinte indisponível"),
      "a falha do ouvinte no log",
    );
    condutor.encerrar(execucao.sessao);
    assert.equal(await execucao.fim, undefined);
    pararRetrato();
    pararFalho();
  }
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

/** Um processo de verdade em grupo próprio, que só termina quando alguém o mata; `morto` resolve com o sinal que o matou. */
function processoEmGrupoProprio() {
  const processo = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  return { pgid: processo.pid ?? 0, morto: once(processo, "exit") };
}

test("recuperarNaSubida mata numa chamada só os grupos órfãos do ticket, da avaliação e da simulação, e fecha o que dependia deles", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    const daTicket = processoEmGrupoProprio();
    const daAvaliacao = processoEmGrupoProprio();
    const daSimulacao = processoEmGrupoProprio();
    banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
        VALUES ('d', '/nao/existe', 'main', 'github', 'k');
      INSERT INTO demanda VALUES ('I-1', 'd', 't', 'funcionalidade', 'd', 'em_execucao', '2026-10-11T12:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1');
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
        VALUES ('I-1', 1, 'implementar', 'em_execucao', '2026-10-11T12:00:00.000Z');
      INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 's1');
      INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha, grupo_processo) VALUES ('e1', 's1', '2026-10-11T12:00:00.000Z', 0, ${String(daTicket.pgid)});
      INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em, grupo_processo)
        VALUES ('11111111-1111-4111-8111-111111111111', 'd', '2026-10-01', '2026-10-02', '', 't', ${String(daAvaliacao.pgid)});
      INSERT INTO usuario_simulado (id, projeto, nome, descricao) VALUES (1, 'd', 'Dona Maria', 'd');
      INSERT INTO tarefa (id, projeto, texto, n, criada_em) VALUES (1, 'd', 't', 1, 'x');
      INSERT INTO tarefa_usuario VALUES (1, 1);
      INSERT INTO execucao_simulada (id, tarefa, usuario, status, relatorio, pgid)
        VALUES (1, 1, 1, 'em_andamento', NULL, ${String(daSimulacao.pgid)})`);

    condutor.recuperarNaSubida(banco);

    for (const grupo of [daTicket, daAvaliacao, daSimulacao]) assert.deepEqual(await grupo.morto, [null, "SIGKILL"]);
    assert.partialDeepStrictEqual(banco.prepare("SELECT * FROM processo_do_trabalho").get(), { falha: 1 });
    assert.equal(banco.prepare("SELECT estado FROM ticket_demanda").get()?.estado, "falhou");
    assert.equal(banco.prepare("SELECT grupo_processo FROM avaliacao").get()?.grupo_processo, null);
    assert.partialDeepStrictEqual(banco.prepare("SELECT * FROM execucao_simulada").get(), {
      status: "falhou",
      pgid: null,
    });
  } finally {
    fechar();
  }
});

test("recuperarNaSubida ignora a avaliação sem pi e o processo que nunca chegou a lançar o pi", () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    condutor.recuperarNaSubida(banco);
    banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('d', '/r', 'main', 'github', 'k');
      INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em) VALUES ('sem-pi', 'd', '2026-01-01', '2026-01-02', '', 't');
      INSERT INTO demanda VALUES ('I-1', 'd', 't', 'funcionalidade', 'd', 'em_execucao', '2026-10-11T12:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1');
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
        VALUES ('I-1', 1, 'implementar', 'em_execucao', '2026-10-11T12:00:00.000Z');
      INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 's1');
      INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES ('e1', 's1', '2026-10-11T12:00:00.000Z', 0)`);
    condutor.recuperarNaSubida(banco);
    assert.equal(banco.prepare("SELECT estado FROM ticket_demanda").get()?.estado, "falhou");
  } finally {
    fechar();
  }
});

test("consultar repassa a resposta e o Uso da consulta, e o undefined do pi que falhou", async () => {
  const pi =
    (codigo: number): typeof executar =>
    () =>
      Promise.resolve({ codigo, saida: "resposta", erro: "", limiteEstourado: false });
  assert.deepEqual(await condutor.consultar("pergunta", undefined, 1000, pi(0)), { saida: "resposta", uso: [] });
  assert.equal(await condutor.consultar("pergunta", undefined, 1000, pi(1)), undefined);
});

/** Um pi falso em `[ao vivo]` (que não termina sozinho) lançado pelo AmbienteContainer, com o condutor acompanhando-o. */
async function lancarPiNoContainer() {
  const dir = mkdtempSync(join(base, "container-"));
  const dirDoDockerFalso = join(dir, "docker");
  const docker = instalarDockerFalso(dirDoDockerFalso);
  const { id: container_id } = docker.semearContainer({});
  const ambienteContainer = new AmbienteContainer({
    id: "amb-1",
    container_id,
    bin_do_pacote: join(dir, "pacote-pi", "bin"),
    dir_do_pi: dirDoPiDoAmbiente(dir, "amb-1"),
    url_da_api: "http://host.docker.internal:3000",
  });
  const id = `ticket-no-container-${String(++n)}`;
  let grupoDoPi = 0;
  const fim = condutor.acompanhar(id, () =>
    condutor.iniciar({
      execucao: { id, sessaoPi: id, modo: "autonomo" },
      args: [],
      cwd: dir,
      ambiente: ambienteContainer,
      env: { ...process.env },
      log: join(dir, "log"),
      prompt: "[ao vivo]",
      limiteMin: 1,
      aoLancar: (grupo) => {
        grupoDoPi = grupo;
      },
    }),
  );
  const arquivoDoPid = () => join(dirDoDockerFalso, "pids", container_id, String(grupoDoPi));
  await ate(
    () => grupoDoPi !== 0 && existsSync(arquivoDoPid()) && readFileSync(arquivoDoPid(), "utf8").trim() !== "",
    "o pi no container",
  );
  const grupoNoHost = Number(readFileSync(arquivoDoPid(), "utf8"));
  const sinaisPeloDocker = () =>
    docker
      .registro()
      .filter(
        ([comando, alvo, , , roteiro]) =>
          comando === "exec" && alvo === container_id && String(roteiro).startsWith("kill -"),
      )
      .map(([, , , , roteiro]) => String(roteiro).split(" ")[1]);
  const piEstaVivo = () => {
    try {
      process.kill(-grupoNoHost, 0);
      return true;
    } catch {
      return false;
    }
  };
  return { id, fim, sinaisPeloDocker, piEstaVivo, ambienteDoPi: ambienteContainer };
}

test("interromper sinaliza o pi pelo Ambiente que o lançou: SIGTERM por docker exec dentro do container", async () => {
  const { id, fim, sinaisPeloDocker, piEstaVivo } = await lancarPiNoContainer();
  assert.equal(piEstaVivo(), true);
  assert.equal(condutor.interromper(id), true);
  await fim;
  condutor.deixarDeAcompanhar(id);
  // Depois do fim, o harness ainda manda TERM e KILL de limpeza; o que prova o caminho é o primeiro sinal.
  assert.equal(sinaisPeloDocker()[0], "-TERM");
  assert.equal(piEstaVivo(), false);
});

test("a parada do serviço passado o limite mata o pi pelo Ambiente que o lançou: SIGKILL por docker exec", async () => {
  const { id, fim, sinaisPeloDocker, piEstaVivo } = await lancarPiNoContainer();
  await condutor.aguardarTodos(50);
  await fim;
  condutor.deixarDeAcompanhar(id);
  assert.equal(sinaisPeloDocker()[0], "-KILL");
  assert.equal(piEstaVivo(), false);
});
