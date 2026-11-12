import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../../apoio-testes/docker_falso.ts";
import { listarAmbientes } from "../../armazenamento/ambientes.ts";
import { migrar } from "../../../compartilhado/armazenamento/banco.ts";
import { MIGRACOES } from "../../../compartilhado/armazenamento/migracoes/migracoes.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import {
  type EspacoDeTrabalho,
  espacoDaDemanda,
  espacoDaRodada,
} from "../../../repositorio/nucleo/espaco_de_trabalho.ts";
import { ocupanteDoAmbiente } from "../../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts";
import { Projeto } from "../../../projeto/nucleo/projeto.ts";
import { relogioDoSistema, relogioFixo } from "../../../compartilhado/nucleo/relogio.ts";
import { pastasDoAmbiente } from "../../infra/container/pastas_do_ambiente.ts";
import { GeradorDeAmbientes } from "../../infra/container/gerador_de_ambientes.ts";
import { ConjuntoDeAmbientes } from "./conjunto.ts";
import { PACOTE } from "../../../harness/pi/pi.ts";
import { validarESalvarConfiguracaoDoAmbiente } from "../configuracao_do_ambiente.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-conjunto-"));
// O container recebe o `auth.json` do pi do Auditor: o do teste, e não o da máquina.
const dirDoPiDoAuditorDoTeste = join(base, "pi-do-auditor");
mkdirSync(dirDoPiDoAuditorDoTeste);
writeFileSync(join(dirDoPiDoAuditorDoTeste, "auth.json"), "{}");
process.env.PI_CODING_AGENT_DIR = dirDoPiDoAuditorDoTeste;
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
/** O Espaço como o conjunto o vê. */
const noConjunto = (espaco: EspacoDeTrabalho) => ocupanteDoAmbiente(espaco, base, projeto.nome);
const espacoA = noConjunto(espacoDaDemanda(projeto, "I-1", base));
const espacoB = noConjunto(espacoDaRodada(projeto, "I-1", 2, base));
const SERVICO = {
  raiz: base,
  porta_da_api: 4999,
  home_do_usuario: base,
  pacote_do_harness: PACOTE,
  dir_do_harness_do_auditor: dirDoPiDoAuditorDoTeste,
};
const LIMITES = { tipo: "container", memoria_maxima_mb: 768, cpus: 1.5, ociosidade_para_eliminar_min: 30 };

let cenarios = 0;
function cenario() {
  const docker = instalarDockerFalso(join(base, `docker-${String(++cenarios)}`));
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  validarESalvarConfiguracaoDoAmbiente(banco, LIMITES);
  const gerador = new GeradorDeAmbientes();
  const conjunto = new ConjuntoDeAmbientes(banco, gerador, relogioDoSistema, SERVICO);
  // O `run --rm` é o container passageiro das regras de rede, não um Ambiente.
  const criacoes = () =>
    docker.registro().filter(([comando, opcao]) => (comando === "run" && opcao !== "--rm") || comando === "create");
  return { docker, banco, conjunto, gerador, criacoes, pastaDoDocker: join(base, `docker-${String(cenarios)}`) };
}

test("alocar sem livre cria o container com os limites da configuração e grava alocado", async () => {
  const { docker, banco, conjunto } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  const [gravado] = listarAmbientes(banco);
  assert.equal(gravado?.estado, "alocado");
  assert.equal(gravado.alocado_para, "I-1");
  assert.equal(gravado.imagem, "alpine");
  assert.equal(ambiente.id, gravado.id);
  const [container] = docker.containers();
  assert.equal(container?.id, ambiente.container_id);
  assert.equal(container.memoria, 768 * 1048576);
  assert.equal(container.cpus, 1.5);
  assert.equal(container.rotulos["fabriquinha.ambiente"], ambiente.id);
});

