// A devolução do Ambiente ocioso (I-312): o gate parado, o Espaço recém-preparado e o ticket falho não seguram sandbox do
// conjunto, e a retomada aloca de novo na mesma worktree. Banco real, git real, docker falso e conjunto fixo.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { Endereco } from "../../etapas/publico.ts";
import { carregarDemanda } from "../../processo/publico.ts";
import { espacoDoTicket } from "../../../repositorio/publico.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { PACOTE } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { INSTALACAO_DO_PI_FALSO } from "../../../../../apoio-testes/falsos/pi_falso.ts";
import {
  inserirAmbienteAlocado,
  ligarGestaoDeAmbientesDoTeste,
  listarAmbientes,
  modulosDoCicloDeTeste,
} from "../../../../../apoio-testes/falsos/ambiente_falso.ts";
import {
  aprovarGateDoPlanejamento,
  cenarioDePlanejamento,
  plano,
  proporPlanoDoAgente,
} from "../../../../../apoio-testes/cenarios/cenario_de_planejamento.ts";
import { ConducaoDePlanejar } from "./planejar/conducao_de_planejar.ts";
import { reservadoPeloDespacho } from "../../../../../apoio-testes/reserva_do_despacho.ts";
import { limitarTempoDoPi } from "../../../../../apoio-testes/falsos/limite_do_pi.ts";
import { devolverAmbienteDoEspaco, devolverAmbienteSeOTicketEsperaOHumano } from "./devolucao_do_ambiente.ts";
import { projetosCadastrados } from "./projetos_cadastrados.ts";

/** A demanda I-1 com imagem do Ambiente no projeto e o conjunto fixo de `capacidade` containers ligado aos módulos. */
async function cenarioComConjunto(
  t: TestContext,
  capacidade: number,
  opcoes: Parameters<typeof cenarioDePlanejamento>[0],
) {
  const cenario = cenarioDePlanejamento(opcoes);
  const { c, banco } = cenario;
  writeFileSync(join(c.repo, "requirements.txt"), "requests\n");
  banco.prepare("UPDATE projeto SET arquivos_de_dependencias = '[\"requirements.txt\"]' WHERE nome = 'loja'").run();
  const docker = instalarDockerFalso(join(c.raiz, "docker"));
  const configuracao = ConfiguracaoDoAmbiente.parse({
    tipo: "container",
    conjunto: "fixo",
    capacidade_do_conjunto: capacidade,
  });
  const piDoAuditor = join(c.raiz, "pi-do-auditor"); // o container recebe o auth.json do pi do Auditor
  mkdirSync(piDoAuditor);
  writeFileSync(join(piDoAuditor, "auth.json"), "{}");
  const servico = {
    raiz: c.raiz,
    porta_da_api: 4999,
    home_do_usuario: c.raiz,
    pacote_do_harness: PACOTE,
    instalacao_do_harness: () => INSTALACAO_DO_PI_FALSO,
    dir_do_harness_do_auditor: piDoAuditor,
  };
  await ligarGestaoDeAmbientesDoTeste(t, { banco, configuracao: () => configuracao, servico });
  return { ...cenario, docker };
}

const noGateDoPlano = { estado: "gate_planejamento", estadoDoTicket: "em_execucao", comPlano: true } as const;

/** Prepara (e, portanto, aloca) o Espaço da demanda I-1 ou o da rodada dela, como a condução do ticket faz. */
async function prepararEspacoDoTicket(banco: DatabaseSync, dono: { rodada_id?: number }) {
  const projeto = projetosCadastrados().carregarProjeto(banco, "loja");
  const espaco = espacoDoTicket(carregarDemanda(banco, "I-1"), dono, projeto, raizDo(banco));
  return { espaco, ...(await modulosDoCicloDeTeste(banco).repositorio.prepararEspaco(projeto, espaco, "/dev/null")) };
}

const situacaoDoConjunto = (banco: DatabaseSync) =>
  listarAmbientes(banco).map(({ estado, alocado_para }) => ({ estado, alocado_para }));

test("CA-2: aprovar o plano com o conjunto de 1 sandbox prepara a demanda e a rodada em sequência e devolve cada Ambiente", async (t) => {
  const { banco, c } = await cenarioComConjunto(t, 1, noGateDoPlano);
  await aprovarGateDoPlanejamento(banco);
  const dir = join(c.raiz, "worktrees", "loja", "I-1");
  for (const worktree of ["demanda", "rodadas/1"]) assert.ok(existsSync(join(dir, worktree, "preparado")), worktree);
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "livre", alocado_para: null }]);
  assert.equal(carregarDemanda(banco, "I-1").demanda.estado, "em_execucao");
});

