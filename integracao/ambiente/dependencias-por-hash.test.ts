// I-313.R1: o Ambiente pronto para as mesmas dependências (o hash do arquivo de dependências e do lockfile) é reusado sem
// reinstalar, no Docker de verdade. O projeto é ESM (`"type": "module"`): o `import` da dependência só acha o `node_modules`
// ligado na worktree, o NODE_PATH da imagem não vale para ele. Pulado sem `FABRIQUINHA_TESTE_DOCKER`.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { preparar } from "../../src/modulos/repositorio/espaco_de_trabalho/infra/worktree.ts";
import {
  COM_DOCKER,
  commitarNaBranchBase,
  dockerDeVerdade,
  gerarPackageLock,
  gestaoEmContainerQueGeraImagens,
  imagensDoProjeto,
  repositorioComDependencias,
} from "./apoio-de-docker.ts";

/** A instalação que marca e falha se rodar: no Ambiente que já traz as dependências com o mesmo lockfile, ela é pulada. */
const INSTALACAO_QUE_NAO_PODE_RODAR = "touch instalou && exit 1";
/** A instalação de verdade, que marca que rodou. */
const INSTALACAO_LOCAL = "touch instalou && npm ci";
/** Um comando de preparação que não instala dependências: roda em cada Espaço mesmo com o Ambiente pronto. */
const PREPARACAO_DO_ESPACO = "touch preparou";
const LIMITE_DA_PREPARACAO_PRONTA_MS = 15_000;

const packageJsonEsm = (dependencias: Record<string, string>) =>
  JSON.stringify({ name: "esm-minimo", version: "1.0.0", type: "module", dependencies: dependencias });

const imagemDoContainer = (ambiente: AmbienteContainer) =>
  dockerDeVerdade("inspect", "-f", "{{.Image}}", ambiente.container_id);

/** O projeto ESM com uma dependência pequena, a imagem dele pela gestão e as rodadas (pastas) que importam dependências. */
async function cenarioEsm(nomeDoProjeto: string, dependenciasIniciais: Record<string, string>) {
  const nomeDoProjetoNoDocker = `${nomeDoProjeto}-${String(process.pid)}`;
  const { raiz, alocarEmContainer } = await gestaoEmContainerQueGeraImagens(nomeDoProjetoNoDocker);
  const raizGit = repositorioComDependencias(raiz, { "package.json": packageJsonEsm(dependenciasIniciais) });
  const log = join(raiz, "preparacao.log");

  /**
   * Uma pasta de rodada cujo teste importa `dependencia` com `import`, ainda sem `node_modules`. Sem `dependenciasDaRodada`,
   * o `package.json` e o lockfile são os da branch base (os da imagem); com elas, a rodada tem as suas (a branch da demanda).
   */
  function criarRodada(numero: number, dependencia: string, dependenciasDaRodada?: Record<string, string>): string {
    const pasta = join(raiz, "worktrees", nomeDoProjetoNoDocker, `rodada-${String(numero)}`);
    mkdirSync(pasta, { recursive: true });
    if (dependenciasDaRodada) {
      writeFileSync(join(pasta, "package.json"), packageJsonEsm(dependenciasDaRodada));
      gerarPackageLock(pasta);
    } else
      for (const arquivo of ["package.json", "package-lock.json"])
        copyFileSync(join(raizGit, arquivo), join(pasta, arquivo));
    writeFileSync(
      join(pasta, "dependencia.test.js"),
      `import assert from "node:assert/strict";\nimport { test } from "node:test";\n` +
        `import importada from "${dependencia}";\ntest("a dependência chega à rodada", () => assert.equal(typeof importada, "function"));\n`,
    );
    return pasta;
  }

  return {
    nomeDoProjetoNoDocker,
    alocar: (dono: string) =>
      alocarEmContainer(dono, { raiz_git: raizGit, arquivos_de_dependencias: ["package.json"] }),
    criarRodada,
    /** O lockfile muda na branch base: o `package.json` novo e o `package-lock.json` que o npm gera dele. */
    trocarDependencias(dependencias: Record<string, string>): void {
      writeFileSync(join(raizGit, "package.json"), packageJsonEsm(dependencias));
      gerarPackageLock(raizGit);
      commitarNaBranchBase(raizGit);
    },
    /** Prepara a rodada como o Espaço faz e confere que a instalação foi pulada e a preparação rodou. */
    async prepararRodada(
      ambiente: AmbienteContainer,
      pasta: string,
      instalacao = INSTALACAO_QUE_NAO_PODE_RODAR,
    ): Promise<void> {
      await preparar(ambiente, pasta, { instalacao: [instalacao], preparacao: [PREPARACAO_DO_ESPACO] }, log);
      assert.equal(existsSync(join(pasta, "instalou")), instalacao !== INSTALACAO_QUE_NAO_PODE_RODAR);
      assert.equal(existsSync(join(pasta, "preparou")), true);
    },
    /** O `node --test` da rodada, rodado no container dela. */
    testarRodada: (ambiente: AmbienteContainer, pasta: string) =>
      ambiente.executar({
        programa: "node --test",
        argumentos: [],
        cwd: pasta,
        env: {},
        noShell: true,
        limiteMs: 60_000,
      }),
  };
}

