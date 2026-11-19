// O conjunto fixo ou variável de sandboxes (MELHORIAS §8, regras 3 e 4, e §13, item 1): a capacidade, a vaga que um
// parado cede e a ociosidade que só o variável elimina, até o mínimo.
import { INSTALACAO_DO_PI_FALSO } from "../../../../../apoio-testes/falsos/pi_falso.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { ErroDeRegra, ErroExterno } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/system/banco_da_fabriquinha.ts";
import { identidadeDaInstalacaoDoHarness, PACOTE } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";
import {
  alocarAmbienteLivreDaImagem,
  inserirAmbienteAlocado,
  lerNomeDaInstancia,
  liberarAmbiente,
  listarAmbientes,
} from "../armazenamento/ambientes.ts";
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
/** Espera o conjunto registrar `quantos` ocupantes na fila: o `alocar` chega à fila depois de alguns `await`. */
async function esperarNaFila(conjunto: ConjuntoDeSandboxes, quantos: number): Promise<void> {
  for (let tentativa = 0; conjunto.ocupantesNaFilaDeEspera().length !== quantos; tentativa++) {
    assert.ok(tentativa < 200, `a fila não chegou a ${String(quantos)}: ${conjunto.ocupantesNaFilaDeEspera().join()}`);
    await new Promise((resolver) => setTimeout(resolver, 5));
  }
}

/** O pi do host de um cenário: a pasta do pacote, que o `npm install -g` troca por outra no mesmo caminho. */
function piDoHost(raiz: string) {
  let executavel = "";
  const instalar = (arquivoDoExecutavel: string) => {
    // A nova nasce antes de a antiga sair, como no npm; assim não herda o inode dela.
    mkdirSync(`${raiz}-nova`);
    writeFileSync(join(`${raiz}-nova`, "package.json"), "{}");
    writeFileSync(join(`${raiz}-nova`, arquivoDoExecutavel), "");
    rmSync(raiz, { recursive: true, force: true });
    renameSync(`${raiz}-nova`, raiz);
    executavel = join(raiz, arquivoDoExecutavel);
  };
  instalar("cli.js");
  return {
    reinstalar: instalar,
    remover: () => {
      rmSync(raiz, { recursive: true });
    },
    instalacao: () => {
      if (!existsSync(raiz)) throw new ErroDeRegra("não achei o pi no host", "instale o pi");
      return { comando: "pi", executavel, raiz };
    },
  };
}

let cenarios = 0;
function cenario(conjuntoConfigurado: Record<string, unknown>) {
  const pastaDoDocker = join(base, `docker-${String(++cenarios)}`);
  const docker = instalarDockerFalso(pastaDoDocker);
  const pi = piDoHost(join(base, `pi-${String(cenarios)}`));
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  const nomeDaInstancia = lerNomeDaInstancia(banco);
  const configuracao = ConfiguracaoDoAmbiente.parse({
    tipo: "container",
    ociosidade_para_eliminar_min: 30,
    ...conjuntoConfigurado,
  });
  // O relógio que o teste avança: a ordem das liberações decide quem o conjunto elimina primeiro.
  let instante: Instante = "2026-11-13T10:00:00.000Z";
  const relogio = { agora: () => instante };
  const conjunto = new ConjuntoDeSandboxes(
    banco,
    new GeradorDeAmbientes(nomeDaInstancia),
    () => configuracao,
    { ...SERVICO, instalacao_do_harness: pi.instalacao },
    relogio,
  );
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
    pi,
    nomeDaInstancia,
    conjunto,
    liberar,
    criacoes,
    estados,
    pastaDoDocker,
    /** A imagem que o conjunto gera para o projeto, como o gerador a nomeia. */
    imagemDe: (projeto: typeof doNode) => new GeradorDeAmbientes(nomeDaInstancia).garantirImagem(projeto),
    aos: (minuto: number) => {
      instante = new Date(Date.parse("2026-11-13T10:00:00.000Z") + minuto * 60_000).toISOString();
    },
  };
}