test("alocar cria o container com a pasta das worktrees do projeto, o .git e só as pastas próprias de sessão e de execução montados", async () => {
  const { docker, conjunto } = cenario();
  const ambiente = await conjunto.alocar(espacoB, projeto);
  const montagens = (docker.containers()[0]?.montagens ?? []).map((montagem) => montagem.split(":").slice(0, 2));
  const { sessoes, execucoes } = pastasDoAmbiente(base, ambiente.id);
  const origens = montagens.map(([origem]) => origem);
  assert.ok(origens.includes(join(base, "worktrees", "loja")), "a pasta das worktrees do projeto");
  assert.ok(origens.includes(join(base, ".git")), "o .git do projeto");
  assert.deepEqual(
    montagens.filter(([, destino]) => destino === join(base, "sessoes")),
    [[sessoes, join(base, "sessoes")]],
  );
  assert.deepEqual(
    montagens.filter(([, destino]) => destino === join(base, "execucoes")),
    [[execucoes, join(base, "execucoes")]],
    "onde mora o FABRIQUINHA_SAIDA",
  );
  assert.ok(
    !origens.includes(join(base, "sessoes")) && !origens.includes(join(base, "execucoes")),
    "nunca a pasta inteira",
  );
  assert.ok(
    !origens.includes(espacoDaRodada(projeto, "I-1", 2, base).pasta),
    "a worktree do Espaço não é montada: o git do container a cria",
  );
});

test("liberar tira do container as sessões e execuções do Espaço: o próximo Espaço não as vê, e o core ainda as lê", async () => {
  const { conjunto } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  mkdirSync(join(base, "execucoes", "E-501", "saida"), { recursive: true });
  mkdirSync(join(base, "sessoes", "s-501"), { recursive: true });
  ambiente.abrigarProcesso(join(base, "execucoes", "E-501"), "s-501");
  writeFileSync(join(base, "sessoes", "s-501", "2026_s-501.jsonl"), "do espaço A\n");
  const { sessoes, execucoes } = pastasDoAmbiente(base, ambiente.id);
  assert.ok(
    existsSync(join(sessoes, "s-501")) && existsSync(join(execucoes, "E-501")),
    "dentro, enquanto o Espaço usa",
  );

  await conjunto.liberar(espacoA);
  const outroEspaco = await conjunto.alocar(espacoB, projeto);
  assert.equal(outroEspaco.container_id, ambiente.container_id, "o mesmo container serve ao outro Espaço");
  assert.equal(
    existsSync(join(sessoes, "s-501")) || existsSync(join(execucoes, "E-501")),
    false,
    "o outro Espaço não as vê",
  );
  assert.equal(readlinkSync(join(base, "sessoes", "s-501")), join(base, "espacos", "I-1", "sessoes", "s-501"));
  assert.equal(readFileSync(join(base, "sessoes", "s-501", "2026_s-501.jsonl"), "utf8"), "do espaço A\n");
  assert.ok(existsSync(join(base, "execucoes", "E-501", "saida")));
});

test("o container reaproveitado para outra demanda do projeto continua com as worktrees dela montadas", async () => {
  const { docker, banco, conjunto, criacoes } = cenario();
  const primeiro = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const espacoDeOutraDemanda = noConjunto(espacoDaDemanda(projeto, "I-2", base));
  const segundo = await conjunto.alocar(espacoDeOutraDemanda, projeto);
  assert.equal(segundo.container_id, primeiro.container_id);
  assert.equal(criacoes().length, 1);
  assert.equal(listarAmbientes(banco)[0]?.alocado_para, "I-2");
  const origens = (docker.containers()[0]?.montagens ?? []).map((montagem) => montagem.split(":")[0] ?? "");
  const montadas = (caminho: string) => origens.some((origem) => caminho.startsWith(`${origem}/`));
  assert.ok(montadas(espacoDaDemanda(projeto, "I-2", base).pasta), "a worktree da outra demanda");
  const destinos = (docker.containers()[0]?.montagens ?? []).map((montagem) => montagem.split(":")[1] ?? "");
  assert.ok(destinos.includes(join(base, "execucoes")), "onde o container vê a pasta de qualquer processo do Espaço");
});

test("alocar duas vezes para o mesmo Espaço devolve o mesmo container", async () => {
  const { conjunto, criacoes } = cenario();
  const primeiro = await conjunto.alocar(espacoA, projeto);
  assert.deepEqual(await conjunto.alocar(espacoA, projeto), primeiro);
  assert.equal(criacoes().length, 1);
});