test("CA-3: a retomada do Espaço devolvido aloca de novo e continua na mesma worktree", async (t) => {
  const { banco } = await cenarioComConjunto(t, 1, noGateDoPlano);
  await aprovarGateDoPlanejamento(banco);
  const preparadoAntes = readFileSync(join(raizDo(banco), "worktrees", "loja", "I-1", "rodadas", "1", "preparado"));
  const { pasta, espaco } = await prepararEspacoDoTicket(banco, { rodada_id: 1 });
  assert.equal(pasta, espaco.pasta);
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "alocado", alocado_para: "I-1.R1" }]);
  assert.deepEqual(readFileSync(join(pasta, "preparado")), preparadoAntes);
});

test("o ticket do plano que termina com a demanda no gate_planejamento devolve o Ambiente do Espaço da demanda", async (t) => {
  const { banco } = await cenarioComConjunto(t, 1, noGateDoPlano);
  await prepararEspacoDoTicket(banco, {});
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "alocado", alocado_para: "I-1" }]);
  await devolverAmbienteSeOTicketEsperaOHumano(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 1 });
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "livre", alocado_para: null }]);
});

test("o ticket que termina sem gate nem falha mantém o Ambiente do Espaço", async (t) => {
  const { banco } = await cenarioComConjunto(t, 1, { estado: "planejar", estadoDoTicket: "em_execucao" });
  await prepararEspacoDoTicket(banco, {});
  await devolverAmbienteSeOTicketEsperaOHumano(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 1 });
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "alocado", alocado_para: "I-1" }]);
});

test("o ticket da demanda que termina com ela em em_execucao (a revisão reprovou e abriu rodadas corretivas) devolve o Ambiente do Espaço da demanda", async (t) => {
  const { banco } = await cenarioComConjunto(t, 1, {
    estado: "em_execucao",
    estadoDoTicket: "em_execucao",
    comPlano: true,
  });
  await prepararEspacoDoTicket(banco, {});
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "alocado", alocado_para: "I-1" }]);
  await devolverAmbienteSeOTicketEsperaOHumano(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 1 });
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "livre", alocado_para: null }]);
});

test("o git do Espaço que devolveu o Ambiente roda num sandbox realocado, nunca no host, e o devolve ao fim", async (t) => {
  const { banco, docker } = await cenarioComConjunto(t, 1, noGateDoPlano);
  const { espaco } = await prepararEspacoDoTicket(banco, {});
  const modulos = modulosDoCicloDeTeste(banco);
  await devolverAmbienteDoEspaco(modulos, { demanda_id: "I-1" });
  const chamadasAntesDoGit = docker.registro().length;
  const projeto = projetosCadastrados().carregarProjeto(banco, "loja");
  await modulos.repositorio.gitNoEspaco(projeto, espaco, "rev-parse", "HEAD");
  const gitNoSandbox = docker
    .registro()
    .slice(chamadasAntesDoGit)
    .filter((argumentos) => argumentos[0] === "exec" && JSON.stringify(argumentos).includes("rev-parse"));
  assert.equal(gitNoSandbox.length, 1, "o rev-parse rodou pelo docker exec, no sandbox");
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "livre", alocado_para: null }]);
});

test("ticket inexistente não devolve nada", async (t) => {
  const { banco } = await cenarioComConjunto(t, 1, noGateDoPlano);
  await prepararEspacoDoTicket(banco, {});
  await devolverAmbienteSeOTicketEsperaOHumano(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 99 });
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "alocado", alocado_para: "I-1" }]);
});

test("com o conjunto de 2 e a rodada de outra demanda em curso, o Espaço da demanda não segura sandbox e a integração realoca a rodada na mesma worktree", async (t) => {
  const { banco } = await cenarioComConjunto(t, 2, noGateDoPlano);
  inserirAmbienteAlocado(banco, {
    id: "amb-I-9",
    container_id: "c-I-9",
    imagem: "alpine",
    alocado_para: "I-9.R1",
    criado_em: "2026-01-01T00:00:00.000Z",
  });
  await aprovarGateDoPlanejamento(banco);
  const { pasta } = await prepararEspacoDoTicket(banco, { rodada_id: 1 }); // a rodada de I-1 trabalha
  assert.deepEqual(
    situacaoDoConjunto(banco).map((a) => a.alocado_para),
    ["I-9.R1", "I-1.R1"],
  );
  banco.prepare("UPDATE rodada SET estado = 'gate_pr' WHERE demanda_id = 'I-1' AND rodada_id = 1").run();
  await devolverAmbienteSeOTicketEsperaOHumano(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 2 });
  assert.deepEqual(
    situacaoDoConjunto(banco).map((a) => a.alocado_para),
    ["I-9.R1", null],
  );
  const integracao = await prepararEspacoDoTicket(banco, { rodada_id: 1 }); // a integração do PR aloca de novo
  assert.equal(integracao.pasta, pasta);
  assert.deepEqual(
    situacaoDoConjunto(banco).map((a) => a.alocado_para),
    ["I-9.R1", "I-1.R1"],
  );
});

