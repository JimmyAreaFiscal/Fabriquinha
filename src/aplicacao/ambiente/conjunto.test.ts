import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../apoio-testes/docker_falso.ts";
import { listarAmbientes } from "../../armazenamento/ambientes.ts";
import { migrar } from "../../armazenamento/banco.ts";
import { MIGRACOES } from "../../armazenamento/migracoes.ts";
import { salvarConfiguracaoDoAmbiente } from "../../armazenamento/servico.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { espacoDaDemanda, espacoDaRodada } from "../../nucleo/espaco_de_trabalho.ts";
import { Projeto } from "../../nucleo/projeto.ts";
import { GeradorDeAmbientes } from "../../infra/ambiente/container/gerador_de_ambientes.ts";
import { ConjuntoDeAmbientes } from "./conjunto.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-conjunto-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const projetoComImagem = (imagem_do_ambiente?: string) =>
  Projeto.parse({
    nome: "loja",
    raiz_git: base,
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "Loja",
    ...(imagem_do_ambiente && { imagem_do_ambiente }),
  });
const projeto = projetoComImagem("alpine");
const espacoA = espacoDaDemanda(projeto, "I-1", base);
const espacoB = espacoDaRodada(projeto, "I-1", 2, base);
const LIMITES = { tipo: "container", memoria_maxima_mb: 768, cpus: 1.5, ociosidade_para_eliminar_min: 30 };

let cenarios = 0;
function cenario() {
  const docker = instalarDockerFalso(join(base, `docker-${String(++cenarios)}`));
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  salvarConfiguracaoDoAmbiente(banco, LIMITES);
  const conjunto = new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes());
  const criacoes = () => docker.registro().filter(([comando]) => comando === "run" || comando === "create");
  return { docker, banco, conjunto, criacoes, pastaDoDocker: join(base, `docker-${String(cenarios)}`) };
}

test("alocar sem livre cria o container com os limites da configuração e grava alocado", async () => {
  const { docker, banco, conjunto } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  assert.equal(ambiente.estado, "alocado");
  assert.equal(ambiente.alocado_para, "I-1");
  assert.equal(ambiente.imagem, "alpine");
  const [container] = docker.containers();
  assert.equal(container?.id, ambiente.container_id);
  assert.equal(container.memoria, 768 * 1048576);
  assert.equal(container.cpus, 1.5);
  assert.equal(container.rotulos["fabriquinha.ambiente"], ambiente.id);
  assert.deepEqual(listarAmbientes(banco), [ambiente]);
});

test("alocar duas vezes para o mesmo Espaço devolve o mesmo container", async () => {
  const { conjunto, criacoes } = cenario();
  const primeiro = await conjunto.alocar(espacoA, projeto);
  assert.deepEqual(await conjunto.alocar(espacoA, projeto), primeiro);
  assert.equal(criacoes().length, 1);
});

test("alocar sem imagem do Ambiente no projeto recusa e não toca o docker", async () => {
  const { conjunto, docker } = cenario();
  await assert.rejects(conjunto.alocar(espacoA, projetoComImagem()), ErroDeRegra);
  assert.deepEqual(docker.registro(), []);
});

test("liberar limpa o container e grava livre; o próximo alocar da mesma imagem reusa o container, sem criar outro", async () => {
  const { docker, banco, conjunto, criacoes } = cenario();
  const primeiro = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const [livre] = listarAmbientes(banco);
  assert.equal(livre?.estado, "livre");
  assert.equal(livre.alocado_para, null);
  assert.notEqual(livre.liberado_em, null);
  assert.ok(docker.registro().some(([comando, id]) => comando === "exec" && id === primeiro.container_id));

  const segundo = await conjunto.alocar(espacoB, projeto);
  assert.equal(segundo.container_id, primeiro.container_id);
  assert.equal(segundo.alocado_para, "I-1.R2");
  assert.equal(criacoes().length, 1);
});

test("liberar de um Espaço sem container não faz nada", async () => {
  const { docker, conjunto } = cenario();
  await conjunto.liberar(espacoA);
  assert.deepEqual(docker.registro(), []);
});

test("liberar com a limpeza falhando grava sujo, e o sujo não é reusado", async () => {
  const { docker, banco, conjunto } = cenario();
  const primeiro = await conjunto.alocar(espacoA, projeto);
  docker.falharComando("exec", "container travado");
  await conjunto.liberar(espacoA);
  assert.equal(listarAmbientes(banco)[0]?.estado, "sujo");
  const segundo = await conjunto.alocar(espacoB, projeto);
  assert.notEqual(segundo.container_id, primeiro.container_id);
});