test("variável na capacidade e sem parado: o ocupante espera na fila sem criar container; liberado um, ele o reusa", async () => {
  const { conjunto, criacoes, estados, liberar, imagemDe } = cenario({
    conjunto: "variavel",
    capacidade_do_conjunto: 2,
  });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  await conjunto.alocar(ocupante("I-2"), doNode);

  const espera = conjunto.alocar(ocupante("I-3"), doNode);
  await esperarNaFila(conjunto, 1);
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-3"]);
  assert.equal(criacoes(), 2);

  await liberar("I-1");
  const reusado = await espera;
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), []);
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

test("dois alocar ao mesmo tempo na última vaga: um recebe o container, o outro espera na fila e o recebe quando o primeiro o libera", async () => {
  const { docker, conjunto, liberar } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 1 });
  const pedidos = new Map(["I-1", "I-2"].map((dono) => [dono, conjunto.alocar(ocupante(dono), doNode)] as const));
  await esperarNaFila(conjunto, 1);
  // Qual dos dois chega primeiro à vaga é do acaso: o outro é o que espera.
  const [quemEspera] = conjunto.ocupantesNaFilaDeEspera();
  const quemRecebeu = quemEspera === "I-1" ? "I-2" : "I-1";
  assert.equal((await pedidos.get(quemRecebeu))?.alocado_para, quemRecebeu);
  assert.equal(docker.containers().length, 1);

  await liberar(quemRecebeu);
  assert.equal((await pedidos.get(String(quemEspera)))?.alocado_para, quemEspera);
  assert.equal(docker.containers().length, 1);
});

test("os ocupantes na fila recebem o sandbox na ordem de chegada, um a cada liberação", async () => {
  const { conjunto, liberar } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const recebidos: string[] = [];
  const esperas: Promise<unknown>[] = [];
  for (const [indice, dono] of ["I-2", "I-3", "I-4"].entries()) {
    esperas.push(conjunto.alocar(ocupante(dono), doNode).then(() => recebidos.push(dono)));
    await esperarNaFila(conjunto, indice + 1);
  }
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-2", "I-3", "I-4"]);

  for (const [indice, dono] of ["I-1", "I-2", "I-3"].entries()) {
    await liberar(dono);
    await esperarNaFila(conjunto, 2 - indice);
    assert.equal(recebidos.length, indice + 1);
  }
  await Promise.all(esperas);
  assert.deepEqual(recebidos, ["I-2", "I-3", "I-4"]);
});

/** Um conjunto cujo próximo `garantirImagem` de um projeto fica preso numa promessa até o teste soltá-lo. */
async function cenarioComImagemPresa(capacidade: number) {
  const { banco, pi, nomeDaInstancia, imagemDe } = cenario({ conjunto: "fixo", capacidade_do_conjunto: capacidade });
  let preso: { projeto: object; chegou: () => void; soltura: Promise<void> } | undefined;
  class GeradorComImagemPresa extends GeradorDeAmbientes {
    override async garantirImagem(projeto: Parameters<GeradorDeAmbientes["garantirImagem"]>[0]) {
      const atual = preso;
      if (atual?.projeto === projeto) {
        preso = undefined;
        atual.chegou();
        await atual.soltura;
      }
      return super.garantirImagem(projeto);
    }
  }
  const conjunto = new ConjuntoDeSandboxes(
    banco,
    new GeradorComImagemPresa(nomeDaInstancia),
    () => ConfiguracaoDoAmbiente.parse({ tipo: "container", conjunto: "fixo", capacidade_do_conjunto: capacidade }),
    { ...SERVICO, instalacao_do_harness: pi.instalacao },
  );
  /** Prende o próximo `garantirImagem` do projeto: `chegou` resolve quando ele pára ali; `soltar` o deixa seguir. */
  const prenderProximaImagemDe = (projeto: object) => {
    let soltar: () => void = () => undefined;
    let chegou: () => void = () => undefined;
    const soltura = new Promise<void>((resolver) => (soltar = resolver));
    const naPrisao = new Promise<void>((resolver) => (chegou = resolver));
    preso = { projeto, chegou, soltura };
    return { naPrisao, soltar };
  };
  const liberarDe = async (dono: string) => {
    const alocado = conjunto.alocacaoDe(dono);
    assert.ok(alocado);
    await conjunto.limpar(alocado.id);
  };
  return { conjunto, banco, imagem: await imagemDe(doNode), prenderProximaImagemDe, liberarDe };
}