test("a rodada no gate_pr devolve o Ambiente dela e não toca o da demanda", async (t) => {
  const { banco } = await cenarioComConjunto(t, 2, noGateDoPlano);
  await aprovarGateDoPlanejamento(banco);
  await prepararEspacoDoTicket(banco, {});
  await prepararEspacoDoTicket(banco, { rodada_id: 1 });
  const modulos = modulosDoCicloDeTeste(banco);
  const ticketDaRodada = { demanda_id: "I-1", ticket_id: 2 };
  await devolverAmbienteSeOTicketEsperaOHumano(modulos, ticketDaRodada);
  assert.deepEqual(
    situacaoDoConjunto(banco).map((a) => a.estado),
    ["alocado", "alocado"],
    "a rodada ainda trabalha",
  );
  banco.prepare("UPDATE rodada SET estado = 'gate_pr' WHERE demanda_id = 'I-1' AND rodada_id = 1").run();
  await devolverAmbienteSeOTicketEsperaOHumano(modulos, ticketDaRodada);
  assert.deepEqual(situacaoDoConjunto(banco), [
    { estado: "alocado", alocado_para: "I-1" },
    { estado: "livre", alocado_para: null },
  ]);
});

test("o ticket falho espera o Auditor sem segurar o Ambiente", async (t) => {
  const { banco } = await cenarioComConjunto(t, 1, noGateDoPlano);
  await aprovarGateDoPlanejamento(banco);
  await prepararEspacoDoTicket(banco, { rodada_id: 1 });
  banco.prepare("UPDATE ticket_demanda SET estado = 'falhou' WHERE demanda_id = 'I-1' AND ticket_id = 2").run();
  await devolverAmbienteSeOTicketEsperaOHumano(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 2 });
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "livre", alocado_para: null }]);
});

test("a falha ao devolver só vai ao log e o Ambiente segue alocado", async (t) => {
  const { banco, c } = await cenarioComConjunto(t, 1, noGateDoPlano);
  await prepararEspacoDoTicket(banco, {});
  const modulos = modulosDoCicloDeTeste(banco);
  const repositorio = {
    ...modulos.repositorio,
    devolverAmbiente: () => Promise.reject(new Error("docker fora do ar")),
  };
  await devolverAmbienteDoEspaco({ ...modulos, repositorio }, { demanda_id: "I-1" });
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "devolucao-I-1.log"), "utf8"),
    /devolver o Ambiente falhou: docker fora do ar/,
  );
  assert.deepEqual(situacaoDoConjunto(banco), [{ estado: "alocado", alocado_para: "I-1" }]);
});

/** O pi do planejar conduzido no host local, com o Repositório espiado: cada Espaço que devolve o Ambiente vai a `devolvidos`. */
function planejarComEspiaDaDevolucao(banco: DatabaseSync, minutosDeOciosidade: number) {
  limitarTempoDoPi(banco, minutosDeOciosidade);
  const modulos = modulosDoCicloDeTeste(banco);
  const devolvidos: string[] = [];
  const repositorio = {
    ...modulos.repositorio,
    devolverAmbiente: (_projeto: unknown, espaco: { dono: { demanda_id: string } }) => {
      devolvidos.push(espaco.dono.demanda_id);
      return Promise.resolve();
    },
  } as typeof modulos.repositorio;
  const fim = new ConducaoDePlanejar({ ...modulos, repositorio, relogio: relogioDoSistema, registro: anotar }).conduzir(
    reservadoPeloDespacho(banco, Endereco.doTicket("I-1", 1)),
  );
  return { modulos, devolvidos, fim };
}

test("o pi que assenta com a demanda no gate do plano é encerrado e o Espaço devolve o Ambiente", async () => {
  const { banco, prompts } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  // A ociosidade só encerraria o pi em 30 s: o encerramento em segundos tem de vir do gate.
  const { modulos, devolvidos, fim } = planejarComEspiaDaDevolucao(banco, 0.5);
  while (prompts().length === 0) await new Promise((acordar) => setTimeout(acordar, 20));
  await new Promise((acordar) => setTimeout(acordar, 100)); // o pi assenta: ocioso, à espera do Auditor
  proporPlanoDoAgente(banco, "I-1", plano()); // o plano chega e a demanda vai ao gate
  const viva = modulos.sessoes.listar({ demandas: ["I-1"] })[0]?.situacao;
  assert.ok(viva);
  modulos.sessoes.mandar(String(viva.execucao), { type: "prompt", message: "o plano foi enviado" });
  const encerradoPeloGate = await Promise.race([
    fim.then(() => true),
    new Promise((acordar) => setTimeout(acordar, 15_000, false)),
  ]);
  assert.equal(encerradoPeloGate, true);
  await fim;
  assert.deepEqual(devolvidos, ["I-1"]);
});

test("o pi que assenta antes do gate do plano segue vivo e o Espaço mantém o Ambiente", async () => {
  const { banco } = cenarioDePlanejamento({ estadoDoTicket: "em_execucao" });
  const { devolvidos, fim } = planejarComEspiaDaDevolucao(banco, 0.05);
  await fim; // a ociosidade (3 s) encerra o pi; a demanda segue em planejar, sem gate nem falha
  assert.deepEqual(devolvidos, []);
});
