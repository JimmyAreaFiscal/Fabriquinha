// I-286, CA-3: o ciclo do container de Ambiente no Docker de verdade, pela gestão de Ambientes — aloca, mede, limpa,
// reusa e elimina — com uma imagem mínima. Pulado sem `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa
// a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { montarGestaoDeAmbientes } from "../../src/modulos/ambiente/publico.ts";
import { PACOTE } from "../../src/shared/infra/isolamento_do_ambiente.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { raizCompartilhadaComODocker } from "../falsos.ts";

const IMAGEM_MINIMA = "busybox:1";

const dockerDeVerdade = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

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
    // Montada no host_local, a gestão não confere o conjunto com o docker da máquina, que pode ter os do serviço.
    const configuracao = { atual: ConfiguracaoDoAmbiente.parse({}) };
    const gestao = await montarGestaoDeAmbientes({
      banco,
      configuracao: () => configuracao.atual,
      servico: {
        raiz,
        porta_da_api: 1,
        home_do_usuario: raiz,
        pacote_do_harness: PACOTE,
        dir_do_harness_do_auditor: dirDoPi,
      },
      registrarErro: noLog,
    });
    configuracao.atual = ConfiguracaoDoAmbiente.parse({ tipo: "container", memoria_maxima_mb: 512, cpus: 0.5 });
    const containersCriados: string[] = [];
    after(async () => {
      await gestao.parar();
      for (const containerId of containersCriados)
        execFileSync("docker", ["rm", "--force", containerId], { stdio: "ignore" });
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