test("a vaga liberada vai ao primeiro da fila mesmo se ele está refazendo a alocação: o segundo não o pula", async () => {
  const { conjunto, prenderProximaImagemDe, liberarDe } = await cenarioComImagemPresa(1);
  await conjunto.alocar(ocupante("I-1"), doNode);
  const projetoDoB = { ...doNode };
  const esperaDoA = conjunto.alocar(ocupante("I-2"), doNode);
  await esperarNaFila(conjunto, 1);
  const esperaDoB = conjunto.alocar(ocupante("I-3"), projetoDoB);
  await esperarNaFila(conjunto, 2);
  const esperaDoC = conjunto.alocar(ocupante("I-4"), doNode);
  await esperarNaFila(conjunto, 3);

  // A recebe a vaga e, ao sair da fila, acorda B, que fica preso no garantirImagem da retentativa.
  const { naPrisao, soltar } = prenderProximaImagemDe(projetoDoB);
  await liberarDe("I-1");
  assert.equal((await esperaDoA).alocado_para, "I-2");
  await naPrisao;

  // A liberação real chega com B refazendo: C não pode tomá-la.
  await liberarDe("I-2");
  await new Promise((resolver) => setTimeout(resolver, 50));
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-3", "I-4"]);
  soltar();
  assert.equal((await esperaDoB).alocado_para, "I-3");
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-4"]);

  await liberarDe("I-3");
  assert.equal((await esperaDoC).alocado_para, "I-4");
});

test("a cabeça da fila que refaz a alocação, sozinha na fila, não perde a liberação que cai na retentativa", async () => {
  const { conjunto, banco, imagem, prenderProximaImagemDe, liberarDe } = await cenarioComImagemPresa(1);
  await conjunto.alocar(ocupante("I-1"), doNode);
  const projetoDoA = { ...doNode };
  const esperaDoA = conjunto.alocar(ocupante("I-2"), projetoDoA);
  await esperarNaFila(conjunto, 1);

  // A acorda com a primeira liberação e fica presa; um ladrão leva o sandbox, que é devolvido (liberação no meio da
  // retentativa) e levado de novo antes de A seguir: A volta sem vaga, mas com a marca, e refaz em vez de dormir.
  const { naPrisao, soltar } = prenderProximaImagemDe(projetoDoA);
  await liberarDe("I-1");
  await naPrisao;
  const ladraoLevaOSandbox = () => alocarAmbienteLivreDaImagem(banco, imagem, "ladrao");
  const sandbox = ladraoLevaOSandbox();
  assert.ok(sandbox);
  await conjunto.limpar(sandbox.id);
  assert.ok(ladraoLevaOSandbox());
  soltar();
  await new Promise((resolver) => setTimeout(resolver, 50));
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-2"]);

  await conjunto.limpar(sandbox.id);
  assert.equal((await esperaDoA).alocado_para, "I-2");
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), []);
});

test("quem chega depois que o sandbox foi liberado entra atrás de quem já espera", async () => {
  const { conjunto, liberar } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const esperaDoI2 = conjunto.alocar(ocupante("I-2"), doNode);
  await esperarNaFila(conjunto, 1);

  await liberar("I-1");
  const esperaDoI3 = conjunto.alocar(ocupante("I-3"), doNode);
  assert.equal((await esperaDoI2).alocado_para, "I-2");
  await esperarNaFila(conjunto, 1);
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-3"]);

  await liberar("I-2");
  assert.equal((await esperaDoI3).alocado_para, "I-3");
});

