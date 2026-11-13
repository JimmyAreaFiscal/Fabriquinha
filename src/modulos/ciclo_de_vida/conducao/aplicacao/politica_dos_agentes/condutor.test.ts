// Condutor (F4 §2, §5.4, §6.6, §6.7) com um pi falso de verdade: a recusa de um comando na autônoma e na interativa, o
// relógio da autônoma parado enquanto um diálogo espera, o diálogo que expira, o aborto e a atividade do agente.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { abrirBancoTemporario } from "../../../../../../apoio-testes/banco/banco_temporario.ts";
import { instalarDockerFalso } from "../../../../../../apoio-testes/falsos/docker_falso.ts";
import { instalarPiFalso, type PassoPi } from "../../../../../../apoio-testes/falsos/pi_falso.ts";
import {
  AmbienteContainer,
  AmbienteHostLocal,
  gestaoQueSoUsa,
} from "../../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import type { executar } from "../../../../../shared/infra/processo.ts";
import { RESPOSTA_FORA_DA_REVISAO, triarPergunta } from "./auditor_automatico.ts";
import { type Relogio, relogioFixo } from "../../../../../shared/nucleo/relogio.ts";
import { falhaPorServicoReiniciado, falhaQueExigeOAuditor, type EtapaTicket } from "../../../etapas/publico.ts";
import { type Harness, type LancamentoDoTicket, MotorDasSessoes } from "../../../../sessoes/publico.ts";
import type { MensagemDoAgente } from "../../../../sessoes/harness/publico.ts";
import { HarnessPi } from "../../../../../../apoio-testes/sessoes_de_teste.ts";
import {
  atividadeDo,
  condutor,
  iniciarProcessoDoTicket,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type PedidoDeProcesso,
} from "./condutor.ts";
import { recuperarAposReinicio } from "../../../../../server/fluxos/ciclo_do_servico/recuperacao_apos_reinicio.ts";

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
// O silêncio aceito no teste da ferramenta longa (0,02 min = 1,2 s) folga o bastante para os eventos seguidos do pi falso
// chegarem sob a carga da suíte inteira (com 300 ms, o fim da resposta às vezes chegava depois do vigia); a ferramenta
// fica calada o dobro dele.
const SILENCIO_ACEITO_NO_TESTE_DA_FERRAMENTA_MIN = 0.02;
const ferramentaLonga: PassoPi = {
  eventos: [
    { type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "docker build ." } },
    { pausaMs: 2400 },
    { type: "tool_execution_end", toolCallId: "b1", toolName: "bash", result: {}, isError: false },
    // O pi que fecha uma mensagem sem `message` não derruba o ouvinte do condutor.
    { type: "message_end" },
  ],
};