test(
  "CA-1: a rodada preparada com o ambiente pronto não roda a instalação e o import ESM da dependência funciona na worktree",
  COM_DOCKER,
  async () => {
    const cenario = await cenarioEsm("projeto-esm-pronto", { "left-pad": "1.3.0" });
    const ambiente = await cenario.alocar("espaco-1");
    const rodada = cenario.criarRodada(1, "left-pad");

    // O NODE_PATH da imagem não basta para o ESM: sem o node_modules na worktree, o import falha.
    const antes = await cenario.testarRodada(ambiente, rodada);
    assert.notEqual(antes.codigo, 0);
    assert.match(antes.saida, /ERR_MODULE_NOT_FOUND|Cannot find package/);

    await cenario.prepararRodada(ambiente, rodada);

    assert.equal(readlinkSync(join(rodada, "node_modules")), "/dependencias/node_modules");
    const depois = await cenario.testarRodada(ambiente, rodada);
    assert.equal(depois.codigo, 0, depois.saida);
  },
);

test(
  "CA-2: o lockfile que muda gera outra imagem, instalada uma vez, e a rodada seguinte com ele reusa sem novo build",
  COM_DOCKER,
  async () => {
    const cenario = await cenarioEsm("projeto-esm-lockfile", { "left-pad": "1.3.0" });
    const primeiro = await cenario.alocar("espaco-1");
    const imagemDoPrimeiro = imagemDoContainer(primeiro);
    assert.equal(imagensDoProjeto(cenario.nomeDoProjetoNoDocker).length, 1);

    cenario.trocarDependencias({ "left-pad": "1.3.0", "is-odd": "3.0.1" });
    const segundo = await cenario.alocar("espaco-2");
    const imagemDoSegundo = imagemDoContainer(segundo);
    assert.notEqual(imagemDoSegundo, imagemDoPrimeiro);
    assert.equal(imagensDoProjeto(cenario.nomeDoProjetoNoDocker).length, 2);
    const rodadaDoSegundo = cenario.criarRodada(2, "is-odd");
    await cenario.prepararRodada(segundo, rodadaDoSegundo);
    const testeDoSegundo = await cenario.testarRodada(segundo, rodadaDoSegundo);
    assert.equal(testeDoSegundo.codigo, 0, testeDoSegundo.saida);

    // A rodada seguinte com o mesmo lockfile reusa a imagem nova: nenhum build a mais.
    const terceiro = await cenario.alocar("espaco-3");
    assert.equal(imagemDoContainer(terceiro), imagemDoSegundo);
    assert.equal(imagensDoProjeto(cenario.nomeDoProjetoNoDocker).length, 2);
    const rodadaDoTerceiro = cenario.criarRodada(3, "is-odd");
    await cenario.prepararRodada(terceiro, rodadaDoTerceiro);
    const testeDoTerceiro = await cenario.testarRodada(terceiro, rodadaDoTerceiro);
    assert.equal(testeDoTerceiro.codigo, 0, testeDoTerceiro.saida);
  },
);

