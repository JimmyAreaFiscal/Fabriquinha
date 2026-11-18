// O conjunto fixo ou variável de sandboxes (MELHORIAS §8, regras 3 e 4, e §13, item 1): a capacidade, a vaga que um
// parado cede e a ociosidade que só o variável elimina, até o mínimo.
import { INSTALACAO_DO_PI_FALSO } from "../../../../../apoio-testes/falsos/pi_falso.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { ErroExterno } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/system/banco_da_fabriquinha.ts";
import { PACOTE } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { inserirAmbienteAlocado, liberarAmbiente, listarAmbientes } from "../armazenamento/ambientes.ts";
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
  instalacao_do_harness: () => INSTALACAO_DO_PI_FALSO,
  dir_do_harness_do_auditor: dirDoPiDoAuditorDoTeste,
};
writeFileSync(join(base, "package.json"), "{}");
writeFileSync(join(base, "package-lock.json"), "{}");
writeFileSync(join(base, "requirements.txt"), "requests\n");
// A imagem lê as dependências de origin/main: o clone de teste as commita e as publica nessa ref.
for (const argumentosDoGit of [
  ["init", "-q", "-b", "main"],
  ["add", "package.json", "package-lock.json", "requirements.txt"],
  ["-c", "user.name=Teste", "-c", "user.email=teste@exemplo.com", "commit", "-q", "-m", "dependências"],
  ["update-ref", "refs/remotes/origin/main", "HEAD"],
])
  execFileSync("git", ["-C", base, ...argumentosDoGit], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
const projetoDoArquivo = (arquivo: string) => ({
  nome: "loja",
  raiz_git: base,
  branch_base: "main",
  arquivos_de_dependencias: [arquivo],
});
const doNode = projetoDoArquivo("package.json");
const doPython = projetoDoArquivo("requirements.txt");
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
    banco,
    conjunto,
    liberar,
    criacoes,
    estados,
    pastaDoDocker,
    /** A imagem que o conjunto gera para o projeto, como o gerador a nomeia. */
    imagemDe: (projeto: typeof doNode) => new GeradorDeAmbientes().garantirImagem(projeto),
    aos: (minuto: number) => {
      instante = new Date(Date.parse("2026-11-13T10:00:00.000Z") + minuto * 60_000).toISOString();
    },
  };
}

test("variável na capacidade e sem parado: informa a indisponibilidade sem criar container; liberado um, o próximo o reusa", async () => {
  const { conjunto, criacoes, estados, liberar, imagemDe } = cenario({
    conjunto: "variavel",
    capacidade_do_conjunto: 2,
  });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  await conjunto.alocar(ocupante("I-2"), doNode);

  await assert.rejects(conjunto.alocar(ocupante("I-3"), doNode), ehAIndisponibilidadeDoConjunto);
  assert.equal(criacoes(), 2);

  await liberar("I-1");
  const reusado = await conjunto.alocar(ocupante("I-3"), doNode);
  assert.equal(reusado.container_id, primeiro.container_id);
  assert.equal(criacoes(), 2);
  assert.deepEqual(estados(), [
    ["alocado", "I-3", await imagemDe(doNode)],
    ["alocado", "I-2", await imagemDe(doNode)],
  ]);
});

