// O ciclo do Espaço com git real (origin bare) e hospedagem falsa.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { instalarDockerFalso } from "../../../apoio-testes/docker_falso.ts";
import { commitarArquivo, criarRepositorioDeTeste, rodarGit } from "../../../apoio-testes/repositorio_de_teste.ts";
import { hospedagemFalsa } from "../../../apoio-testes/hospedagem_falsa.ts";
import { migrar } from "../../armazenamento/banco.ts";
import { MIGRACOES } from "../../armazenamento/migracoes.ts";
import { listarAmbientes } from "../../armazenamento/ambientes.ts";
import { salvarConfiguracaoDoAmbiente } from "../../armazenamento/servico.ts";
import { GeradorDeAmbientes } from "../../infra/ambiente/container/gerador_de_ambientes.ts";
import { ConjuntoDeAmbientes } from "../ambiente/conjunto.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { espacoDaDemanda, espacoDaRodada } from "../../nucleo/espaco_de_trabalho.ts";
import { AmbienteHostLocal } from "../../infra/ambiente/ambiente_host_local.ts";
import { naFilaDoProjeto } from "../../infra/repositorio/worktree.ts";
import { CicloDoEspacoDaDemanda, CicloDoEspacoDaRodada, cicloDoEspaco } from "./ciclo_do_espaco.ts";

const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-ciclo-")));
const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});
after(() => {
  rmSync(temporario, { recursive: true, force: true });
});

const DEMANDA = "I-1";
const ambiente = new AmbienteHostLocal();

function cenario(comandosDePreparacao: string[] = []) {
  const c = criarRepositorioDeTeste(comandosDePreparacao);
  const registro = { raiz: c.raiz, log: c.log };
  const espacoDemanda = espacoDaDemanda(c.projeto, DEMANDA, c.raiz);
  const espacoRodada = espacoDaRodada(c.projeto, DEMANDA, 1, c.raiz);
  const prAberto = { numero: 1, url: "https://github.com/org/loja/pull/1", head: "a", estado: "aberto" } as const;
  return {
    c,
    espacoDemanda,
    espacoRodada,
    daDemanda: () => new CicloDoEspacoDaDemanda(espacoDemanda, c.projeto, registro, ambiente),
    daRodada: () => new CicloDoEspacoDaRodada(espacoRodada, c.projeto, registro, ambiente),
    daRodadaComPr: () => new CicloDoEspacoDaRodada({ ...espacoRodada, pr: prAberto }, c.projeto, registro, ambiente),
  };
}

test("criar da demanda: cria da base com a posse, prepara uma vez e só diz que buscou a base na primeira", async () => {
  const { c, espacoDemanda, daDemanda } = cenario(["printf x >> preparado"]);
  const primeira = await daDemanda().criar();
  assert.deepEqual(primeira, { pasta: espacoDemanda.pasta, buscouBase: true });
  assert.equal(
    rodarGit(c.repo, "config", "--get", `branch.${espacoDemanda.branch}.fabriquinha`),
    `demanda:${primeira.pasta}`,
  );
  const segunda = await daDemanda().criar();
  assert.deepEqual(segunda, { pasta: espacoDemanda.pasta, buscouBase: false });
  assert.equal(readFileSync(join(primeira.pasta, "preparado"), "utf8"), "x");
});

test("a fila git do projeto fica livre depois do criar(), e a falha da varredura só vai ao log", async () => {
  const { c, daDemanda } = cenario();
  const ciclo = daDemanda();
  assert.equal((await ciclo.criar()).buscouBase, true);
  let entrouNaFila = false;
  // A varredura roda depois do criar(), fora da fila: ela consegue entrar na fila por conta própria.
  await naFilaDoProjeto(c.raiz, c.projeto.nome, () => {
    entrouNaFila = true;
    return Promise.resolve();
  });
  assert.equal(entrouNaFila, true);
  await Promise.reject(new Error("varredura indisponível")).catch(ciclo.anotarFalhaDaVarredura);
  assert.match(readFileSync(c.log, "utf8"), /varrerBase falhou: varredura indisponível\n/);
});