test(
  "CA-2: a rodada com lockfile diferente do da imagem instala na worktree e o import da dependência nova funciona",
  COM_DOCKER,
  async () => {
    const cenario = await cenarioEsm("projeto-esm-lockfile-da-rodada", { "left-pad": "1.3.0" });
    const ambiente = await cenario.alocar("espaco-1");
    // A rodada anterior acrescentou `is-odd` na branch da demanda; a imagem, da base, não a tem.
    const rodada = cenario.criarRodada(1, "is-odd", { "left-pad": "1.3.0", "is-odd": "3.0.1" });
    // A preparação anterior deixou o symlink da imagem: a instalação local o troca por um node_modules próprio.
    symlinkSync("/dependencias/node_modules", join(rodada, "node_modules"));

    await cenario.prepararRodada(ambiente, rodada, INSTALACAO_LOCAL);

    assert.equal(lstatSync(join(rodada, "node_modules")).isSymbolicLink(), false);
    const teste = await cenario.testarRodada(ambiente, rodada);
    assert.equal(teste.codigo, 0, teste.saida);
  },
);

test(
  "CA-3: duas rodadas simultâneas com o mesmo hash passam os testes, e mexer no node_modules de uma não aparece na outra",
  COM_DOCKER,
  async () => {
    const cenario = await cenarioEsm("projeto-esm-simultaneo", { "left-pad": "1.3.0" });
    const [ambienteA, ambienteB] = await Promise.all([cenario.alocar("espaco-1"), cenario.alocar("espaco-2")]);
    assert.notEqual(ambienteA.container_id, ambienteB.container_id);
    assert.equal(imagensDoProjeto(cenario.nomeDoProjetoNoDocker).length, 1);
    const rodadaA = cenario.criarRodada(1, "left-pad");
    const rodadaB = cenario.criarRodada(2, "left-pad");

    await Promise.all([cenario.prepararRodada(ambienteA, rodadaA), cenario.prepararRodada(ambienteB, rodadaB)]);
    const [testeA, testeB] = await Promise.all([
      cenario.testarRodada(ambienteA, rodadaA),
      cenario.testarRodada(ambienteB, rodadaB),
    ]);
    assert.equal(testeA.codigo, 0, testeA.saida);
    assert.equal(testeB.codigo, 0, testeB.saida);

    // A dependência some do ambiente A (como root: o node_modules da imagem é dele); o B segue com a sua.
    dockerDeVerdade(
      "exec",
      "--user",
      "root",
      ambienteA.container_id,
      "rm",
      "-rf",
      "/dependencias/node_modules/left-pad",
    );
    assert.notEqual((await cenario.testarRodada(ambienteA, rodadaA)).codigo, 0);
    const depoisNoB = await cenario.testarRodada(ambienteB, rodadaB);
    assert.equal(depoisNoB.codigo, 0, depoisNoB.saida);
  },
);

test(
  "CA-4: preparar duas rodadas independentes com o ambiente pronto leva segundos, sem instalar",
  COM_DOCKER,
  async () => {
    const cenario = await cenarioEsm("projeto-esm-rapido", { "left-pad": "1.3.0" });
    const [ambienteA, ambienteB] = await Promise.all([cenario.alocar("espaco-1"), cenario.alocar("espaco-2")]);
    const rodadaA = cenario.criarRodada(1, "left-pad");
    const rodadaB = cenario.criarRodada(2, "left-pad");

    const inicio = performance.now();
    await Promise.all([cenario.prepararRodada(ambienteA, rodadaA), cenario.prepararRodada(ambienteB, rodadaB)]);
    const duracaoMs = performance.now() - inicio;

    assert.ok(duracaoMs < LIMITE_DA_PREPARACAO_PRONTA_MS, `a preparação levou ${String(Math.round(duracaoMs))} ms`);
  },
);