test("eliminar remove o container e grava eliminado, mas só do livre ou sujo", async () => {
  const { docker, banco, conjunto } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  await assert.rejects(conjunto.eliminar(ambiente.id), /alocado/);
  await conjunto.liberar(espacoA);
  await conjunto.eliminar(ambiente.id);
  assert.deepEqual(docker.containers(), []);
  assert.deepEqual(listarAmbientes(banco), []);
  const gravado = banco.prepare("SELECT estado FROM ambiente WHERE id = ?").get(ambiente.id);
  assert.equal(gravado?.estado, "eliminado");
  await assert.rejects(conjunto.eliminar(ambiente.id), /não existe/);
});

test("o livre de outra imagem não é reusado", async () => {
  const { conjunto, criacoes } = cenario();
  const daAlpine = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const daBusybox = await conjunto.alocar(espacoB, projetoComImagem("busybox"));
  assert.notEqual(daBusybox.container_id, daAlpine.container_id);
  assert.equal(daBusybox.imagem, "busybox");
  assert.equal(criacoes().length, 2);
});

test("dois alocar ao mesmo tempo com um só livre recebem containers diferentes", async () => {
  const { conjunto, banco } = cenario();
  const inicial = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const [primeiro, segundo] = await Promise.all([
    conjunto.alocar(espacoB, projeto),
    conjunto.alocar(espacoDaDemanda(projeto, "I-2", base), projeto),
  ]);
  assert.notEqual(primeiro.container_id, segundo.container_id);
  assert.ok([primeiro.container_id, segundo.container_id].includes(inicial.container_id));
  assert.equal(listarAmbientes(banco).filter(({ estado }) => estado === "alocado").length, 2);
});

test("dois alocar ao mesmo tempo para o mesmo Espaço deixam um só container, sem sobrar o do perdedor", async () => {
  const { conjunto, docker } = cenario();
  const resultados = await Promise.allSettled([conjunto.alocar(espacoA, projeto), conjunto.alocar(espacoA, projeto)]);
  assert.deepEqual(resultados.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  assert.equal(docker.containers().length, 1);
});

test("eliminarOciosos elimina o livre e o sujo parados além do limite e preserva o alocado", async () => {
  const { docker, banco, conjunto } = cenario();
  const espacoLivre = espacoDaDemanda(projeto, "I-1", base);
  const espacoSujo = espacoDaDemanda(projeto, "I-2", base);
  const espacoAlocado = espacoDaDemanda(projeto, "I-3", base);
  for (const espaco of [espacoLivre, espacoSujo, espacoAlocado]) await conjunto.alocar(espaco, projeto);
  await conjunto.liberar(espacoLivre);
  docker.falharComando("exec", "container travado");
  await conjunto.liberar(espacoSujo);

  await conjunto.eliminarOciosos(new Date(Date.now() + 31 * 60_000).toISOString());

  assert.deepEqual(
    listarAmbientes(banco).map(({ estado, alocado_para }) => ({ estado, alocado_para })),
    [{ estado: "alocado", alocado_para: "I-3" }],
  );
  assert.equal(docker.containers().length, 1);
});

test("eliminarOciosos preserva o livre que ainda não passou do limite", async () => {
  const { banco, conjunto } = cenario();
  await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  await conjunto.eliminarOciosos(new Date(Date.now() + 29 * 60_000).toISOString());
  assert.equal(listarAmbientes(banco)[0]?.estado, "livre");
  await conjunto.eliminarOciosos(new Date(Date.now() + 31 * 60_000).toISOString());
  assert.deepEqual(listarAmbientes(banco), []);
});

test("na subida elimina o órfão com rótulo, dá baixa no que o docker perdeu e nunca toca o que não tem rótulo", async () => {
  const { docker, banco, conjunto, pastaDoDocker } = cenario();
  const mantido = await conjunto.alocar(espacoA, projeto);
  const perdido = await conjunto.alocar(espacoB, projeto);
  const orfao = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "orfao" } });
  const sonar = docker.semearContainer({ imagem: "sonarqube" });
  const doUsuario = docker.semearContainer({ imagem: "postgres", rotulos: { dono: "usuario" } });
  rmSync(join(pastaDoDocker, "containers", perdido.container_id)); // o container some por fora da Fabriquinha
  const chamadasAntes = docker.registro().length;

  await conjunto.reconciliarNaSubida();

  assert.deepEqual(
    docker
      .containers()
      .map(({ id }) => id)
      .sort(),
    [mantido.container_id, sonar.id, doUsuario.id].sort(),
  );
  assert.deepEqual(
    listarAmbientes(banco).map(({ container_id }) => container_id),
    [mantido.container_id],
  );
  const chamadas = docker.registro().slice(chamadasAntes);
  assert.ok(chamadas.some((argumentos) => argumentos.includes(orfao.id)));
  for (const intocavel of [sonar.id, doUsuario.id])
    assert.equal(
      chamadas.some((argumentos) => argumentos.includes(intocavel)),
      false,
    );
});