test("criar da rodada nasce da ponta da demanda e nunca busca a base; atualizar traz o que a demanda avançou", async () => {
  const { c, espacoRodada, daDemanda, daRodada } = cenario();
  const { pasta: demanda } = await daDemanda().criar();
  const { pasta, buscouBase } = await daRodada().criar();
  assert.equal(pasta, espacoRodada.pasta);
  assert.equal(buscouBase, false);
  assert.equal(rodarGit(c.repo, "config", "--get", `branch.${espacoRodada.branch}.fabriquinha`), `rodada:${pasta}`);
  assert.deepEqual(await daRodada().atualizarComBase(), { status: "sem_alteracao" });
  commitarArquivo(demanda, "novo.txt", "novo\n");
  assert.deepEqual(await daRodada().atualizarComBase(), { status: "atualizada" });
  assert.equal(readFileSync(join(pasta, "novo.txt"), "utf8"), "novo\n");
});

test("integrar da rodada integra o PR pela hospedagem e avança a demanda local em fast-forward", async () => {
  const { c, espacoDemanda, espacoRodada, daDemanda, daRodada, daRodadaComPr } = cenario();
  await daDemanda().criar();
  const { pasta } = await daRodada().criar();
  const commitDaRodada = commitarArquivo(pasta, "a.txt", "a\n");
  rodarGit(c.repo, "push", "-q", "origin", espacoDemanda.branch, espacoRodada.branch);
  hospedagem.abrirPr({
    head: espacoRodada.branch,
    base: espacoDemanda.branch,
    titulo: "t",
    corpo: "c",
    estado: "aberto",
  });
  await daRodadaComPr().integrar();
  assert.equal(hospedagem.prs()[0]?.estado, "mergeado");
  rodarGit(c.repo, "merge-base", "--is-ancestor", commitDaRodada, espacoDemanda.branch);
  assert.equal(
    rodarGit(c.repo, "rev-parse", espacoDemanda.branch),
    rodarGit(c.bare, "rev-parse", espacoDemanda.branch),
  );
});

test("o ciclo da rodada recusa o Espaço sem PR e o que não é de rodada", async () => {
  const { c, espacoDemanda, daRodada } = cenario();
  await assert.rejects(daRodada().integrar(), /não tem PR publicado/);
  const semRodada = new CicloDoEspacoDaRodada(espacoDemanda, c.projeto, { raiz: c.raiz, log: c.log }, ambiente);
  await assert.rejects(semRodada.criar(), ErroDeRegra);
  await assert.rejects(semRodada.atualizarComBase(), ErroDeRegra);
});

test("o ciclo da demanda não atualiza com a base nem integra: o PR final é do humano", async () => {
  const { daDemanda } = cenario();
  await assert.rejects(daDemanda().atualizarComBase(), /não atualiza.*com a base/);
  await assert.rejects(daDemanda().integrar(), /não integra o PR final/);
});

test("cicloDoEspaco escolhe o ciclo pelo dono do Espaço", () => {
  const { c, espacoDemanda, espacoRodada } = cenario();
  const registro = { raiz: c.raiz, log: c.log };
  assert.ok(cicloDoEspaco(espacoDemanda, c.projeto, registro, ambiente) instanceof CicloDoEspacoDaDemanda);
  assert.ok(cicloDoEspaco(espacoRodada, c.projeto, registro, ambiente) instanceof CicloDoEspacoDaRodada);
});

test("limpar remove a worktree e as branches do Espaço, local e remota, e nada além dele", async () => {
  const { c, espacoDemanda, espacoRodada, daDemanda, daRodada } = cenario();
  await daDemanda().criar();
  const { pasta } = await daRodada().criar();
  rodarGit(c.repo, "push", "-q", "origin", espacoRodada.branch);
  const resultado = await daRodada().limpar();
  assert.deepEqual(resultado.pendentes, []);
  assert.deepEqual(resultado.removidos.sort(), [
    `branch_local:${espacoRodada.branch}`,
    `branch_remota:${espacoRodada.branch}`,
    `worktree:${pasta}`,
  ]);
  assert.equal(existsSync(pasta), false);
  assert.equal(existsSync(espacoDemanda.pasta), true);
  assert.notEqual(rodarGit(c.repo, "for-each-ref", "--format=%(refname)", `refs/heads/${espacoDemanda.branch}`), "");
});