test("o ocupante que já tem o sandbox o recebe de novo na hora, mesmo com a fila cheia", async () => {
  const { conjunto } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 1 });
  const alocado = await conjunto.alocar(ocupante("I-1"), doNode);
  void conjunto.alocar(ocupante("I-2"), doNode).catch(() => undefined);
  await esperarNaFila(conjunto, 1);

  assert.equal((await conjunto.alocar(ocupante("I-1"), doNode)).container_id, alocado.container_id);
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), ["I-2"]);
  conjunto.rejeitarEsperas(new Error("fim do teste"));
});

test("sem capacidade, ninguém entra na fila e o conjunto cresce", async () => {
  const { conjunto, criacoes } = cenario({ conjunto: "variavel", capacidade_do_conjunto: null });
  await Promise.all(["I-1", "I-2", "I-3"].map((dono) => conjunto.alocar(ocupante(dono), doNode)));
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), []);
  assert.equal(criacoes(), 3);
});

test("rejeitarEsperas encerra a espera de quem está na fila com o erro dado, e a fila esvazia", async () => {
  const { conjunto } = cenario({ conjunto: "variavel", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const esperas = ["I-2", "I-3"].map((dono) => conjunto.alocar(ocupante(dono), doNode));
  const rejeitadas = Promise.allSettled(esperas);
  await esperarNaFila(conjunto, 2);

  conjunto.rejeitarEsperas(new ErroExterno("parando", "suba de novo"));
  const resultados = await rejeitadas;
  assert.ok(resultados.every((r) => r.status === "rejected" && r.reason instanceof ErroExterno));
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), []);
  await assert.rejects(conjunto.alocar(ocupante("I-5"), doNode), ErroExterno);
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), [], "depois da parada ninguém mais entra na fila");
});

test("o livre de outra imagem, liberado com alguém na fila, cede a vaga ao primeiro, que cria o container", async () => {
  const { conjunto, liberar, estados, imagemDe } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  const espera = conjunto.alocar(ocupante("I-2"), doPython);
  await esperarNaFila(conjunto, 1);

  await liberar("I-1");
  const recebido = await espera;
  assert.equal(recebido.alocado_para, "I-2");
  assert.notEqual(recebido.container_id, primeiro.container_id);
  assert.deepEqual(estados(), [["alocado", "I-2", await imagemDe(doPython)]]);
});

test("a criação que falha devolve a vaga ao conjunto", async () => {
  const { docker, conjunto, pastaDoDocker } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  docker.falharComando("run", "docker travado");
  await assert.rejects(conjunto.alocar(ocupante("I-1"), doNode), /docker travado/);
  rmSync(join(pastaDoDocker, "falhas", "run"));
  await conjunto.alocar(ocupante("I-1"), doNode);
  assert.equal(docker.containers().length, 1);
});

test("a criação que falha com alguém na fila acorda o primeiro, que cria o container", async () => {
  const { docker, conjunto, pastaDoDocker, liberar } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const esperaDoI2 = conjunto.alocar(ocupante("I-2"), doPython);
  await esperarNaFila(conjunto, 1);

  docker.falharComando("run", "docker travado");
  const esperaDoI3 = conjunto.alocar(ocupante("I-3"), doNode);
  await esperarNaFila(conjunto, 2);
  await liberar("I-1");
  await assert.rejects(esperaDoI2, /docker travado/);
  rmSync(join(pastaDoDocker, "falhas", "run"));
  assert.equal((await esperaDoI3).alocado_para, "I-3");
  assert.equal(docker.containers().length, 1);
});