test("alocar e liberar gravam o instante do relógio recebido", async () => {
  const { banco, gerador } = cenario();
  const conjunto = new ConjuntoDeAmbientes(banco, gerador, relogioFixo("2026-01-02T03:04:05.000Z"), SERVICO);
  await conjunto.alocar(espacoA, projeto);
  assert.equal(listarAmbientes(banco)[0]?.criado_em, "2026-01-02T03:04:05.000Z");
  await conjunto.liberar(espacoA);
  assert.equal(listarAmbientes(banco)[0]?.liberado_em, "2026-01-02T03:04:05.000Z");
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
  assert.equal(listarAmbientes(banco)[0]?.alocado_para, "I-1.R2");
  assert.equal(criacoes().length, 1);
});

test("liberar de um Espaço sem container não faz nada", async () => {
  const { docker, conjunto } = cenario();
  await conjunto.liberar(espacoA);
  assert.deepEqual(docker.registro(), []);
});

test("liberar com a limpeza falhando grava sujo, e o sujo não é reusado", async () => {
  const { docker, banco, conjunto, pastaDoDocker } = cenario();
  const primeiro = await conjunto.alocar(espacoA, projeto);
  docker.falharComando("exec", "container travado");
  await conjunto.liberar(espacoA);
  rmSync(join(pastaDoDocker, "falhas", "exec"));
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
  const { banco, conjunto, criacoes } = cenario();
  const daAlpine = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const daBusybox = await conjunto.alocar(espacoB, projetoComImagem("busybox"));
  assert.notEqual(daBusybox.container_id, daAlpine.container_id);
  assert.deepEqual(
    listarAmbientes(banco)
      .map(({ imagem }) => imagem)
      .sort(),
    ["alpine", "busybox"],
  );
  assert.equal(criacoes().length, 2);
});