test("limpar com a lista de pendências de uma passada anterior repete só ela", async () => {
  const { c, espacoDemanda, espacoRodada, daDemanda, daRodada } = cenario();
  await daDemanda().criar();
  const { pasta } = await daRodada().criar();
  const resultado = await daRodada().limpar([`worktree:${pasta}`]);
  assert.deepEqual(resultado, { removidos: [`worktree:${pasta}`], pendentes: [] });
  assert.equal(existsSync(espacoDemanda.pasta), true);
  assert.notEqual(rodarGit(c.repo, "for-each-ref", "--format=%(refname)", `refs/heads/${espacoRodada.branch}`), "");
});

test("o ciclo expõe o Ambiente com que foi criado", () => {
  const { daDemanda, daRodada } = cenario();
  assert.equal(daDemanda().ambiente, ambiente);
  assert.equal(daRodada().ambiente, ambiente);
});

function cenarioComContainer() {
  const { c, espacoDemanda, espacoRodada } = cenario();
  const docker = instalarDockerFalso(join(temporario, `docker-${String(Math.random())}`));
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  salvarConfiguracaoDoAmbiente(banco, {
    tipo: "container",
    memoria_maxima_mb: 512,
    cpus: 1,
    ociosidade_para_eliminar_min: 30,
  });
  const conjunto = new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes());
  const registro = { raiz: c.raiz, log: c.log };
  const projeto = { ...c.projeto, imagem_do_ambiente: "alpine" };
  return {
    c,
    docker,
    banco,
    cicloDaDemanda: (projetoDoCiclo: typeof c.projeto & { imagem_do_ambiente?: string } = projeto) =>
      new CicloDoEspacoDaDemanda(espacoDemanda, projetoDoCiclo, registro, ambiente, conjunto),
    cicloDaDemandaNoHostLocal: () => new CicloDoEspacoDaDemanda(espacoDemanda, projeto, registro, ambiente, undefined),
    cicloDaRodada: () => new CicloDoEspacoDaRodada(espacoRodada, projeto, registro, ambiente, conjunto),
  };
}

test("com container e imagem, criar aloca o container ao Espaço e limpar o devolve livre", async () => {
  const { banco, docker, cicloDaDemanda } = cenarioComContainer();
  await cicloDaDemanda().criar();
  const [alocado] = listarAmbientes(banco);
  assert.equal(alocado?.estado, "alocado");
  assert.equal(alocado.alocado_para, "I-1");
  await cicloDaDemanda().criar();
  assert.equal(listarAmbientes(banco).length, 1);
  await cicloDaDemanda().limpar();
  assert.equal(listarAmbientes(banco)[0]?.estado, "livre");
  assert.equal(docker.containers().length, 1);
});

test("com container, criar da rodada também aloca", async () => {
  const { banco, cicloDaDemanda, cicloDaRodada } = cenarioComContainer();
  await cicloDaDemanda().criar();
  await cicloDaRodada().criar();
  assert.deepEqual(
    listarAmbientes(banco)
      .map((a) => a.alocado_para)
      .sort(),
    ["I-1", "I-1.R1"],
  );
});

test("limpar com pendência não devolve o container ao conjunto", async () => {
  const { banco, cicloDaDemanda } = cenarioComContainer();
  await cicloDaDemanda().criar();
  const resultado = await cicloDaDemanda().limpar(["desconhecido:x"]);
  assert.deepEqual(resultado.pendentes, ["desconhecido:x"]);
  assert.equal(listarAmbientes(banco)[0]?.estado, "alocado");
});

test("sem conjunto (host local) ou sem imagem no Projeto o docker nunca é chamado", async () => {
  const { c, docker, banco, cicloDaDemanda, cicloDaDemandaNoHostLocal } = cenarioComContainer();
  await cicloDaDemanda(c.projeto).criar();
  await cicloDaDemanda(c.projeto).limpar();
  const hostLocal = cicloDaDemandaNoHostLocal();
  await hostLocal.criar();
  await hostLocal.limpar();
  assert.deepEqual(docker.registro(), []);
  assert.deepEqual(listarAmbientes(banco), []);
});
