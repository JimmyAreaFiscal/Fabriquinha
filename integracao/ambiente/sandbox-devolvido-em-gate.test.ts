// I-312: a demanda ou a rodada que espera o humano não segura sandbox do conjunto, no Docker de verdade. O sandbox
// volta ao conjunto livre e sem ocupante, a worktree fica no host, e o trabalho que volta aloca outro sandbox e segue
// nela. Pulado sem `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e constrói a imagem na primeira vez.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  AUDITOR,
  ConducaoDePlanejar,
  decidirGate,
  esperarPreparacoesDaAprovacao,
  despachoDasEtapas,
  Endereco,
  enviarDemanda,
} from "../../apoio-testes/ciclo_de_vida/ciclo_de_vida_internos.ts";
import { modulosDoCicloDeTeste } from "../../apoio-testes/falsos/ambiente_falso.ts";
import type { PassoPi, PiFalso } from "../../apoio-testes/falsos/pi_falso.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../../apoio-testes/repositorio_de_teste.ts";
import { reservadoPeloDespacho } from "../../apoio-testes/reserva_do_despacho.ts";
import { carregarSessoesDoContexto, motorDoBanco } from "../../apoio-testes/sessoes_de_teste.ts";
import { montarSessoesDeAgente } from "../../src/modulos/sessoes/publico.ts";
import {
  configuracaoDoAmbiente,
  salvarConfiguracaoDoAmbiente,
} from "../../src/shared/armazenamento/configuracao_do_ambiente.ts";
import { anotar } from "../../src/shared/infra/registro.ts";
import { relogioDoSistema } from "../../src/shared/nucleo/relogio.ts";
import { demandaEmExecucao, encerrar, execucoesDe, revisar, rodadaDe } from "../apoio-execucao.ts";
import { base, ciclo, criarCenario, demanda, demandaAprovada, esperar, git, proporPlanoDoAgente } from "../apoio.ts";
import type { Cenario } from "../apoio.ts";
import {
  ghFalso,
  instalarSonarFalso,
  ligarContainerAoCenario,
  projetoDeTesteEmContainer,
  raizCompartilhadaComODocker,
} from "../falsos.ts";

const gh = ghFalso(base);
await instalarSonarFalso(join(base, "bin"));

const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

const despachoComVerificacoesReais = despachoDasEtapas({
  implementacao: { opcoesSonar: { limiteMs: 60_000, intervaloMs: 1 } },
});

/** O pi do planejamento sai sozinho ao receber o prompt: interrompê-lo por sinal pede o Ambiente do processo. */
const PLANEJAMENTO_QUE_SAI_SOZINHO: PassoPi = { uso: null, sai: { codigo: 0 } };

/** O cenário com o projeto de teste no container e o conjunto fixo de `capacidade` sandboxes. */
async function cenarioComConjunto(t: TestContext, capacidade: number) {
  const c = criarCenario(t, "loja", raizCompartilhadaComODocker());
  projetoDeTesteEmContainer(c);
  const { pi, gestao } = await ligarContainerAoCenario(t, c);
  salvarConfiguracaoDoAmbiente(c.banco, {
    ...configuracaoDoAmbiente(c.banco),
    conjunto: "fixo",
    capacidade_do_conjunto: capacidade,
  });
  return { c, pi, gestao };
}

/** Quem segura sandbox agora, ordenado: o conjunto vazio de ocupantes tem todos os containers livres. */
const ocupantesDoConjunto = (c: Cenario): string[] =>
  (
    c.banco.prepare("SELECT alocado_para FROM ambiente WHERE estado = 'alocado' ORDER BY alocado_para").all() as {
      alocado_para: string;
    }[]
  ).map((linha) => linha.alocado_para);

const quantidadeDeContainers = (c: Cenario): number =>
  (c.banco.prepare("SELECT count(*) AS total FROM ambiente").get() as { total: number }).total;

/** O pi vivo da sessão está ocioso, sem diálogo aberto: a conversa espera o Auditor. */
const conversaOciosa = (c: Cenario, sessao: string): boolean => {
  const situacao = motorDoBanco(c.banco).situacao(sessao);
  return situacao?.dialogos.length === 0 && !situacao.ocupado;
};

