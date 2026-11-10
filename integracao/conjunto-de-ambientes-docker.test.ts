// I-286, CA-3: o ciclo do container de Ambiente no Docker de verdade — cria, aloca, libera e elimina — com uma imagem
// mínima. Pulado sem `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../apoio-testes/banco_temporario.ts";
import {
  alocarAmbienteLivreDaImagem,
  eliminarAmbiente,
  inserirAmbienteAlocado,
  liberarAmbiente,
} from "../src/armazenamento/ambientes.ts";
import { GeradorDeAmbientes } from "../src/infra/ambiente/container/gerador_de_ambientes.ts";

const IMAGEM_MINIMA = "busybox:1";
const LIMITES = { memoria_maxima_mb: 512, cpus: 0.5 };

const dockerDeVerdade = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

test(
  "cria, aloca, libera e elimina um container de Ambiente, com o limite de memória no docker",
  {
    skip: process.env.FABRIQUINHA_TESTE_DOCKER
      ? false
      : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
  },
  async () => {
    const { banco, fechar } = abrirBancoTemporario();
    const raizDoProjeto = mkdtempSync(join(tmpdir(), "fabriquinha-docker-"));
    const gerador = new GeradorDeAmbientes();
    const containersCriados: string[] = [];
    after(() => {
      for (const containerId of containersCriados)
        execFileSync("docker", ["rm", "--force", containerId], { stdio: "ignore" });
      rmSync(raizDoProjeto, { recursive: true, force: true });
      fechar();
    });

    const imagem = await gerador.garantirImagem({
      nome: "projeto",
      raiz_git: raizDoProjeto,
      imagem_do_ambiente: IMAGEM_MINIMA,
    });
    assert.equal(imagem, IMAGEM_MINIMA);

    // cria e aloca
    const criado = await gerador.criar(imagem, LIMITES, 1);
    containersCriados.push(criado.container_id);
    inserirAmbienteAlocado(banco, {
      ...criado,
      imagem,
      criado_em: "2026-01-01T00:00:00.000Z",
      alocado_para: "espaco-1",
    });
    assert.equal(
      dockerDeVerdade("inspect", "-f", "{{.HostConfig.Memory}}", criado.container_id),
      String(LIMITES.memoria_maxima_mb * 1048576),
    );
    assert.deepEqual(
      (await gerador.listarDaFabriquinha()).filter((c) => c.id === criado.id),
      [criado],
    );

    // sujeira do trabalho some na limpeza, e o container volta ao conjunto
    dockerDeVerdade("exec", criado.container_id, "sh", "-c", "touch /tmp/lixo /trabalho/lixo");
    await gerador.limpar(criado);
    assert.equal(dockerDeVerdade("exec", criado.container_id, "sh", "-c", "find /tmp /trabalho -mindepth 1"), "");
    liberarAmbiente(banco, criado.id, "livre", "2026-01-01T00:01:00.000Z");

    // o livre da mesma imagem é reusado
    assert.equal(alocarAmbienteLivreDaImagem(banco, imagem, "espaco-2")?.container_id, criado.container_id);

    // elimina
    await gerador.eliminar(criado);
    eliminarAmbiente(banco, criado.id);
    assert.deepEqual(
      (await gerador.listarDaFabriquinha()).filter((c) => c.id === criado.id),
      [],
    );
  },
);
