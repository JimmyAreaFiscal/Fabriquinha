// I-286, CA-1: com `tipo = host_local`, o padrão, uma rodada inteira (implementar, revisar_rodada e encerrar_rodada) roda
// no host e o docker nunca é chamado: o docker falso, à frente no PATH, termina com o registro vazio.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { instalarDockerFalso } from "../apoio-testes/docker_falso.ts";
import { configuracaoDoAmbiente } from "../src/armazenamento/servico.ts";
import { encerrar, revisar, rodadaEmRevisao } from "./apoio-execucao.ts";
import { base, criarCenario } from "./apoio.ts";
import { ghFalso } from "./falsos.ts";

ghFalso(base);

test("com host_local, uma rodada do implementar ao encerramento não chama o docker", async (t) => {
  const docker = instalarDockerFalso(join(base, "docker"));
  const c = criarCenario(t);
  assert.equal(configuracaoDoAmbiente(c.banco).tipo, "host_local");
  const id = await rodadaEmRevisao(c);
  await revisar(c, id, { resultado: "aprovado" });
  await encerrar(c, id);
  assert.deepEqual(docker.registro(), []);
});