/** Começa o planejamento da demanda: o pi do `planejar` sobe, responde e fica ocioso à espera do Auditor. */
async function iniciarPlanejamento(c: Cenario, pi: PiFalso, passos: PassoPi[]) {
  const id = await demandaAprovada(c);
  const ticket = { demanda_id: id, ticket_id: 2 };
  pi.roteirizar(passos);
  const fim = new ConducaoDePlanejar({
    ...modulosDoCicloDeTeste(c.banco),
    relogio: relogioDoSistema,
    registro: anotar,
  }).conduzir(reservadoPeloDespacho(c.banco, Endereco.doTicket(id, 2)));
  await esperar(() => carregarSessoesDoContexto(c.banco, ticket).sessoes.length === 1, "a sessão do planejamento");
  const [sessao] = carregarSessoesDoContexto(c.banco, ticket).sessoes;
  assert.ok(sessao);
  await esperar(() => pi.prompts().length === 1 && conversaOciosa(c, sessao.id), "o pi do planejamento ocioso");
  return { id, ticket, sessao: sessao.id, fim };
}

/** Leva a demanda ao `gate_planejamento`: o plano chega, o pi assenta com a demanda no gate e sai, e o sandbox volta ao conjunto. */
async function planejarAteOGate(c: Cenario, pi: PiFalso): Promise<string> {
  const { id, ticket, fim } = await iniciarPlanejamento(c, pi, [{ uso: null }, { uso: null }]);
  proporPlanoDoAgente(
    c.banco,
    id,
    {
      demanda_id: id,
      criterios: ["CA-1"],
      rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "Rodada 1", e2e: false, criterios: ["CA-1"], depende: [] }],
      tickets: [{ demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "Ticket 1.1", descricao: "d" }],
    },
    { tipo: "agente", trabalho_id: "execucao-1" },
  );
  assert.equal(demanda(c, id).demanda.estado, "gate_planejamento");
  // O agente que enviou o plano assenta: é o que faz Sessões ver o pi ocioso com a demanda no gate.
  montarSessoesDeAgente({ banco: c.banco }).mandar(String(execucoesDe(c, ticket).at(-1)?.id), {
    type: "prompt",
    message: "o plano foi enviado",
  });
  await fim;
  return id;
}

test(
  "CA-1, CA-2 e CA-3: com o conjunto de 2, duas demandas em gate_planejamento não ocupam vaga e a rodada da terceira recebe sandbox na worktree que o aprovar preparou",
  COM_DOCKER,
  async (t) => {
    const { c, pi } = await cenarioComConjunto(t, 2);

    const primeira = await planejarAteOGate(c, pi);
    assert.equal(demanda(c, primeira).demanda.estado, "gate_planejamento");
    assert.deepEqual(ocupantesDoConjunto(c), [], "o sandbox da demanda em gate voltou ao conjunto, sem ocupante");
    assert.ok(existsSync(caminhoDaWorktreeDemanda(c.raiz, c.projeto, primeira)), "a worktree ficou no host");
    const segunda = await planejarAteOGate(c, pi);
    assert.deepEqual(ocupantesDoConjunto(c), []);

    // A terceira demanda planeja e tem o plano aprovado com as duas primeiras ainda no gate.
    const terceira = await planejarAteOGate(c, pi);
    await decidirGate(
      modulosDoCicloDeTeste(c.banco),
      "gate_planejamento",
      Endereco.daDemanda(terceira),
      { resultado: "aprovado" },
      AUDITOR,
    );
    await esperarPreparacoesDaAprovacao();
    assert.equal(demanda(c, terceira).demanda.estado, "em_execucao");
    assert.deepEqual(ocupantesDoConjunto(c), []);
    const worktreeDaRodada = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: terceira, rodada_id: 1 });
    assert.ok(existsSync(worktreeDaRodada), "o aprovar preparou a worktree da rodada");

    // A rodada começa: recebe um sandbox, sem o erro de conjunto cheio, e segue na worktree que o aprovar preparou.
    pi.roteirizar([{ escreve: { "feature.txt": "linha\n" }, uso: null }]);
    await ciclo(c, despachoComVerificacoesReais);
    assert.equal(rodadaDe(c, terceira, 1)?.estado, "revisar_rodada");
    assert.deepEqual(ocupantesDoConjunto(c), [Endereco.daRodada(terceira, 1).toString()]);
    assert.ok(quantidadeDeContainers(c) <= 2);
    assert.equal(git(worktreeDaRodada, "log", "-1", "--format=%an"), "Fabriquinha");
    assert.equal(demanda(c, primeira).demanda.estado, "gate_planejamento");
    assert.equal(demanda(c, segunda).demanda.estado, "gate_planejamento");
  },
);