test("o acordado que lança antes de tomar a vaga passa a vez: o próximo da fila recebe o sandbox livre", async () => {
  const { conjunto, liberar } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  let dependenciasInvalidas = false; // o arquivo de dependências some depois de o I-2 entrar na fila
  const projetoDoI2 = {
    ...doPython,
    get arquivos_de_dependencias() {
      return dependenciasInvalidas ? ["inexistente.txt"] : ["requirements.txt"];
    },
  };
  const esperaDoI2 = conjunto.alocar(ocupante("I-2"), projetoDoI2);
  await esperarNaFila(conjunto, 1);
  const esperaDoI3 = conjunto.alocar(ocupante("I-3"), doNode);
  await esperarNaFila(conjunto, 2);

  dependenciasInvalidas = true;
  await liberar("I-1");
  await assert.rejects(esperaDoI2);
  assert.equal((await esperaDoI3).alocado_para, "I-3");
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), []);
});

test("duas esperas do mesmo dono: a primeira recebe o sandbox e a segunda resolve na hora com o mesmo container", async () => {
  const { conjunto, liberar } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  const primeira = conjunto.alocar(ocupante("I-2"), doNode);
  await esperarNaFila(conjunto, 1);
  const segunda = conjunto.alocar(ocupante("I-2"), doNode);
  await esperarNaFila(conjunto, 2);

  await liberar("I-1");
  const [recebidaPrimeira, recebidaSegunda] = await Promise.all([primeira, segunda]);
  assert.equal(recebidaSegunda.id, recebidaPrimeira.id);
  assert.deepEqual(conjunto.ocupantesNaFilaDeEspera(), []);
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
  const { docker, banco, nomeDaInstancia, conjunto, liberar } = cenario({ conjunto: "variavel" });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  assert.equal(primeiro.slot, 1);
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`]);

  const segundo = await conjunto.alocar(ocupante("I-2"), doNode);
  const terceiro = await conjunto.alocar(ocupante("I-3"), doNode);
  assert.deepEqual([segundo.slot, terceiro.slot], [2, 3]);

  await liberar("I-2");
  await conjunto.eliminar(segundo.id);
  const novo = await conjunto.alocar(ocupante("I-4"), doNode);
  assert.equal(novo.slot, 2);
  assert.deepEqual(
    nomesNoDocker(docker),
    [1, 2, 3].map((slot) => `${nomeDaInstancia}-slot-${String(slot)}`),
  );
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
  const { docker, nomeDaInstancia, conjunto } = cenario({ conjunto: "variavel" });
  const alocados = await Promise.all([
    conjunto.alocar(ocupante("I-1"), doNode),
    conjunto.alocar(ocupante("I-2"), doNode),
  ]);
  assert.deepEqual(alocados.map(({ slot }) => slot).sort(), [1, 2]);
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`, `${nomeDaInstancia}-slot-2`]);
});

