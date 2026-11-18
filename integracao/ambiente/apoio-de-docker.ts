// O que os testes de Ambiente com o Docker de verdade repartem: o repositório com os arquivos de dependências na branch
// base e a gestão de Ambientes em container que gera a imagem do projeto a partir deles.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import { rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { instalarDockerQueCai } from "../../apoio-testes/falsos/docker_que_cai.ts";
import { montarGestaoDeAmbientes } from "../../src/modulos/ambiente/publico.ts";
import { instalacaoDoPi, PACOTE } from "../../src/shared/infra/isolamento_do_ambiente.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { raizCompartilhadaComODocker } from "../falsos.ts";

/** A branch de onde a imagem lê os arquivos de dependências. */
export const BRANCH_BASE = "main";

export const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

/** Commita na `BRANCH_BASE` tudo o que está no repositório (criando-o na primeira vez) e publica em `origin/<BRANCH_BASE>`, de onde a imagem lê. */
export function commitarNaBranchBase(raizGit: string): void {
  if (!existsSync(join(raizGit, ".git"))) rodarGit(raizGit, "init", "-q", "-b", BRANCH_BASE);
  rodarGit(raizGit, "add", "-A");
  rodarGit(raizGit, "commit", "-q", "-m", "dependências");
  rodarGit(raizGit, "update-ref", `refs/remotes/origin/${BRANCH_BASE}`, "HEAD");
}

export const dockerDeVerdade = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim(); // NOSONAR

/** Um repositório com os arquivos de dependências dados (e o `package-lock.json`, gerado pelo npm, se há `package.json`). */
export function repositorioComDependencias(pasta: string, arquivos: Record<string, string>): string {
  const raizGit = mkdtempSync(join(pasta, "repo-"));
  for (const [nome, conteudo] of Object.entries(arquivos)) writeFileSync(join(raizGit, nome), conteudo);
  if ("package.json" in arquivos) gerarPackageLock(raizGit);
  commitarNaBranchBase(raizGit);
  return raizGit;
}

export function gerarPackageLock(raizGit: string): void {
  const argumentosDoNpm = ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"];
  execFileSync("npm", argumentosDoNpm, { cwd: raizGit, stdio: "ignore" }); // NOSONAR
}

export const imagensDoProjeto = (nomeDoProjeto: string) =>
  dockerDeVerdade("image", "ls", "--quiet", `fabriquinha/${nomeDoProjeto}`).split("\n").filter(Boolean);

export const rodarNoContainer = (ambiente: AmbienteContainer, comando: string) =>
  ambiente.executar({ programa: comando, argumentos: [], cwd: "/", env: {}, noShell: true, limiteMs: 60_000 });

/** A gestão de Ambientes em container, que gera a imagem do projeto pelos arquivos de dependências; `limpar` elimina o que criou. */
export async function gestaoEmContainerQueGeraImagens(nomeDoProjeto: string) {
  const { banco, fechar } = abrirBancoTemporario();
  const raiz = raizCompartilhadaComODocker();
  const dirDoPi = join(raiz, "pi-do-auditor");
  mkdirSync(dirDoPi);
  writeFileSync(join(dirDoPi, "auth.json"), "{}");
  // A conferência da subida só enxerga os containers do teste: a máquina pode ter os do serviço, que ela eliminaria como órfãos.
  const dockerQueCai = instalarDockerQueCai(mkdtempSync(join(tmpdir(), "docker-que-cai-")));
  const gestao = await montarGestaoDeAmbientes({
    banco,
    configuracao: () => ConfiguracaoDoAmbiente.parse({ tipo: "container" }),
    servico: {
      raiz,
      porta_da_api: 1,
      home_do_usuario: raiz,
      pacote_do_harness: PACOTE,
      instalacao_do_harness: () => instalacaoDoPi(),
      dir_do_harness_do_auditor: dirDoPi,
    },
    registrarErro: noLog,
  });
  const containersCriados: string[] = [];
  after(async () => {
    await gestao.parar();
    for (const containerId of containersCriados)
      execFileSync("docker", ["rm", "--force", containerId], { stdio: "ignore" }); // NOSONAR
    for (const imagem of imagensDoProjeto(nomeDoProjeto))
      execFileSync("docker", ["rmi", "--force", imagem], { stdio: "ignore" }); // NOSONAR
    dockerQueCai.desinstalar();
    rmSync(raiz, { recursive: true, force: true });
    fechar();
  });
  async function alocarEmContainer(dono: string, projeto: { raiz_git: string; arquivos_de_dependencias: string[] }) {
    const ambiente = await gestao.alocar(
      { dono, pasta_das_worktrees_do_projeto: join(raiz, "worktrees", nomeDoProjeto) },
      { nome: nomeDoProjeto, branch_base: BRANCH_BASE, ...projeto },
    );
    assert.ok(ambiente instanceof AmbienteContainer);
    containersCriados.push(ambiente.container_id);
    dockerQueCai.incluir(ambiente.container_id);
    return ambiente;
  }
  return { raiz, alocarEmContainer };
}