test(
  "CA-4: a mensagem do Auditor depois da devolução do sandbox aloca outro, retoma o pi com o mesmo session-id na mesma worktree e a resposta chega à conversa",
  COM_DOCKER,
  async (t) => {
    const { c, pi, gestao } = await cenarioComConjunto(t, 2);
    const { id, ticket, sessao, fim } = await iniciarPlanejamento(c, pi, [
      { resposta: "plano em conversa", uso: null },
      { resposta: "voltei depois da devolução", uso: null },
    ]);
    const sessoes = montarSessoesDeAgente({ banco: c.banco });
    const primeiraExecucao = execucoesDe(c, ticket).at(-1);
    assert.ok(primeiraExecucao);

    // O pi sai e o sandbox volta ao conjunto: a sessão fica sem processo e sem Ambiente, só com a worktree no host.
    await sessoes.encerrar(primeiraExecucao.id);
    await fim;
    for (const { id: ambienteId } of c.banco.prepare("SELECT id FROM ambiente WHERE alocado_para = ?").all(id) as {
      id: string;
    }[])
      await gestao.limpar(ambienteId);
    assert.deepEqual(ocupantesDoConjunto(c), []);

    // A mensagem do Auditor aloca outro sandbox e retoma a mesma sessão.
    assert.equal(enviarDemanda(modulosDoCicloDeTeste(c.banco), sessao, "o plano ficou claro?", "prompt"), true);
    await esperar(() => pi.prompts().length === 2 && conversaOciosa(c, sessao), "a resposta do pi retomado");
    assert.deepEqual(ocupantesDoConjunto(c), [id]);

    const inicios = pi.registro().filter((entrada) => entrada.evento === "inicio");
    assert.equal(inicios.length, 2);
    assert.deepEqual(
      inicios.map((entrada) => entrada.argv?.[entrada.argv.indexOf("--session-id") + 1]),
      [sessao, sessao],
    );
    const [antes, depois] = pi.prompts();
    assert.equal(depois?.cwd, antes?.cwd, "o pi retomado roda na mesma worktree");
    const respostas = sessoes
      .conversa(sessao)
      .entradas.map((entrada) => (entrada as { message?: { role: string; content: unknown } }).message)
      .filter((mensagem) => mensagem?.role === "assistant")
      .map((mensagem) => JSON.stringify(mensagem?.content));
    assert.ok(respostas.some((resposta) => resposta.includes("voltei depois da devolução")));

    const segundaExecucao = execucoesDe(c, ticket).at(-1);
    assert.notEqual(segundaExecucao?.id, primeiraExecucao.id);
    await sessoes.encerrar(String(segundaExecucao?.id));
  },
);

test(
  "e2e da rodada: com o conjunto de 1, o Espaço da demanda não segura vaga enquanto a rodada trabalha, e o encerramento e a integração realocam",
  COM_DOCKER,
  async (t) => {
    gh.zerar();
    const { c, pi } = await cenarioComConjunto(t, 1);
    const id = await demandaEmExecucao(c, [{ tickets: 1 }], PLANEJAMENTO_QUE_SAI_SOZINHO);
    assert.deepEqual(ocupantesDoConjunto(c), []);

    // Só a rodada trabalha: o Espaço da demanda não está entre os ocupantes do conjunto de uma vaga.
    pi.roteirizar([{ escreve: { "feature.txt": "linha\n" }, uso: null }]);
    await ciclo(c, despachoComVerificacoesReais);
    assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");
    assert.deepEqual(ocupantesDoConjunto(c), [Endereco.daRodada(id, 1).toString()]);

    // O encerramento aloca de novo e, com o PR esperando o Auditor, devolve.
    await revisar(c, id, { resultado: "aprovado" });
    await encerrar(c, id);
    assert.equal(rodadaDe(c, id, 1)?.estado, "gate_pr");
    assert.deepEqual(ocupantesDoConjunto(c), []);

    // A integração aloca de novo para integrar o PR e devolve.
    await decidirGate(
      modulosDoCicloDeTeste(c.banco),
      "gate_pr",
      Endereco.daRodada(id, 1),
      { resultado: "aprovado", nota: 5 },
      AUDITOR,
    );
    assert.equal(rodadaDe(c, id, 1)?.estado, "concluida");
    assert.deepEqual(ocupantesDoConjunto(c), []);
  },
);