test("na subida, o órfão da própria instância de uma subida anterior é eliminado e a criação não falha por nome repetido", async () => {
  const { docker, nomeDaInstancia, conjunto } = cenario({ conjunto: "variavel" });
  const orfao = docker.semearContainer({
    nome: `${nomeDaInstancia}-slot-1`,
    rotulos: { "fabriquinha.ambiente": "sobra", "fabriquinha.instancia": nomeDaInstancia },
  });

  await conjunto.reconciliarNaSubida();
  assert.deepEqual(docker.containers(), []);
  const criado = await conjunto.alocar(ocupante("I-1"), doNode);

  assert.equal(criado.slot, 1);
  assert.notEqual(criado.container_id, orfao.id);
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`]);
});

test("na subida, o container de outra instância e o antigo, sem o rótulo da instância, ficam rodando com o mesmo id", async () => {
  const { docker, conjunto } = cenario({ conjunto: "variavel" });
  const deOutraInstancia = docker.semearContainer({
    nome: "fab-bbbb-slot-1",
    rotulos: { "fabriquinha.ambiente": "x", "fabriquinha.instancia": "fab-bbbb" },
  });
  const antigo = docker.semearContainer({
    nome: "fabriquinha-slot-1",
    rotulos: { "fabriquinha.ambiente": "antigo" },
  });

  await conjunto.reconciliarNaSubida();

  assert.deepEqual(
    docker
      .containers()
      .map(({ id, estado }) => [id, estado])
      .sort(),
    [deOutraInstancia, antigo].map(({ id }) => [id, "running"]).sort(),
  );
});

test("na subida, a linha livre que aponta para o container antigo, sem o rótulo da instância, vira eliminado e some do conjunto", async () => {
  const { docker, banco, conjunto } = cenario({ conjunto: "variavel" });
  const antigo = docker.semearContainer({ nome: "fabriquinha-slot-1", rotulos: { "fabriquinha.ambiente": "antigo" } });
  inserirAmbienteAlocado(banco, {
    id: "antigo",
    container_id: antigo.id,
    imagem: "alpine",
    criado_em: "2026-11-13T09:00:00.000Z",
    alocado_para: "I-9",
    slot: 1,
  });
  liberarAmbiente(banco, "antigo", "livre", "2026-11-13T09:30:00.000Z");

  await conjunto.reconciliarNaSubida();

  assert.deepEqual(listarAmbientes(banco), []);
  assert.deepEqual(await conjunto.listar(), []);
  assert.deepEqual(
    docker.containers().map(({ id }) => id),
    [antigo.id],
  );
});

test("na subida, o container do banco sem slot (anterior ao slot) é eliminado com a linha, e o que tem slot fica", async () => {
  const { docker, banco, nomeDaInstancia, conjunto, estados, liberar, imagemDe } = cenario({ conjunto: "variavel" });
  await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  const antigo = docker.semearContainer({
    rotulos: { "fabriquinha.ambiente": "antigo", "fabriquinha.instancia": nomeDaInstancia },
  });
  inserirAmbienteAlocado(banco, {
    id: "antigo",
    container_id: antigo.id,
    imagem: "alpine",
    criado_em: "2026-11-13T09:00:00.000Z",
    alocado_para: "I-9",
  });

  await conjunto.reconciliarNaSubida();

  assert.deepEqual(estados(), [["livre", null, await imagemDe(doNode)]]);
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`]);
});

test("o nome <instância>-slot-1 tomado no docker por um container sem o rótulo da instância conta como ocupado, e esse container fica", async () => {
  const { docker, nomeDaInstancia, conjunto } = cenario({ conjunto: "variavel" });
  const semRotulo = docker.semearContainer({ nome: `${nomeDaInstancia}-slot-1` });

  const criado = await conjunto.alocar(ocupante("I-1"), doNode);

  assert.equal(criado.slot, 2);
  assert.ok(docker.containers().some(({ id }) => id === semRotulo.id));
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`, `${nomeDaInstancia}-slot-2`]);
});

test("os containers antigo e de outra instância, de mesmo número de slot, não pesam no nome: o criado é <instância>-slot-1 e os outros ficam", async () => {
  const { docker, nomeDaInstancia, conjunto } = cenario({ conjunto: "variavel" });
  docker.semearContainer({ nome: "fabriquinha-slot-1" });
  docker.semearContainer({
    nome: "fab-bbbb-slot-1",
    rotulos: { "fabriquinha.ambiente": "x", "fabriquinha.instancia": "fab-bbbb" },
  });

  const criado = await conjunto.alocar(ocupante("I-1"), doNode);

  assert.equal(criado.slot, 1);
  assert.deepEqual(
    nomesNoDocker(docker),
    ["fab-bbbb-slot-1", `${nomeDaInstancia}-slot-1`, "fabriquinha-slot-1"].sort(),
  );
});

test("o container eliminado no banco que o rm não tirou do docker não tem o slot repetido pelo alocar seguinte", async () => {
  const { docker, nomeDaInstancia, conjunto, liberar, pastaDoDocker } = cenario({ conjunto: "variavel" });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  docker.falharComando("rm", "daemon ocupado");
  await assert.rejects(conjunto.eliminar(primeiro.id), /daemon ocupado/);
  rmSync(join(pastaDoDocker, "falhas", "rm"));

  const seguinte = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.equal(seguinte.slot, 2);
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`, `${nomeDaInstancia}-slot-2`]);
});