let n = 0;
/** O lançamento de um ticket na pasta `dir`, sem skills nem modelo: o que o condutor conduz, sem o motor por trás. */
const lancamentoDeTeste = (
  dir: string,
  sessao: string,
  modo: LancamentoDoTicket["modo"] = "autonomo",
): LancamentoDoTicket => ({
  tipo: "ticket",
  raiz: dir,
  sessao,
  dir,
  skills: [],
  modelo: undefined,
  modo,
  repositorio: dir,
});
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
  const fim = iniciarProcessoDoTicket(
    {
      execucao: { id: sessao, sessao, modo },
      // Sem banco: o agente sem token.
      lancamento: lancamentoDeTeste(dir, sessao, modo),
      cwd: dir,
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
  // 0,02 min = 1,2 s: o diálogo fica pendente por mais tempo que isso sem a execução estourar o limite. Com 300 ms, a
  // subida do pi falso sob a carga da suíte inteira já gastava o limite antes do primeiro diálogo.
  const { sessao, fim } = rodar([{ eventos: dialogos }], "autonomo", 0.02);
  await ate(() => (condutor.situacao(sessao)?.dialogos.length ?? 0) === 2, "os dois diálogos");
  assert.ok(condutor.situacao(sessao)?.dialogos.find((d) => d.id === "c1")?.expiraEm);
  await ate(() => condutor.situacao(sessao)?.dialogos.length === 1, "a expiração do confirm");
  await dormir(1500);
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
  const desassinar = condutor.assinar(sessao, (evento) => noChat.push({ ...evento }));
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
function triagemComSaida(etapa: EtapaTicket, saidaDoModelo: string): NonNullable<PedidoDeProcesso["triarPergunta"]> {
  const piDaTriagem: typeof executar = () =>
    Promise.resolve({ codigo: 0, saida: saidaDoModelo, erro: "", limiteEstourado: false });
  return (p) => {
    condutor.montarHarness(new HarnessPi(piDaTriagem));
    return triarPergunta(undefined, { ticket: "I-7.T3", etapa, demanda: "Cadastro" }, p);
  };
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
    await rodar(
      [{ ...ferramentaLonga, termina: "assenta" }],
      "autonomo",
      1,
      undefined,
      SILENCIO_ACEITO_NO_TESTE_DA_FERRAMENTA_MIN,
    ).fim,
    undefined,
  );

  const ociosa = rodar(
    [{ ...ferramentaLonga, termina: "assenta" }],
    "interativo",
    1,
    undefined,
    SILENCIO_ACEITO_NO_TESTE_DA_FERRAMENTA_MIN,
  );
  await ate(() => condutor.situacao(ociosa.sessao)?.ocupado === false, "a sessão ociosa");
  await dormir(1500);
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
    const retratoEsperado = encerrada ? ["message_end"] : ["message_start", "message_update"];
    // Com a suíte inteira em paralelo, o pi falso pode levar mais que um intervalo fixo para emitir os eventos: espera o
    // retrato chegar, assinando e desassinando, em vez de dormir um tempo fixo.
    const tiposDoRetratoAtual = () => {
      const tipos: string[] = [];
      condutor.assinar(execucao.sessao, (evento) => tipos.push(evento.type))();
      return tipos;
    };
    await ate(() => isDeepStrictEqual(tiposDoRetratoAtual(), retratoEsperado), "o retrato da mensagem");
    const recebidos: string[] = [];
    const pararRetrato = condutor.assinar(execucao.sessao, (evento) => recebidos.push(evento.type));
    assert.deepEqual(recebidos, retratoEsperado);
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
    atividadeDo({ type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "src/a.ts" } }),
    "read src/a.ts",
  );
  assert.equal(atividadeDo({ type: "tool_execution_start", toolCallId: "l1", toolName: "ls", args: {} }), "ls");
  const longo = "x".repeat(120);
  const fala = (content: MensagemDoAgente["content"]) =>
    atividadeDo({ type: "message_end", message: { role: "assistant", content } });
  assert.equal(fala([{ type: "text", text: `\n  ${longo}\noutra` }]), `${"x".repeat(99)}…`);
  assert.equal(fala("texto solto"), undefined);
  assert.equal(fala([{ type: "toolCall" }]), undefined);
  assert.equal(atividadeDo({ type: "message_end" }), undefined);
  assert.equal(atividadeDo({ type: "agent_start" }), undefined);
});

/** Um processo de verdade em grupo próprio, que só termina quando alguém o mata; `morto` resolve com o sinal que o matou. */
function processoEmGrupoProprio() {
  const processo = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  return { pgid: processo.pid ?? 0, morto: once(processo, "exit") };
}

test("recuperarNaSubida mata o grupo órfão do ticket e fecha o que dependia dele", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    const daTicket = processoEmGrupoProprio();
    banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
        VALUES ('d', '/nao/existe', 'main', 'github', 'k');
      INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'd', 't', 'funcionalidade', 'd', 'em_execucao', '2026-10-11T12:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
        VALUES ('I-1', 1, 'implementar', 'em_execucao', '2026-10-11T12:00:00.000Z');
      INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 's1');
      INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha, grupo_processo) VALUES ('e1', 's1', '2026-10-11T12:00:00.000Z', 0, ${String(daTicket.pgid)})`);

    await recuperarAposReinicio(banco);

    assert.deepEqual(await daTicket.morto, [null, "SIGKILL"]);
    assert.partialDeepStrictEqual(banco.prepare("SELECT * FROM processo_do_trabalho").get(), { falha: 1 });
    assert.equal(banco.prepare("SELECT estado FROM ticket_demanda").get()?.estado, "falhou");
  } finally {
    fechar();
  }
});

test("recuperarNaSubida ignora o processo que nunca chegou a lançar o pi", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    await recuperarAposReinicio(banco);
    banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('d', '/r', 'main', 'github', 'k');
      INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'd', 't', 'funcionalidade', 'd', 'em_execucao', '2026-10-11T12:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
        VALUES ('I-1', 1, 'implementar', 'em_execucao', '2026-10-11T12:00:00.000Z');
      INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 's1');
      INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES ('e1', 's1', '2026-10-11T12:00:00.000Z', 0)`);
    await recuperarAposReinicio(banco);
    assert.equal(banco.prepare("SELECT estado FROM ticket_demanda").get()?.estado, "falhou");
  } finally {
    fechar();
  }
});

const EM = "2026-10-11T12:00:00.000Z";