test("fixo na capacidade: o parado de outra imagem cede a vaga, o sujo primeiro, e o conjunto não cresce", async () => {
  const { docker, conjunto, estados, pastaDoDocker, aos, liberar, imagemDe } = cenario({
    conjunto: "fixo",
    capacidade_do_conjunto: 2,
  });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const sujo = await conjunto.alocar(ocupante("I-2"), doNode);
  await liberar("I-1");
  aos(1);
  docker.falharComando("exec", "container travado");
  await liberar("I-2");
  rmSync(join(pastaDoDocker, "falhas", "exec"));

  await conjunto.alocar(ocupante("I-3"), doPython);

  assert.deepEqual(estados(), [
    ["livre", null, await imagemDe(doNode)],
    ["alocado", "I-3", await imagemDe(doPython)],
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
    conjunto.alocar(ocupante("I-1"), doNode),
    conjunto.alocar(ocupante("I-2"), doNode),
  ]);
  assert.deepEqual(resultados.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  const recusa = resultados.find((resultado) => resultado.status === "rejected");
  assert.ok(ehAIndisponibilidadeDoConjunto(recusa?.reason));
  assert.equal(docker.containers().length, 1);
});

test("a criação que falha devolve a vaga ao conjunto", async () => {
  const { docker, conjunto, pastaDoDocker } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  docker.falharComando("run", "docker travado");
  await assert.rejects(conjunto.alocar(ocupante("I-1"), doNode), /docker travado/);
  rmSync(join(pastaDoDocker, "falhas", "run"));
  await conjunto.alocar(ocupante("I-1"), doNode);
  assert.equal(docker.containers().length, 1);
});

test("o fixo mantém os parados além da ociosidade", async () => {
  const { conjunto, estados, liberar, imagemDe } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 2 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  await conjunto.eliminarOciosos("2026-11-14T10:00:00.000Z");
  assert.deepEqual(estados(), [["livre", null, await imagemDe(doNode)]]);
});

test("o variável elimina os ociosos só até o mínimo, o sujo e o livre mais antigo primeiro", async () => {
  const { docker, conjunto, estados, pastaDoDocker, aos, liberar, imagemDe } = cenario({
    conjunto: "variavel",
    minimo_do_conjunto: 2,
  });
  for (const dono of ["I-1", "I-2", "I-3", "I-4"]) await conjunto.alocar(ocupante(dono), doNode);
  await liberar("I-1");
  aos(1);
  await liberar("I-3");
  aos(2);
  docker.falharComando("exec", "container travado");
  await liberar("I-2");
  rmSync(join(pastaDoDocker, "falhas", "exec"));

  await conjunto.eliminarOciosos("2026-11-14T10:00:00.000Z");

  assert.deepEqual(estados(), [
    ["livre", null, await imagemDe(doNode)],
    ["alocado", "I-4", await imagemDe(doNode)],
  ]);
  assert.equal(docker.containers().length, 2);
});

test("o livre que parou e foi religado fora da Fabriquinha não é entregue: sai do conjunto e o ocupante recebe um container novo", async () => {
  const { conjunto, docker, estados, liberar, imagemDe } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 2 });
  const religado = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  docker.pararContainer(religado.container_id);
  docker.religarContainer(religado.container_id);

  const novo = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.notEqual(novo.container_id, religado.container_id);
  assert.deepEqual(estados(), [["alocado", "I-2", await imagemDe(doNode)]]);
  assert.deepEqual(
    docker.containers().map(({ id }) => id),
    [novo.container_id],
  );
});

const nomesNoDocker = (docker: ReturnType<typeof instalarDockerFalso>) =>
  docker
    .containers()
    .map(({ nome }) => nome)
    .sort();

test("cada container ocupa o menor slot livre: 1 no primeiro, 3 com 1 e 2 vivos, e o 2 volta depois de eliminado", async () => {
  const { docker, banco, conjunto, liberar } = cenario({ conjunto: "variavel" });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  assert.equal(primeiro.slot, 1);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1"]);

  const segundo = await conjunto.alocar(ocupante("I-2"), doNode);
  const terceiro = await conjunto.alocar(ocupante("I-3"), doNode);
  assert.deepEqual([segundo.slot, terceiro.slot], [2, 3]);

  await liberar("I-2");
  await conjunto.eliminar(segundo.id);
  const novo = await conjunto.alocar(ocupante("I-4"), doNode);
  assert.equal(novo.slot, 2);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1", "fabriquinha-slot-2", "fabriquinha-slot-3"]);
  assert.deepEqual(
    listarAmbientes(banco).map(({ slot }) => slot),
    [1, 3, 2],
  );
});

test("listar devolve o conjunto na ordem dos slots, mesmo com o slot reaproveitado criado depois", async () => {
  const { conjunto, liberar } = cenario({ conjunto: "variavel" });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const segundo = await conjunto.alocar(ocupante("I-2"), doNode);
  await conjunto.alocar(ocupante("I-3"), doNode);
  await liberar("I-2");
  await conjunto.eliminar(segundo.id);
  await conjunto.alocar(ocupante("I-4"), doNode);

  assert.deepEqual(
    (await conjunto.listar()).map(({ slot }) => slot),
    [1, 2, 3],
  );
});

test("dois alocar ao mesmo tempo recebem slots diferentes", async () => {
  const { docker, conjunto } = cenario({ conjunto: "variavel" });
  const alocados = await Promise.all([
    conjunto.alocar(ocupante("I-1"), doNode),
    conjunto.alocar(ocupante("I-2"), doNode),
  ]);
  assert.deepEqual(alocados.map(({ slot }) => slot).sort(), [1, 2]);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1", "fabriquinha-slot-2"]);
});