test("na capacidade, o novo container reusa o slot do parado que cedeu a vaga, já fora do docker", async () => {
  const { docker, nomeDaInstancia, conjunto, liberar } = cenario({ conjunto: "fixo", capacidade_do_conjunto: 1 });
  await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");

  const novo = await conjunto.alocar(ocupante("I-2"), doPython);

  assert.equal(novo.slot, 1);
  assert.deepEqual(nomesNoDocker(docker), [`${nomeDaInstancia}-slot-1`]);
});

test("na subida, o container alocado sem slot recolhe as sessões e execuções ao Espaço antes de ser eliminado", async () => {
  const { docker, banco, nomeDaInstancia, conjunto } = cenario({ conjunto: "variavel" });
  const daInstancia = { "fabriquinha.instancia": nomeDaInstancia };
  const semSlot = docker.semearContainer({ rotulos: { "fabriquinha.ambiente": "sem-slot-alocado", ...daInstancia } });
  inserirAmbienteAlocado(banco, {
    id: "sem-slot-alocado",
    container_id: semSlot.id,
    imagem: "alpine",
    criado_em: "2026-11-13T09:00:00.000Z",
    alocado_para: "I-77",
  });
  const livreSemSlot = docker.semearContainer({
    rotulos: { "fabriquinha.ambiente": "sem-slot-livre", ...daInstancia },
  });
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

const estadoDaLinha = (banco: DatabaseSync, containerId: string) =>
  (banco.prepare("SELECT estado FROM ambiente WHERE container_id = ?").get(containerId) as { estado: string }).estado;

test("o livre com a pasta do pi sem mudança desde a criação é entregue de novo, sem container novo", async () => {
  const { conjunto, criacoes, liberar } = cenario({ conjunto: "variavel" });
  const primeiro = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");

  const segundo = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.equal(segundo.container_id, primeiro.container_id);
  assert.equal(criacoes(), 1);
});

test("o livre criado antes de o pi ser reinstalado, mesmo com a versão igual, é eliminado e o ocupante recebe um container com a identidade atual", async () => {
  const { conjunto, docker, banco, pi, liberar } = cenario({ conjunto: "variavel" });
  const antigo = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  pi.reinstalar("cli.js");

  const novo = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.notEqual(novo.container_id, antigo.container_id);
  assert.equal(estadoDaLinha(banco, antigo.container_id), "eliminado");
  assert.deepEqual(
    docker.containers().map(({ id }) => id),
    [novo.container_id],
  );
  assert.equal(novo.instalacao_do_harness, identidadeDaInstalacaoDoHarness(pi.instalacao()));
  assert.equal(listarAmbientes(banco)[0]?.instalacao_do_harness, novo.instalacao_do_harness);
});

test("o livre criado antes de o pi mudar de versão é eliminado e o /usr/local/bin/pi do novo aponta para o executável atual", async () => {
  const { conjunto, docker, banco, pi, liberar } = cenario({ conjunto: "variavel" });
  const antigo = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  pi.reinstalar("cli-v2.js");

  const novo = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.equal(estadoDaLinha(banco, antigo.container_id), "eliminado");
  const ligacoes = docker
    .registro()
    .filter((argumentos) => argumentos.some((argumento) => argumento.includes("ln -sf")))
    .map((argumentos) => argumentos.join(" "));
  assert.equal(ligacoes.length, 2);
  assert.match(String(ligacoes[1]), new RegExp(`'${pi.instalacao().executavel}' /usr/local/bin/pi`));
  assert.ok(docker.containers().some(({ id }) => id === novo.container_id));
});

test("o livre gravado antes da coluna da instalação, com ela nula, conta como diferente e é eliminado", async () => {
  const { conjunto, banco, liberar } = cenario({ conjunto: "variavel" });
  const antigo = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  banco.exec("UPDATE ambiente SET instalacao_do_harness = NULL");

  const novo = await conjunto.alocar(ocupante("I-2"), doNode);

  assert.notEqual(novo.container_id, antigo.container_id);
  assert.equal(estadoDaLinha(banco, antigo.container_id), "eliminado");
  assert.ok(novo.instalacao_do_harness);
});

test("sem o pi no host, o pedido falha com o erro de hoje e o livre, o docker e a criação ficam como estavam", async () => {
  const { conjunto, docker, banco, pi, criacoes, liberar } = cenario({ conjunto: "variavel" });
  const livre = await conjunto.alocar(ocupante("I-1"), doNode);
  await liberar("I-1");
  pi.remover();

  await assert.rejects(
    conjunto.alocar(ocupante("I-2"), doNode),
    (erro: unknown) => erro instanceof ErroDeRegra && erro.message.startsWith("não achei o"),
  );

  assert.equal(estadoDaLinha(banco, livre.container_id), "livre");
  assert.equal(criacoes(), 1);
  assert.equal(docker.registro().filter(([comando]) => comando === "rm").length, 0);
});

test("o ticket que pede de novo o sandbox que já tem recebe o mesmo, mesmo com o pi reinstalado depois da alocação", async () => {
  const { conjunto, docker, banco, pi } = cenario({ conjunto: "variavel" });
  const alocado = await conjunto.alocar(ocupante("I-1"), doNode);
  pi.reinstalar("cli.js");

  const denovo = await conjunto.alocar(ocupante("I-1"), doNode);

  assert.equal(denovo.container_id, alocado.container_id);
  assert.equal(estadoDaLinha(banco, alocado.container_id), "alocado");
  assert.equal(docker.registro().filter(([comando]) => comando === "rm").length, 0);
});

test("a liberação com o pi reinstalado recolhe ao Espaço e elimina o container em vez de limpá-lo; o próximo ticket recebe um novo", async () => {
  const { conjunto, docker, banco, pi, liberar } = cenario({ conjunto: "variavel" });
  const alocado = await conjunto.alocar(ocupante("I-318-5"), doNode);
  const sessao = join(base, "ambientes", alocado.id, "sessoes", "s-5");
  mkdirSync(sessao, { recursive: true });
  writeFileSync(join(sessao, "conversa.jsonl"), "{}");
  pi.reinstalar("cli.js");

  await liberar("I-318-5");

  assert.equal(readFileSync(join(base, "espacos", "I-318-5", "sessoes", "s-5", "conversa.jsonl"), "utf8"), "{}");
  assert.equal(estadoDaLinha(banco, alocado.container_id), "eliminado");
  assert.deepEqual(docker.containers(), []);
  const proximo = await conjunto.alocar(ocupante("I-318-6"), doNode);
  assert.notEqual(proximo.container_id, alocado.container_id);
});

test("o docker rm que falha na liberação não falha o ticket: a linha fica eliminada e a subida seguinte tira o órfão", async () => {
  const { conjunto, docker, banco, pi, pastaDoDocker, liberar } = cenario({ conjunto: "variavel" });
  const alocado = await conjunto.alocar(ocupante("I-318-7"), doNode);
  pi.reinstalar("cli.js");
  docker.falharComando("rm", "docker travado");

  await liberar("I-318-7");

  assert.equal(estadoDaLinha(banco, alocado.container_id), "eliminado");
  assert.equal(docker.containers().length, 1);
  rmSync(join(pastaDoDocker, "falhas", "rm"));
  await conjunto.reconciliarNaSubida();
  assert.deepEqual(docker.containers(), []);
});

test("a liberação que não consegue ler a instalação do host mantém a de hoje: o container volta livre", async () => {
  const { conjunto, banco, pi, liberar } = cenario({ conjunto: "variavel" });
  const alocado = await conjunto.alocar(ocupante("I-318-8"), doNode);
  pi.remover();

  await liberar("I-318-8");

  assert.equal(estadoDaLinha(banco, alocado.container_id), "livre");
});
