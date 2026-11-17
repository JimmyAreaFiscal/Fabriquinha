// I-286, CA-3: o ciclo do container de Ambiente no Docker de verdade, pela gestão de Ambientes — aloca, mede, limpa,
// reusa e elimina — com uma imagem mínima. Pulado sem `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa
// a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { instalarDockerQueCai } from "../../apoio-testes/falsos/docker_que_cai.ts";
import { type GestaoDeAmbientes, montarGestaoDeAmbientes } from "../../src/modulos/ambiente/publico.ts";
import { abrigarNoAmbiente } from "../../src/modulos/ambiente/sandboxes/publico.ts";
import { instalacaoDoPi, PACOTE } from "../../src/shared/infra/isolamento_do_ambiente.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { raizCompartilhadaComODocker } from "../falsos.ts";

const IMAGEM_MINIMA = "busybox:1";

const dockerDeVerdade = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

test(
  "aloca, mede, limpa, reusa e elimina um container de Ambiente, com o limite de memória no docker",
  {
    skip: process.env.FABRIQUINHA_TESTE_DOCKER
      ? false
      : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
  },
  async () => {
    const { banco, fechar } = abrirBancoTemporario();
    const raiz = raizCompartilhadaComODocker();
    const dirDoPi = join(raiz, "pi-do-auditor");
    mkdirSync(dirDoPi);
    writeFileSync(join(dirDoPi, "auth.json"), "{}");
    // A conferência da subida só enxerga os containers do teste: a máquina pode ter os do serviço, que ela eliminaria como órfãos.
    const dockerQueCai = instalarDockerQueCai(mkdtempSync(join(tmpdir(), "docker-que-cai-")));
    const gestao = await montarGestaoDeAmbientes({
      banco,
      configuracao: () => ConfiguracaoDoAmbiente.parse({ tipo: "container", memoria_maxima_mb: 512, cpus: 0.5 }),
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
        execFileSync("docker", ["rm", "--force", containerId], { stdio: "ignore" });
      dockerQueCai.desinstalar();
      rmSync(raiz, { recursive: true, force: true });
      fechar();
    });
    const projeto = { nome: "projeto", raiz_git: mkdtempSync(join(raiz, "repo-")), imagem_do_ambiente: IMAGEM_MINIMA };
    const ocupante = (dono: string) => ({ dono, pasta_das_worktrees_do_projeto: join(raiz, "worktrees", "projeto") });

    // aloca
    const alocado = await gestao.alocar(ocupante("espaco-1"), projeto);
    assert.ok(alocado instanceof AmbienteContainer);
    containersCriados.push(alocado.container_id);
    assert.equal(
      dockerDeVerdade("inspect", "-f", "{{.HostConfig.Memory}}", alocado.container_id),
      String(512 * 1048576),
    );

    // o uso medido vem do docker stats, numa chamada só
    const [medido] = await gestao.listar();
    assert.equal(medido?.id, alocado.id);
    assert.ok(medido.medido && medido.medido.cpus >= 0 && medido.medido.memoria_mb > 0, JSON.stringify(medido));

    // sujeira do trabalho some na limpeza, e o container volta ao conjunto
    dockerDeVerdade("exec", alocado.container_id, "sh", "-c", "touch /tmp/lixo /trabalho/lixo");
    await gestao.limpar(alocado.id);
    assert.equal(dockerDeVerdade("exec", alocado.container_id, "sh", "-c", "find /tmp /trabalho -mindepth 1"), "");

    // o livre da mesma imagem é reusado
    const reusado = await gestao.alocar(ocupante("espaco-2"), projeto);
    assert.ok(reusado instanceof AmbienteContainer);
    assert.equal(reusado.container_id, alocado.container_id);

    // elimina
    await gestao.limpar(reusado.id);
    await gestao.deletar(reusado.id);
    assert.deepEqual(await gestao.listar(), []);
    assert.equal(dockerDeVerdade("ps", "--all", "--quiet", "--filter", `id=${alocado.container_id}`), "");
  },
);

