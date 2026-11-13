// O conjunto fixo ou variável de sandboxes (MELHORIAS §8, regras 3 e 4, e §13, item 1): a capacidade, a vaga que um
// parado cede e a ociosidade que só o variável elimina, até o mínimo.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { ErroExterno } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { PACOTE } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { listarAmbientes } from "../armazenamento/ambientes.ts";
import { GeradorDeAmbientes } from "../infra/gerador_de_ambientes.ts";
import { ConjuntoDeSandboxes } from "./conjunto_de_sandboxes.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-capacidade-"));
const dirDoPiDoAuditorDoTeste = join(base, "pi-do-auditor");
mkdirSync(dirDoPiDoAuditorDoTeste);
writeFileSync(join(dirDoPiDoAuditorDoTeste, "auth.json"), "{}");
process.env.PI_CODING_AGENT_DIR = dirDoPiDoAuditorDoTeste;
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const SERVICO = {
  raiz: base,
  porta_da_api: 4999,
  home_do_usuario: base,
  pacote_do_harness: PACOTE,
  dir_do_harness_do_auditor: dirDoPiDoAuditorDoTeste,
};
const projetoDaImagem = (imagem_do_ambiente: string) => ({ nome: "loja", raiz_git: base, imagem_do_ambiente });
const alpine = projetoDaImagem("alpine");
const ocupante = (dono: string) => ({ dono, pasta_das_worktrees_do_projeto: join(base, "worktrees", "loja") });
const ehAIndisponibilidadeDoConjunto = (erro: unknown) =>
  erro instanceof ErroExterno && erro.message.includes("nenhum sandbox disponível: o conjunto está na capacidade");

let cenarios = 0;
function cenario(conjuntoConfigurado: Record<string, unknown>) {
  const pastaDoDocker = join(base, `docker-${String(++cenarios)}`);
  const docker = instalarDockerFalso(pastaDoDocker);
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  const configuracao = ConfiguracaoDoAmbiente.parse({
    tipo: "container",
    ociosidade_para_eliminar_min: 30,
    ...conjuntoConfigurado,
  });
  // O relógio que o teste avança: a ordem das liberações decide quem o conjunto elimina primeiro.
  let instante: Instante = "2026-11-13T10:00:00.000Z";
  const relogio = { agora: () => instante };
  const conjunto = new ConjuntoDeSandboxes(banco, new GeradorDeAmbientes(), () => configuracao, SERVICO, relogio);
  const criacoes = () => docker.registro().filter(([comando, opcao]) => comando === "run" && opcao !== "--rm").length;
  const estados = () =>
    listarAmbientes(banco).map(({ estado, alocado_para, imagem }) => [estado, alocado_para, imagem]);
  /** Devolve ao conjunto o container que o ocupante tem. */
  const liberar = async (dono: string) => {
    const alocado = conjunto.alocacaoDe(dono);
    assert.ok(alocado);
    await conjunto.limpar(alocado.id);
  };
  return {
    docker,
    conjunto,
    liberar,
    criacoes,
    estados,
    pastaDoDocker,
    aos: (minuto: number) => {
      instante = new Date(Date.parse("2026-11-13T10:00:00.000Z") + minuto * 60_000).toISOString();
    },
  };
}

test("variável na capacidade e sem parado: informa a indisponibilidade sem criar container; liberado um, o próximo o reusa", async () => {
  const { conjunto, criacoes, estados, liberar } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 2 });
  const primeiro = await conjunto.alocar(ocupante("I-1"), alpine);
  await conjunto.alocar(ocupante("I-2"), alpine);

  await assert.rejects(conjunto.alocar(ocupante("I-3"), alpine), ehAIndisponibilidadeDoConjunto);
  assert.equal(criacoes(), 2);

  await liberar("I-1");
  const reusado = await conjunto.alocar(ocupante("I-3"), alpine);
  assert.equal(reusado.container_id, primeiro.container_id);
  assert.equal(criacoes(), 2);
  assert.deepEqual(estados(), [
    ["alocado", "I-3", "alpine"],
    ["alocado", "I-2", "alpine"],
  ]);
});

test("fixo na capacidade: o parado de outra imagem cede a vaga, o sujo primeiro, e o conjunto não cresce", async () => {
  const { docker, conjunto, estados, pastaDoDocker, aos, liberar } = cenario({
    conjunto: "fixo",
    capacidade_do_conjunto: 2,
  });
  await conjunto.alocar(ocupante("I-1"), alpine);
  const sujo = await conjunto.alocar(ocupante("I-2"), alpine);
  await liberar("I-1");
  aos(1);
  docker.falharComando("exec", "container travado");
  await liberar("I-2");
  rmSync(join(pastaDoDocker, "falhas", "exec"));

  await conjunto.alocar(ocupante("I-3"), projetoDaImagem("busybox"));

  assert.deepEqual(estados(), [
    ["livre", null, "alpine"],
    ["alocado", "I-3", "busybox"],
  ]);
  assert.ok(
    docker.registro().some(([comando, , id]) => comando === "rm" && id === sujo.container_id),
    "o sujo saiu do docker",
  );
  assert.equal(docker.containers().length, 2);
});

test("dois alocar ao mesmo tempo na última vaga: um recebe o container, o outro é informado da indisponibilidade", async () => {
  const { docker, conjunto } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 1 });
  const resultados = await Promise.allSettled([
    conjunto.alocar(ocupante("I-1"), alpine),
    conjunto.alocar(ocupante("I-2"), alpine),
  ]);
  assert.deepEqual(resultados.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  const recusa = resultados.find((resultado) => resultado.status === "rejected");
  assert.ok(ehAIndisponibilidadeDoConjunto(recusa?.reason));
  assert.equal(docker.containers().length, 1);
});

test("a criação que falha devolve a vaga ao conjunto", async () => {
  const { docker, conjunto, pastaDoDocker } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  docker.falharComando("run", "docker travado");
  await assert.rejects(conjunto.alocar(ocupante("I-1"), alpine), /docker travado/);
  rmSync(join(pastaDoDocker, "falhas", "run"));
  await conjunto.alocar(ocupante("I-1"), alpine);
  assert.equal(docker.containers().length, 1);
});

test("o fixo mantém os parados além da ociosidade", async () => {
  const { conjunto, estados, liberar } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 2 });
  await conjunto.alocar(ocupante("I-1"), alpine);
  await liberar("I-1");
  await conjunto.eliminarOciosos("2026-11-14T10:00:00.000Z");
  assert.deepEqual(estados(), [["livre", null, "alpine"]]);
});

test("o variável elimina os ociosos só até o mínimo, o sujo e o livre mais antigo primeiro", async () => {
  const { docker, conjunto, estados, pastaDoDocker, aos, liberar } = cenario({
    conjunto: "variavel",
    minimo_do_conjunto: 2,
  });
  for (const dono of ["I-1", "I-2", "I-3", "I-4"]) await conjunto.alocar(ocupante(dono), alpine);
  await liberar("I-1");
  aos(1);
  await liberar("I-3");
  aos(2);
  docker.falharComando("exec", "container travado");
  await liberar("I-2");
  rmSync(join(pastaDoDocker, "falhas", "exec"));

  await conjunto.eliminarOciosos("2026-11-14T10:00:00.000Z");

  assert.deepEqual(estados(), [
    ["livre", null, "alpine"],
    ["alocado", "I-4", "alpine"],
  ]);
  assert.equal(docker.containers().length, 2);
});