/** Um ticket em execução com um processo aberto, de um pi que a instância anterior lançou no Ambiente `ambienteId`. */
function ticketComProcessoAberto(banco: DatabaseSync, ambienteId: string, grupoProcesso: number): void {
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('d', '/nao/existe', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'd', 't', 'funcionalidade', 'd', 'em_execucao', '${EM}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'em_execucao', '${EM}');
    INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 's1')`);
  banco
    .prepare(
      "INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha, grupo_processo, ambiente_id) VALUES ('e1', 's1', ?, 0, ?, ?)",
    )
    .run(EM, grupoProcesso, ambienteId);
}

test("recuperarNaSubida não sinaliza o pi que rodou num container, que a montagem da gestão de Ambientes já limpou, e fecha o ticket como serviço reiniciado", async () => {
  const dir = mkdtempSync(join(base, "recuperacao-"));
  const docker = instalarDockerFalso(join(dir, "docker"));
  const { banco, fechar } = abrirBancoTemporario();
  try {
    ticketComProcessoAberto(banco, "amb-1", 4321);

    await recuperarAposReinicio(banco);

    assert.deepEqual(docker.registro(), []);
    assert.partialDeepStrictEqual(banco.prepare("SELECT * FROM processo_do_trabalho").get(), { falha: 1 });
    assert.partialDeepStrictEqual(banco.prepare("SELECT * FROM tentativa").get(), {
      resultado_tipo: "falha_infraestrutura",
      causa: "servico_reiniciado",
      motivo: "serviço reiniciado",
    });
  } finally {
    fechar();
  }
});

test("o lançamento que o harness recusa rejeita o iniciar e não deixa a sessão em curso", async () => {
  const recusa = new ErroDeRegra("a sessão s-recusada tem 2 arquivos", "deixe só um");
  const harnessQueRecusa = {
    lancar: () => {
      throw recusa;
    },
  } as unknown as Harness;
  const condutorQueRecusa = new MotorDasSessoes(harnessQueRecusa);
  condutorQueRecusa.montarAmbientes(gestaoQueSoUsa(new AmbienteHostLocal()));
  await assert.rejects(
    condutorQueRecusa.lancarExecucao({
      execucao: { id: "s-recusada", sessao: "s-recusada", modo: "consulta" },
      lancamento: lancamentoDeTeste(base, "s-recusada"),
      cwd: base,
      log: join(base, "log-recusado"),
      prompt: undefined,
      limiteMin: 1,
      aoLancar: () => undefined,
    }),
    recusa,
  );
  assert.equal(condutorQueRecusa.emCurso("s-recusada"), false);
});

test("consultar repassa a resposta e o Uso da consulta, e o undefined do pi que falhou", async () => {
  const pi =
    (codigo: number): typeof executar =>
    () =>
      Promise.resolve({ codigo, saida: "resposta", erro: "", limiteEstourado: false });
  assert.deepEqual(await new MotorDasSessoes(new HarnessPi(pi(0))).consultar("pergunta", undefined, 1000), {
    saida: "resposta",
    uso: [],
  });
  assert.equal(await new MotorDasSessoes(new HarnessPi(pi(1))).consultar("pergunta", undefined, 1000), undefined);
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
    raiz: dir,
    url_da_api: "http://host.docker.internal:3000",
  });
  const id = `ticket-no-container-${String(++n)}`;
  let grupoDoPi = 0;
  let ambienteDoPiGravado = "";
  const fim = condutor.acompanhar(id, () =>
    iniciarProcessoDoTicket({
      execucao: { id, sessao: id, modo: "autonomo" },
      lancamento: lancamentoDeTeste(dir, id),
      cwd: dir,
      ambiente: ambienteContainer,
      log: join(dir, "log"),
      prompt: "[ao vivo]",
      limiteMin: 1,
      aoLancar: (grupo, ambienteId) => {
        grupoDoPi = grupo;
        ambienteDoPiGravado = ambienteId;
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
  return { id, fim, sinaisPeloDocker, piEstaVivo, grupoNoHost, ambienteDoPiGravado: () => ambienteDoPiGravado };
}

test("o pi no container avisa o Ambiente que o lançou; morto por sinal lá dentro sai com 137 e exige o Auditor, sem virar reinício", async () => {
  const { id, fim, grupoNoHost, ambienteDoPiGravado } = await lancarPiNoContainer();
  assert.equal(ambienteDoPiGravado(), "amb-1");
  process.kill(-grupoNoHost, "SIGKILL");
  const falha = await fim;
  condutor.deixarDeAcompanhar(id);
  assert.equal(falha?.tipo, "interrompida");
  assert.match(falha.motivo, /código 137/);
});

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