test("na subida, o órfão fabriquinha-slot-1 de uma subida anterior é eliminado e a criação não falha por nome repetido", async () => {
  const { docker, conjunto } = cenario({ conjunto: "variavel" });
  docker.semearContainer({ nome: "fabriquinha-slot-1", rotulos: { "fabriquinha.ambiente": "sobra" } });

  await conjunto.reconciliarNaSubida();
  const criado = await conjunto.alocar(ocupante("I-1"), doNode);

  assert.equal(criado.slot, 1);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1"]);
});

test("na subida, o container do banco sem slot (anterior ao slot) é eliminado com a linha, e o que tem slot fica", async () => {
  const { docker, banco, conjunto, estados, liberar, imagemDe } = cenario({ conjunto: "variavel" });
  await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  const antigo = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "antigo" } });
  inserirAmbienteAlocado(banco, {
    id: "antigo",
    container_id: antigo.id,
    imagem: "alpine",
    criado_em: "2026-11-13T09:00:00.000Z",
    alocado_para: "I-9",
  });

  await conjunto.reconciliarNaSubida();

  assert.deepEqual(estados(), [["livre", null, await imagemDe(doNode)]]);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1"]);
});

test("o nome fabriquinha-slot-1 tomado no docker por um container de fora do banco conta como ocupado, e esse container fica", async () => {
  const { docker, conjunto } = cenario({ conjunto: "variavel" });
  const deOutraInstancia = docker.semearContainer({ nome: "fabriquinha-slot-1" });

  const criado = await conjunto.alocar(ocupante("I-1"), doNode);

  assert.equal(criado.slot, 2);
  assert.ok(docker.containers().some(({ id }) => id === deOutraInstancia.id));
});

test("o container eliminado no banco que o rm não tirou do docker não tem o slot repetido pelo alocar seguinte", async () => {
  const { docker, conjunto, liberar, pastaDoDocker } = cenario({ conjunto: "variavel" });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  docker.falharComando("rm", "daemon ocupado");
  await assert.rejects(conjunto.eliminar(primeiro.id), /daemon ocupado/);
  rmSync(join(pastaDoDocker, "falhas", "rm"));

  const seguinte = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.equal(seguinte.slot, 2);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1", "fabriquinha-slot-2"]);
});

test("na capacidade, o novo container reusa o slot do parado que cedeu a vaga, já fora do docker", async () => {
  const { docker, conjunto, liberar } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");

  const novo = await conjunto.alocar(ocupante("I-2"), doPython);

  assert.equal(novo.slot, 1);
  assert.deepEqual(nomesNoDocker(docker), ["fabriquinha-slot-1"]);
});

test("na subida, o container alocado sem slot recolhe as sessões e execuções ao Espaço antes de ser eliminado", async () => {
  const { docker, banco, conjunto } = cenario({ conjunto: "variavel" });
  const semSlot = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "sem-slot-alocado" } });
  inserirAmbienteAlocado(banco, {
    id: "sem-slot-alocado",
    container_id: semSlot.id,
    imagem: "alpine",
    criado_em: "2026-11-13T09:00:00.000Z",
    alocado_para: "I-77",
  });
  const livreSemSlot = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "sem-slot-livre" } });
  inserirAmbienteAlocado(banco, {
    id: "sem-slot-livre",
    container_id: livreSemSlot.id,
    imagem: "alpine",
    criado_em: "2026-11-13T09:00:00.000Z",
    alocado_para: "I-78",
  });
  liberarAmbiente(banco, "sem-slot-livre", "livre", "2026-11-13T09:30:00.000Z");
  const sessaoNoContainer = join(base, "ambientes", "sem-slot-alocado", "sessoes", "s-77");
  mkdirSync(sessaoNoContainer, { recursive: true });
  writeFileSync(join(sessaoNoContainer, "conversa.jsonl"), "{}");

  await conjunto.reconciliarNaSubida();

  assert.equal(readFileSync(join(base, "espacos", "I-77", "sessoes", "s-77", "conversa.jsonl"), "utf8"), "{}");
  assert.deepEqual(docker.containers(), []);
  assert.deepEqual(listarAmbientes(banco), []);
});
