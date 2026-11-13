import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { inserirAmbienteAlocado, listarAmbientes } from "../../sandboxes/armazenamento/ambientes.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDaDemanda } from "../../../repositorio/publico.ts";
import { espacoDaRodada, ocupanteDoAmbiente } from "../../../../../apoio-testes/repositorio_de_teste.ts";
import { Projeto } from "../../../demandas/publico.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { pastasDoAmbiente } from "../../sandboxes/infra/pastas_do_ambiente.ts";
import { AmbienteContainer } from "../infra/container/ambiente_container.ts";
import { AmbienteHostLocal } from "../infra/host_local/ambiente_host_local.ts";
import { montarGestaoDeAmbientes } from "./gestao_de_ambientes.ts";
import { PACOTE } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";

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

/** O container alocado que a gestão devolve, com o id do docker. */
function comoContainer(ambiente: unknown): AmbienteContainer {
  assert.ok(ambiente instanceof AmbienteContainer);
  return ambiente;
}

let cenarios = 0;
async function cenario({ relogio = relogioFixo("2026-11-13T10:00:00.000Z"), tipo = "container" } = {}) {
  const pastaDoDocker = join(base, `docker-${String(++cenarios)}`);
  const docker = instalarDockerFalso(pastaDoDocker);
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  /** A Configuração de quem monta, que o teste troca como a tela troca a gravada. */
  const configuracao = { atual: ConfiguracaoDoAmbiente.parse({ ...LIMITES, tipo }) };
  const erros: unknown[] = [];
  const gestao = await montarGestaoDeAmbientes({
    banco,
    configuracao: () => configuracao.atual,
    servico: SERVICO,
    relogio,
    registrarErro: (erro) => erros.push(erro),
  });
  after(() => gestao.parar());
  /** As chamadas ao docker depois da montagem, que no `container` confere o conjunto com ele. */
  const chamadasDaMontagem = docker.registro().length;
  const chamadasDepoisDaMontagem = () => docker.registro().slice(chamadasDaMontagem);
  // O `run --rm` é o container passageiro das regras de rede, não um Ambiente.
  const criacoes = () =>
    docker.registro().filter(([comando, opcao]) => (comando === "run" && opcao !== "--rm") || comando === "create");
  const alocar = async (ocupante = espacoA, doProjeto = projeto) =>
    comoContainer(await gestao.alocar(ocupante, doProjeto));
  return { docker, banco, gestao, configuracao, erros, criacoes, alocar, pastaDoDocker, chamadasDepoisDaMontagem };
}

/** Uma segunda montagem sobre o mesmo banco e o mesmo docker: o serviço que sobe de novo. */
async function subirDeNovo(banco: DatabaseSync, tipo = "container") {
  const erros: unknown[] = [];
  const gestao = await montarGestaoDeAmbientes({
    banco,
    configuracao: () => ConfiguracaoDoAmbiente.parse({ ...LIMITES, tipo }),
    servico: SERVICO,
    registrarErro: (erro) => erros.push(erro),
  });
  after(() => gestao.parar());
  return { gestao, erros };
}