test(
  "o container de Ambiente roda o pi do host e o fabriquinha do pacote, e nenhum outro CLI do host",
  {
    skip: process.env.FABRIQUINHA_TESTE_DOCKER
      ? false
      : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
  },
  async () => {
    const { banco, fechar } = abrirBancoTemporario();
    const raiz = raizCompartilhadaComODocker();
    const dirDoPi = join(raiz, "pi-do-auditor");
    mkdirSync(dirDoPi);
    writeFileSync(join(dirDoPi, "auth.json"), "{}");
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
    const projeto = {
      nome: "projeto",
      raiz_git: mkdtempSync(join(raiz, "repo-")),
      imagem_do_ambiente: "node:22-bookworm-slim",
    };
    const alocado = await gestao.alocar(
      { dono: "espaco", pasta_das_worktrees_do_projeto: join(raiz, "worktrees", "projeto") },
      projeto,
    );
    after(async () => {
      await gestao.parar();
      if (alocado instanceof AmbienteContainer)
        execFileSync("docker", ["rm", "--force", alocado.container_id], { stdio: "ignore" });
      rmSync(raiz, { recursive: true, force: true });
      fechar();
    });
    assert.ok(alocado instanceof AmbienteContainer);
    const noContainer = (linha: string) =>
      alocado.executar({ programa: linha, argumentos: [], cwd: "/", env: {}, noShell: true, limiteMs: 60_000 });

    const pi = await noContainer("pi --version");
    assert.equal(pi.codigo, 0, pi.saida);
    assert.match(pi.saida, /\d+\.\d+\.\d+/);
    const cli = await noContainer("command -v fabriquinha");
    assert.equal(cli.saida.trim(), join(PACOTE, "bin", "fabriquinha"));
    const outros = await noContainer("for c in gh az docker claude codex; do command -v $c; done; true");
    assert.equal(outros.saida.trim(), "");
  },
);

test(
  "I-315 CA-3: o container que parou é eliminado na reconciliação, as sessões do ocupante ficam no Espaço e ele recebe um container novo",
  COM_DOCKER,
  async (t) => {
    const { banco, fechar } = abrirBancoTemporario();
    const raiz = raizCompartilhadaComODocker();
    const dirDoPi = join(raiz, "pi-do-auditor");
    mkdirSync(dirDoPi);
    writeFileSync(join(dirDoPi, "auth.json"), "{}");
    // A reconciliação só enxerga os containers do teste: a máquina pode ter os do serviço, que ela eliminaria como órfãos.
    const dockerQueCai = instalarDockerQueCai(mkdtempSync(join(tmpdir(), "docker-que-cai-")));
    const gestoes: GestaoDeAmbientes[] = [];
    const containersCriados: string[] = [];
    t.after(async () => {
      for (const gestao of gestoes) await gestao.parar();
      for (const containerId of containersCriados) spawnSync("docker", ["rm", "--force", containerId]);
      dockerQueCai.desinstalar();
      rmSync(raiz, { recursive: true, force: true });
      fechar();
    });
    // Cada montagem é um serviço que sobe: no `container`, confere o conjunto com o docker antes de devolver a gestão.
    const subirOServico = async () => {
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
      gestoes.push(gestao);
      return gestao;
    };
    const projeto = { nome: "projeto", raiz_git: mkdtempSync(join(raiz, "repo-")), imagem_do_ambiente: IMAGEM_MINIMA };
    const ocupante = { dono: "espaco-1", pasta_das_worktrees_do_projeto: join(raiz, "worktrees", "projeto") };
    const alocarNoServico = async (gestao: GestaoDeAmbientes) => {
      const alocado = await gestao.alocar(ocupante, projeto);
      assert.ok(alocado instanceof AmbienteContainer);
      containersCriados.push(alocado.container_id);
      dockerQueCai.incluir(alocado.container_id);
      return alocado;
    };

    // O ocupante tem a sessão dele no container.
    const antes = await alocarNoServico(await subirOServico());
    mkdirSync(join(raiz, "sessoes", "s1"), { recursive: true });
    writeFileSync(join(raiz, "sessoes", "s1", "conversa.jsonl"), "conversa");
    abrigarNoAmbiente(raiz, antes.id, "sessoes", "s1");

    // O computador desligou: o container parou, e o serviço que sobe de novo o reconcilia.
    dockerDeVerdade("stop", "--time", "1", antes.container_id);
    const depoisDaSubida = await subirOServico();

    assert.equal(dockerDeVerdade("ps", "--all", "--quiet", "--filter", `id=${antes.container_id}`), "");
    assert.equal(banco.prepare("SELECT id FROM ambiente WHERE id = ?").get(antes.id), undefined);
    // A sessão continua onde o core a lê, agora na pasta do Espaço.
    assert.equal(readlinkSync(join(raiz, "sessoes", "s1")), join(raiz, "espacos", "espaco-1", "sessoes", "s1"));
    assert.equal(readFileSync(join(raiz, "sessoes", "s1", "conversa.jsonl"), "utf8"), "conversa");

    // O ocupante recebe um container novo, rodando.
    const depois = await alocarNoServico(depoisDaSubida);
    assert.notEqual(depois.container_id, antes.container_id);
    assert.equal(dockerDeVerdade("inspect", "-f", "{{.State.Running}}", depois.container_id), "true");
    assert.equal(existsSync(join(raiz, "ambientes", antes.id, "sessoes", "s1")), false);
  },
);