test("dois alocar ao mesmo tempo com um só livre recebem containers diferentes", async () => {
  const { conjunto, banco } = cenario();
  const inicial = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const [primeiro, segundo] = await Promise.all([
    conjunto.alocar(espacoB, projeto),
    conjunto.alocar(noConjunto(espacoDaDemanda(projeto, "I-2", base)), projeto),
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
  const espacoLivre = noConjunto(espacoDaDemanda(projeto, "I-1", base));
  const espacoSujo = noConjunto(espacoDaDemanda(projeto, "I-2", base));
  const espacoAlocado = noConjunto(espacoDaDemanda(projeto, "I-3", base));
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

test("eliminar de um livre enquanto um alocar o pega nunca entrega um container que sumiu", async () => {
  const { docker, banco, conjunto } = cenario();
  const inicial = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const eliminacao = conjunto.eliminar(inicial.id);
  const alocado = await conjunto.alocar(espacoB, projeto);
  await eliminacao;
  assert.notEqual(alocado.container_id, inicial.container_id);
  assert.deepEqual(
    docker.containers().map(({ id }) => id),
    [alocado.container_id],
  );
  assert.deepEqual(
    listarAmbientes(banco).map(({ id, container_id }) => ({ id, container_id })),
    [{ id: alocado.id, container_id: alocado.container_id }],
  );
});

test("eliminarOciosos de um livre ocioso enquanto um alocar o pega nunca entrega um container que sumiu", async () => {
  const { docker, banco, conjunto } = cenario();
  const inicial = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  const eliminacao = conjunto.eliminarOciosos(new Date(Date.now() + 31 * 60_000).toISOString());
  const alocado = await conjunto.alocar(espacoB, projeto);
  await eliminacao;
  assert.notEqual(alocado.container_id, inicial.container_id);
  assert.deepEqual(
    docker.containers().map(({ id }) => id),
    [alocado.container_id],
  );
  assert.deepEqual(
    listarAmbientes(banco).map(({ id, container_id }) => ({ id, container_id })),
    [{ id: alocado.id, container_id: alocado.container_id }],
  );
});

test("eliminar com o docker falhando deixa a linha eliminado e o container órfão para a próxima subida", async () => {
  const { docker, banco, conjunto, pastaDoDocker } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  await conjunto.liberar(espacoA);
  docker.falharComando("rm", "docker travado");
  await assert.rejects(conjunto.eliminar(ambiente.id), /docker travado/);
  assert.deepEqual(listarAmbientes(banco), []);
  assert.equal(docker.containers().length, 1);
  rmSync(join(pastaDoDocker, "falhas", "rm"));
  await conjunto.reconciliarNaSubida();
  assert.deepEqual(docker.containers(), []);
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

test("alocar devolve o Ambiente do container, que roda com a API do host e o pi próprio, e ambienteAlocadoPara o reencontra", async () => {
  const { conjunto, banco, docker } = cenario();
  assert.equal(conjunto.ambienteAlocadoPara(espacoA), undefined);
  const ambiente = await conjunto.alocar(espacoA, projeto);
  assert.equal(ambiente.id, listarAmbientes(banco)[0]?.id);
  const saida = await ambiente.executar({
    programa: 'echo "$FABRIQUINHA_API $PI_CODING_AGENT_DIR $HOME"',
    argumentos: [],
    cwd: base,
    env: { FABRIQUINHA_API: "http://127.0.0.1:4000" },
    noShell: true,
  });
  const homeDoContainer = docker.homeDoContainer(ambiente.container_id);
  assert.equal(
    saida.saida.trim(),
    `http://host.docker.internal:4999 ${join(homeDoContainer, ".pi", "agent")} ${homeDoContainer}`,
  );
  // O pi do container é a cópia do pi do Auditor, feita na criação.
  assert.equal(readFileSync(join(homeDoContainer, ".pi", "agent", "auth.json"), "utf8"), "{}");
  assert.equal(conjunto.ambienteAlocadoPara(espacoA)?.container_id, ambiente.container_id);
  assert.equal(conjunto.ambienteAlocadoPara(espacoB), undefined);
});

test("sem a raiz da Fabriquinha o conjunto recusa alocar, antes de criar o container", async () => {
  const { banco, gerador, conjunto, criacoes } = cenario();
  const semServico = new ConjuntoDeAmbientes(banco, gerador);
  await assert.rejects(semServico.alocar(espacoA, projeto), /não conhece a raiz/);
  assert.equal(criacoes().length, 0);
  await conjunto.alocar(espacoA, projeto);
  assert.throws(() => semServico.ambienteAlocadoPara(espacoA), ErroDeRegra);
});

test("na subida o container ainda alocado é de um Espaço morto pelo reinício: o conjunto o limpa e o devolve livre", async () => {
  const { docker, banco, conjunto, gerador } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  const chamadasAntes = docker.registro().length;

  await conjunto.reconciliarNaSubida();

  const [livre] = listarAmbientes(banco);
  assert.deepEqual([livre?.estado, livre?.alocado_para], ["livre", null]);
  assert.notEqual(livre?.liberado_em, null);
  const limpeza = docker
    .registro()
    .slice(chamadasAntes)
    .find(([comando, alvo]) => comando === "exec" && alvo === ambiente.container_id);
  assert.match(String(limpeza?.at(-1)), /kill -9 -1; find \/tmp \/trabalho/);
  assert.equal((await gerador.listarDaFabriquinha()).length, 1);
  assert.equal((await conjunto.alocar(espacoB, projeto)).container_id, ambiente.container_id);
});

test("na subida, a limpeza que falha deixa o alocado sujo, e o que o docker perdeu não é limpo", async () => {
  const { docker, banco, conjunto, pastaDoDocker } = cenario();
  const comFalha = await conjunto.alocar(espacoA, projeto);
  const perdido = await conjunto.alocar(espacoB, projeto);
  rmSync(join(pastaDoDocker, "containers", perdido.container_id));
  docker.falharComando("exec", "container travado");

  await conjunto.reconciliarNaSubida();

  assert.deepEqual(
    listarAmbientes(banco).map(({ container_id, estado }) => ({ container_id, estado })),
    [{ container_id: comFalha.container_id, estado: "sujo" }],
  );
});

test("ambientePorId devolve o Ambiente do container gravado, e undefined para o desconhecido ou eliminado", async () => {
  const { conjunto } = cenario();
  const ambiente = await conjunto.alocar(espacoA, projeto);
  assert.equal(conjunto.ambientePorId(ambiente.id)?.container_id, ambiente.container_id);
  assert.equal(conjunto.ambientePorId("outro"), undefined);
  await conjunto.liberar(espacoA);
  await conjunto.eliminar(ambiente.id);
  assert.equal(conjunto.ambientePorId(ambiente.id), undefined);
});