test("alocar sem livre cria o container com os limites da configuração e grava alocado", async () => {
  const { docker, banco, alocar } = await cenario();
  const ambiente = await alocar();
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
  const { docker, alocar } = await cenario();
  const ambiente = await alocar(espacoB);
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

test("limpar tira do container as sessões e execuções do Espaço: o próximo Espaço não as vê, e o core ainda as lê", async () => {
  const { gestao, alocar } = await cenario();
  const ambiente = await alocar();
  mkdirSync(join(base, "execucoes", "E-501", "saida"), { recursive: true });
  mkdirSync(join(base, "sessoes", "s-501"), { recursive: true });
  ambiente.abrigarProcesso(join(base, "execucoes", "E-501"), "s-501");
  writeFileSync(join(base, "sessoes", "s-501", "2026_s-501.jsonl"), "do espaço A\n");
  const { sessoes, execucoes } = pastasDoAmbiente(base, ambiente.id);
  assert.ok(
    existsSync(join(sessoes, "s-501")) && existsSync(join(execucoes, "E-501")),
    "dentro, enquanto o Espaço usa",
  );

  await gestao.limpar(ambiente.id);
  const outroEspaco = await alocar(espacoB);
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
  const { docker, banco, gestao, alocar, criacoes } = await cenario();
  const primeiro = await alocar();
  await gestao.limpar(primeiro.id);
  const espacoDeOutraDemanda = noConjunto(espacoDaDemanda(projeto, "I-2", base));
  const segundo = await alocar(espacoDeOutraDemanda);
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
  const { alocar, criacoes } = await cenario();
  const primeiro = await alocar();
  assert.equal((await alocar()).container_id, primeiro.container_id);
  assert.equal(criacoes().length, 1);
});

test("alocar e limpar gravam o instante do relógio recebido", async () => {
  const { banco, gestao, alocar } = await cenario({ relogio: relogioFixo("2026-01-02T03:04:05.000Z") });
  const ambiente = await alocar();
  assert.equal(listarAmbientes(banco)[0]?.criado_em, "2026-01-02T03:04:05.000Z");
  await gestao.limpar(ambiente.id);
  assert.equal(listarAmbientes(banco)[0]?.liberado_em, "2026-01-02T03:04:05.000Z");
});

test("no host_local, ou para o projeto sem imagem do Ambiente, alocar devolve o Ambiente do serviço sem tocar o docker", async () => {
  const { gestao, configuracao, chamadasDepoisDaMontagem } = await cenario();
  const doServico = await gestao.alocar(espacoA, projetoComImagem());
  assert.ok(doServico instanceof AmbienteHostLocal);
  configuracao.atual = { ...configuracao.atual, tipo: "host_local" };
  assert.equal(await gestao.alocar(espacoA, projeto), doServico);
  assert.deepEqual(chamadasDepoisDaMontagem(), []);
});

test("limpar devolve o container livre; o próximo alocar da mesma imagem o reusa, sem criar outro", async () => {
  const { docker, banco, gestao, alocar, criacoes } = await cenario();
  const primeiro = await alocar();
  await gestao.limpar(primeiro.id);
  const [livre] = listarAmbientes(banco);
  assert.equal(livre?.estado, "livre");
  assert.equal(livre.alocado_para, null);
  assert.notEqual(livre.liberado_em, null);
  assert.ok(docker.registro().some(([comando, id]) => comando === "exec" && id === primeiro.container_id));

  const segundo = await alocar(espacoB);
  assert.equal(segundo.container_id, primeiro.container_id);
  assert.equal(listarAmbientes(banco)[0]?.alocado_para, "I-1.R2");
  assert.equal(criacoes().length, 1);
});

test("limpar o Ambiente do serviço, o desconhecido ou o que já está livre não faz nada", async () => {
  const { docker, banco, gestao, alocar, chamadasDepoisDaMontagem } = await cenario();
  await gestao.limpar(gestao.ambienteDo().id);
  await gestao.limpar("desconhecido");
  assert.deepEqual(chamadasDepoisDaMontagem(), []);
  const ambiente = await alocar();
  await gestao.limpar(ambiente.id);
  const chamadasAntes = docker.registro().length;
  const liberadoEm = listarAmbientes(banco)[0]?.liberado_em;
  await gestao.limpar(ambiente.id);
  assert.equal(docker.registro().length, chamadasAntes);
  assert.equal(listarAmbientes(banco)[0]?.liberado_em, liberadoEm);
});

test("limpar com a limpeza falhando grava sujo, e o sujo não é reusado", async () => {
  const { docker, banco, gestao, alocar, pastaDoDocker } = await cenario();
  const primeiro = await alocar();
  docker.falharComando("exec", "container travado");
  await gestao.limpar(primeiro.id);
  rmSync(join(pastaDoDocker, "falhas", "exec"));
  assert.equal(listarAmbientes(banco)[0]?.estado, "sujo");
  const segundo = await alocar(espacoB);
  assert.notEqual(segundo.container_id, primeiro.container_id);
});

test("deletar remove o container e grava eliminado, mas só do livre ou sujo", async () => {
  const { docker, banco, gestao, alocar } = await cenario();
  const ambiente = await alocar();
  await assert.rejects(gestao.deletar(ambiente.id), /alocado/);
  await gestao.limpar(ambiente.id);
  await gestao.deletar(ambiente.id);
  assert.deepEqual(docker.containers(), []);
  assert.deepEqual(listarAmbientes(banco), []);
  const gravado = banco.prepare("SELECT estado FROM ambiente WHERE id = ?").get(ambiente.id);
  assert.equal(gravado?.estado, "eliminado");
  await assert.rejects(gestao.deletar(ambiente.id), /não existe/);
});

test("no host_local, deletar ainda elimina o container que sobrou do tipo container, e o alocado é recusado", async () => {
  const { docker, banco, gestao, alocar, configuracao } = await cenario();
  const sobra = await alocar();
  const alocado = await alocar(espacoB);
  await gestao.limpar(sobra.id);
  configuracao.atual = { ...configuracao.atual, tipo: "host_local" };
  await assert.rejects(gestao.deletar(alocado.id), ErroDeRegra);
  await gestao.deletar(sobra.id);
  assert.deepEqual(
    listarAmbientes(banco).map(({ id }) => id),
    [alocado.id],
  );
  assert.deepEqual(
    docker.containers().map(({ id }) => id),
    [alocado.container_id],
  );
});

test("o livre de outra imagem não é reusado", async () => {
  const { banco, gestao, alocar, criacoes } = await cenario();
  const daAlpine = await alocar();
  await gestao.limpar(daAlpine.id);
  const daBusybox = await alocar(espacoB, projetoComImagem("busybox"));
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
  const { banco, gestao, alocar } = await cenario();
  const inicial = await alocar();
  await gestao.limpar(inicial.id);
  const [primeiro, segundo] = await Promise.all([
    alocar(espacoB),
    alocar(noConjunto(espacoDaDemanda(projeto, "I-2", base))),
  ]);
  assert.notEqual(primeiro.container_id, segundo.container_id);
  assert.ok([primeiro.container_id, segundo.container_id].includes(inicial.container_id));
  assert.equal(listarAmbientes(banco).filter(({ estado }) => estado === "alocado").length, 2);
});

test("dois alocar ao mesmo tempo para o mesmo Espaço deixam um só container, sem sobrar o do perdedor", async () => {
  const { gestao, docker } = await cenario();
  const resultados = await Promise.allSettled([gestao.alocar(espacoA, projeto), gestao.alocar(espacoA, projeto)]);
  assert.deepEqual(resultados.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  assert.equal(docker.containers().length, 1);
});

/** O relógio que o teste avança, e o tique do minuto que liga a eliminação dos ociosos. */
function relogioQueAvanca() {
  let instante = "2026-11-13T10:00:00.000Z";
  return {
    relogio: { agora: () => instante },
    aos: (minuto: number) => {
      instante = new Date(Date.parse("2026-11-13T10:00:00.000Z") + minuto * 60_000).toISOString();
    },
  };
}

test("de minuto em minuto, a gestão elimina o livre e o sujo parados além do limite e preserva o alocado", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { relogio, aos } = relogioQueAvanca();
  const { docker, banco, gestao, alocar } = await cenario({ relogio });
  const livre = await alocar(noConjunto(espacoDaDemanda(projeto, "I-1", base)));
  const sujo = await alocar(noConjunto(espacoDaDemanda(projeto, "I-2", base)));
  await alocar(noConjunto(espacoDaDemanda(projeto, "I-3", base)));
  await gestao.limpar(livre.id);
  docker.falharComando("exec", "container travado");
  await gestao.limpar(sujo.id);

  // A batida reserva os ociosos na hora, sem esperar o docker; o `parar` espera a eliminação que ela disparou.
  aos(29);
  t.mock.timers.tick(60_000);
  assert.equal(listarAmbientes(banco).length, 3, "antes do limite, nada sai");
  await setImmediate(); // a eliminação da batida anterior termina
  aos(31);
  t.mock.timers.tick(60_000);
  await gestao.parar();

  assert.deepEqual(
    listarAmbientes(banco).map(({ estado, alocado_para }) => ({ estado, alocado_para })),
    [{ estado: "alocado", alocado_para: "I-3" }],
  );
  assert.equal(docker.containers().length, 1);
});

test("a eliminação dos ociosos só roda no container, uma por vez, e a falha vai para o registro de erros", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { relogio, aos } = relogioQueAvanca();
  const { docker, banco, gestao, alocar, configuracao, erros, pastaDoDocker } = await cenario({ relogio });
  const ambiente = await alocar();
  await gestao.limpar(ambiente.id);
  aos(31);
  configuracao.atual = { ...configuracao.atual, tipo: "host_local" };
  t.mock.timers.tick(60_000);
  assert.equal(listarAmbientes(banco).length, 1, "no host_local, o conjunto fica como está");

  configuracao.atual = { ...configuracao.atual, tipo: "container" };
  docker.falharComando("rm", "docker travado");
  t.mock.timers.tick(60_000);
  t.mock.timers.tick(60_000); // a segunda batida acha a primeira eliminação em andamento e não dispara outra
  await gestao.parar();
  rmSync(join(pastaDoDocker, "falhas", "rm"));
  assert.equal(docker.registro().filter(([comando]) => comando === "rm").length, 1);
  assert.match(String(erros), /docker travado/);
});

test("a batida cuja Configuração não se lê vai para o registro de erros, sem lançar", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { gestao, configuracao, erros } = await cenario();
  const ilegivel = new Error("database is not open");
  Object.defineProperty(configuracao, "atual", {
    get: () => {
      throw ilegivel;
    },
  });
  t.mock.timers.tick(60_000);
  await gestao.parar();
  assert.deepEqual(erros, [ilegivel]);
});

test("parar desliga a eliminação dos ociosos", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { relogio, aos } = relogioQueAvanca();
  const { banco, gestao, alocar } = await cenario({ relogio });
  const ambiente = await alocar();
  await gestao.limpar(ambiente.id);
  await gestao.parar();
  aos(31);
  t.mock.timers.tick(60_000);
  await gestao.parar();
  assert.equal(listarAmbientes(banco).length, 1);
});

test("deletar um livre enquanto um alocar o pega nunca entrega um container que sumiu", async () => {
  const { docker, banco, gestao, alocar } = await cenario();
  const inicial = await alocar();
  await gestao.limpar(inicial.id);
  const eliminacao = gestao.deletar(inicial.id);
  const alocado = await alocar(espacoB);
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

test("deletar com o docker falhando deixa a linha eliminado e o container órfão para a próxima subida", async () => {
  const { docker, banco, gestao, alocar, pastaDoDocker } = await cenario();
  const ambiente = await alocar();
  await gestao.limpar(ambiente.id);
  docker.falharComando("rm", "docker travado");
  await assert.rejects(gestao.deletar(ambiente.id), /docker travado/);
  assert.deepEqual(listarAmbientes(banco), []);
  assert.equal(docker.containers().length, 1);
  rmSync(join(pastaDoDocker, "falhas", "rm"));
  await subirDeNovo(banco);
  assert.deepEqual(docker.containers(), []);
});

test("na subida elimina o órfão com rótulo, dá baixa no que o docker perdeu e nunca toca o que não tem rótulo", async () => {
  const { docker, banco, alocar, pastaDoDocker } = await cenario();
  const mantido = await alocar();
  const perdido = await alocar(espacoB);
  const orfao = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "orfao" } });
  const sonar = docker.semearContainer({ imagem: "sonarqube" });
  const doUsuario = docker.semearContainer({ imagem: "postgres", rotulos: { dono: "usuario" } });
  rmSync(join(pastaDoDocker, "containers", perdido.container_id)); // o container some por fora da Fabriquinha
  const chamadasAntes = docker.registro().length;

  await subirDeNovo(banco);

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

test("na subida do host_local o docker nunca é chamado; com o docker fora do ar, a falha vai para o registro e a gestão sobe", async () => {
  const { docker, banco, alocar } = await cenario();
  await alocar();
  const chamadasAntes = docker.registro().length;
  await subirDeNovo(banco, "host_local");
  assert.equal(docker.registro().length, chamadasAntes);

  docker.falharComando("ps", "Cannot connect to the Docker daemon");
  const { gestao, erros } = await subirDeNovo(banco);
  assert.match(String(erros), /Cannot connect to the Docker daemon/);
  assert.equal(listarAmbientes(banco)[0]?.estado, "alocado", "a conferência fica para a próxima subida");
  assert.ok(gestao.ambienteDo("I-1") instanceof AmbienteContainer);
});

test("alocar devolve o Ambiente do container, que roda com a API do host e o pi próprio, e ambienteDo o reencontra", async () => {
  const { gestao, banco, docker, alocar, configuracao } = await cenario();
  assert.ok(gestao.ambienteDo("I-1") instanceof AmbienteHostLocal, "sem alocação, o do serviço");
  const ambiente = await alocar();
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
  assert.equal(comoContainer(gestao.ambienteDo("I-1")).container_id, ambiente.container_id);
  assert.ok(gestao.ambienteDo("I-1.R2") instanceof AmbienteHostLocal);
  assert.equal(gestao.ambienteDo(), gestao.ambienteDo("I-1.R2"));
  configuracao.atual = { ...configuracao.atual, tipo: "host_local" };
  assert.ok(gestao.ambienteDo("I-1") instanceof AmbienteHostLocal, "no host_local, sempre o do serviço");
});

test("na subida o container ainda alocado é de um Espaço morto pelo reinício: a gestão o limpa e o devolve livre", async () => {
  const { docker, banco, alocar } = await cenario();
  const ambiente = await alocar();
  const chamadasAntes = docker.registro().length;

  const { gestao } = await subirDeNovo(banco);

  const [livre] = listarAmbientes(banco);
  assert.deepEqual([livre?.estado, livre?.alocado_para], ["livre", null]);
  assert.notEqual(livre?.liberado_em, null);
  const limpeza = docker
    .registro()
    .slice(chamadasAntes)
    .find(([comando, alvo]) => comando === "exec" && alvo === ambiente.container_id);
  assert.match(String(limpeza?.at(-1)), /kill -9 -1; find \/tmp \/trabalho/);
  assert.equal(comoContainer(await gestao.alocar(espacoB, projeto)).container_id, ambiente.container_id);
});

test("na subida, a limpeza que falha deixa o alocado sujo, e o que o docker perdeu não é limpo", async () => {
  const { docker, banco, alocar, pastaDoDocker } = await cenario();
  const comFalha = await alocar();
  const perdido = await alocar(espacoB);
  rmSync(join(pastaDoDocker, "containers", perdido.container_id));
  docker.falharComando("exec", "container travado");

  await subirDeNovo(banco);

  assert.deepEqual(
    listarAmbientes(banco).map(({ container_id, estado }) => ({ container_id, estado })),
    [{ container_id: comFalha.container_id, estado: "sujo" }],
  );
});

test("listar traz o conjunto com o uso de CPU e de memória medido de cada container numa chamada só ao docker", async () => {
  const { docker, banco, gestao, alocar } = await cenario();
  const ocupado = await alocar();
  const livre = await alocar(espacoB);
  await gestao.limpar(livre.id);
  docker.mudarUso(ocupado.container_id, { cpu: "37.50%", memoria: "300MiB / 768MiB" });
  docker.mudarUso(livre.container_id, { cpu: "0.00%", memoria: "2MiB / 768MiB" });
  const chamadasAntes = docker.registro().length;

  const conjunto = await gestao.listar();

  assert.deepEqual(conjunto, [
    { ...listarAmbientes(banco)[0], medido: { cpus: 0.375, memoria_mb: 300 } },
    { ...listarAmbientes(banco)[1], medido: { cpus: 0, memoria_mb: 2 } },
  ]);
  assert.deepEqual(
    docker
      .registro()
      .slice(chamadasAntes)
      .map(([comando]) => comando),
    ["stats"],
  );
});

test("listar deixa o medido de fora no host_local, sem chamar o docker, e quando o docker não responde", async () => {
  const { docker, banco, gestao, alocar, configuracao } = await cenario();
  await alocar();
  const gravados = listarAmbientes(banco);
  docker.falharComando("stats", "Cannot connect to the Docker daemon");
  assert.deepEqual(await gestao.listar(), gravados);

  configuracao.atual = { ...configuracao.atual, tipo: "host_local" };
  const chamadasAntes = docker.registro().length;
  assert.deepEqual(await gestao.listar(), gravados);
  assert.equal(docker.registro().length, chamadasAntes);
});

test("listar o conjunto vazio não chama o docker, e o container gravado vem com o uso que o docker mede dele", async () => {
  const { docker, banco, gestao, chamadasDepoisDaMontagem } = await cenario();
  assert.deepEqual(await gestao.listar(), []);
  assert.deepEqual(chamadasDepoisDaMontagem(), []);
  inserirAmbienteAlocado(banco, {
    id: "amb-1",
    container_id: docker.semearContainer({ uso: { cpu: "10.00%", memoria: "1GiB / 2GiB" } }).id,
    imagem: "alpine",
    alocado_para: "I-9",
    criado_em: "2026-11-13T10:00:00.000Z",
  });
  const [gravado] = listarAmbientes(banco);
  assert.deepEqual(await gestao.listar(), [{ ...gravado, medido: { cpus: 0.1, memoria_mb: 1024 } }]);
});
