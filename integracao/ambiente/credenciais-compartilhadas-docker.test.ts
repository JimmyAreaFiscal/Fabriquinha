// I-314.R2, CA-1 a CA-4: a credencial do Claude, do pi e do Codex é a mesma do host em todo container do Ambiente, no
// Docker de verdade: a renovação de qualquer um vale para todos, e o container já criado a vê. Pulado sem
// `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setImmediate as proximoCicloDoNode } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { montarGestaoDeAmbientes } from "../../src/modulos/ambiente/publico.ts";
import { instalacaoDoPi, PACOTE } from "../../src/shared/infra/isolamento_do_ambiente.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { raizCompartilhadaComODocker } from "../falsos.ts";

const IMAGEM_MINIMA = "busybox:1";

const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

/**
 * As três credenciais: onde ficam no host (relativo à raiz do teste) e no container (relativo ao `$HOME` dele). Claude e
 * Codex renovam por temporário + rename, e o container monta a pasta delas (`pastaMontada`); o pi grava no lugar, e o
 * container monta o arquivo.
 */
const CREDENCIAIS = [
  {
    agente: "Claude",
    noHost: ".claude/.credentials.json",
    noContainer: ".claude/.credentials.json",
    pastaMontada: "/credenciais/claude",
  },
  { agente: "pi", noHost: "pi-do-auditor/auth.json", noContainer: ".pi/agent/auth.json", pastaMontada: undefined },
  { agente: "Codex", noHost: ".codex/auth.json", noContainer: ".codex/auth.json", pastaMontada: "/credenciais/codex" },
] as const;
type Credencial = (typeof CREDENCIAIS)[number];

/** A gestão de Ambientes no Docker de verdade, com as três credenciais do host gravadas em `antigo`. */
async function prepararGestaoComCredenciais(t: TestContext) {
  const { banco, fechar } = abrirBancoTemporario();
  const raiz = raizCompartilhadaComODocker();
  for (const { noHost } of CREDENCIAIS) {
    mkdirSync(join(raiz, noHost, ".."), { recursive: true });
    writeFileSync(join(raiz, noHost), '{"token":"antigo"}');
  }
  const configuracao = { atual: ConfiguracaoDoAmbiente.parse({}) };
  const gestao = await montarGestaoDeAmbientes({
    banco,
    // Montada no host_local, a gestão não confere o conjunto com o docker da máquina, que pode ter os do serviço.
    configuracao: () => configuracao.atual,
    servico: {
      raiz,
      porta_da_api: 1,
      home_do_usuario: raiz,
      pacote_do_harness: PACOTE,
      instalacao_do_harness: () => instalacaoDoPi(),
      dir_do_harness_do_auditor: join(raiz, "pi-do-auditor"),
    },
    registrarErro: noLog,
  });
  configuracao.atual = ConfiguracaoDoAmbiente.parse({ tipo: "container", memoria_maxima_mb: 256, cpus: 0.5 });
  const containersCriados: string[] = [];
  t.after(async () => {
    await gestao.parar();
    for (const containerId of containersCriados)
      execFileSync("docker", ["rm", "--force", containerId], { stdio: "ignore" });
    rmSync(raiz, { recursive: true, force: true });
    fechar();
  });
  const projeto = { nome: "projeto", raiz_git: join(raiz, "repo"), imagem_do_ambiente: IMAGEM_MINIMA };
  mkdirSync(projeto.raiz_git);
  const alocar = async (dono: string) => {
    const ambiente = await gestao.alocar(
      { dono, pasta_das_worktrees_do_projeto: join(raiz, "worktrees", "projeto") },
      projeto,
    );
    assert.ok(ambiente instanceof AmbienteContainer);
    containersCriados.push(ambiente.container_id);
    return ambiente;
  };
  return { raiz, gestao, alocar };
}

/** Roda `linha` (shell) no container, como o agente a roda: o `$HOME` é o do usuário do container. */
const noContainer = (ambiente: AmbienteContainer, linha: string) =>
  ambiente.executar({ programa: linha, argumentos: [], cwd: "/", env: {}, noShell: true, limiteMs: 60_000 });

async function lerNoContainer(ambiente: AmbienteContainer, arquivo: string): Promise<string> {
  const { codigo, saida } = await noContainer(ambiente, `cat "$HOME/${arquivo}"`);
  assert.equal(codigo, 0, saida);
  return saida;
}

/** O host renova como o agente: temporário na mesma pasta + rename (Claude e Codex) ou no lugar (pi). */
function renovarNoHost(arquivo: string, conteudo: string, porRename: boolean): void {
  const gravado = porRename ? `${arquivo}.tmp` : arquivo;
  writeFileSync(gravado, conteudo);
  if (porRename) renameSync(gravado, arquivo);
}

/** O container renova como o agente: rename dentro da pasta montada (Claude e Codex) ou escrita no lugar (pi). */
function renovarNoContainer(ambiente: AmbienteContainer, credencial: Credencial, conteudo: string) {
  const { pastaMontada, noContainer: arquivoNoContainer } = credencial;
  if (!pastaMontada) return noContainer(ambiente, `printf '${conteudo}' > "$HOME/${arquivoNoContainer}"`);
  const nome = basename(arquivoNoContainer);
  return noContainer(
    ambiente,
    `printf '${conteudo}' > "${pastaMontada}/${nome}.tmp" && mv "${pastaMontada}/${nome}.tmp" "${pastaMontada}/${nome}"`,
  );
}

for (const credencial of CREDENCIAIS) {
  const { agente, noHost, noContainer: arquivoNoContainer, pastaMontada } = credencial;
  const comoRenova = pastaMontada ? "por temporário + rename" : "no lugar";
  test(
    `CA-1/CA-4: o host renova a credencial do ${agente} ${comoRenova} e o container, já rodando, lê o conteúdo novo`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const ambiente = await alocar("espaco-1");
      assert.equal(await lerNoContainer(ambiente, arquivoNoContainer), '{"token":"antigo"}');

      renovarNoHost(join(raiz, noHost), '{"token":"renovado-no-host"}', pastaMontada !== undefined);
      assert.equal(await lerNoContainer(ambiente, arquivoNoContainer), '{"token":"renovado-no-host"}');
    },
  );

  test(
    `CA-2/CA-4: um container renova a credencial do ${agente} ${comoRenova} e o outro container e o host veem o valor novo`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const renovador = await alocar("espaco-1");
      const outro = await alocar("espaco-2");
      assert.notEqual(renovador.container_id, outro.container_id);

      const escrita = await renovarNoContainer(renovador, credencial, '{"token":"renovado-no-container"}');
      assert.equal(escrita.codigo, 0, escrita.saida);
      assert.equal(readFileSync(join(raiz, noHost), "utf8"), '{"token":"renovado-no-container"}');
      assert.equal(await lerNoContainer(outro, arquivoNoContainer), '{"token":"renovado-no-container"}');
      assert.equal(await lerNoContainer(renovador, arquivoNoContainer), '{"token":"renovado-no-container"}');

      if (pastaMontada) return;
      // O pi tem o arquivo montado: o rename sobre ele dá EBUSY, e a recusa não pode corromper nem trocar o arquivo.
      const porRename = await noContainer(
        renovador,
        `d="$(dirname "$HOME/${arquivoNoContainer}")"; printf '{"token":"por-rename"}' > "$d/temporario" && mv "$d/temporario" "$HOME/${arquivoNoContainer}"`,
      );
      assert.notEqual(porRename.codigo, 0, "o rename sobre o arquivo montado deveria falhar");
      assert.equal(readFileSync(join(raiz, noHost), "utf8"), '{"token":"renovado-no-container"}');
    },
  );

  test(
    `CA-3/CA-4: a credencial do ${agente} mudou no host (${comoRenova}) depois de o container ser criado, e o ticket que começa nele depois usa a nova`,
    COM_DOCKER,
    async (t) => {
      const { raiz, gestao, alocar } = await prepararGestaoComCredenciais(t);
      const criadoAntes = await alocar("espaco-1");
      await gestao.limpar(criadoAntes.id);

      renovarNoHost(join(raiz, noHost), '{"token":"novo-login-no-host"}', pastaMontada !== undefined);

      const reusado = await alocar("espaco-2");
      assert.equal(reusado.container_id, criadoAntes.container_id, "o container é o mesmo, sem recriar");
      assert.equal(await lerNoContainer(reusado, arquivoNoContainer), '{"token":"novo-login-no-host"}');
    },
  );
}

// O estresse: host e container renovando ao mesmo tempo, e a credencial nunca sai corrompida.
const CLAUDE = CREDENCIAIS[0];
const PI = CREDENCIAIS[1];
const CODEX = CREDENCIAIS[2];
const RODADAS = 300;

test(
  "a renovação concorrente por rename do host e de um container (Claude) nunca deixa a credencial corrompida",
  COM_DOCKER,
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    const ambiente = await alocar("espaco-1");
    const arquivoNoHost = join(raiz, CLAUDE.noHost);
    const nome = basename(CLAUDE.noHost);
    const pasta = CLAUDE.pastaMontada;
    const doContainer = noContainer(
      ambiente,
      `i=1; while [ $i -le ${String(RODADAS)} ]; do printf '{"quem":"cont","n":"%04d"}' $i > "${pasta}/${nome}.cont" && mv "${pasta}/${nome}.cont" "${pasta}/${nome}"; i=$((i+1)); done`,
    );
    for (let n = 1; n <= RODADAS; n++) {
      renovarNoHost(arquivoNoHost, `{"quem":"host","n":"${String(n).padStart(4, "0")}"}`, true);
      // O rename é atômico: quem lê no meio da briga vê sempre um documento inteiro.
      assert.match((JSON.parse(readFileSync(arquivoNoHost, "utf8")) as { quem: string }).quem, /^(host|cont)$/);
      await proximoCicloDoNode();
    }
    const { codigo, saida } = await doContainer;
    assert.equal(codigo, 0, saida);

    const noFim = readFileSync(arquivoNoHost, "utf8");
    assert.match((JSON.parse(noFim) as { quem: string }).quem, /^(host|cont)$/);
    assert.equal(await lerNoContainer(ambiente, CLAUDE.noContainer), noFim);
  },
);

test(
  "a escrita concorrente no lugar do host e de um container (pi) não corrompe a credencial",
  COM_DOCKER,
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    const ambiente = await alocar("espaco-1");
    const arquivoNoHost = join(raiz, PI.noHost);
    // Os dois escrevem o documento inteiro, com o mesmo tamanho ("host" e "cont"): a escrita que trunca o arquivo
    // e grava de novo não é atômica, e um documento mais curto escrito por cima de um mais longo deixaria sobra no fim.
    const doContainer = noContainer(
      ambiente,
      `f="$HOME/${PI.noContainer}"; i=1; while [ $i -le ${String(RODADAS)} ]; do printf '{"quem":"cont","n":"%04d"}' $i > "$f"; i=$((i+1)); done`,
    );
    for (let n = 1; n <= RODADAS; n++) {
      writeFileSync(arquivoNoHost, `{"quem":"host","n":"${String(n).padStart(4, "0")}"}`);
      await proximoCicloDoNode();
    }
    const { codigo, saida } = await doContainer;
    assert.equal(codigo, 0, saida);

    const noFim = readFileSync(arquivoNoHost, "utf8");
    assert.match((JSON.parse(noFim) as { quem: string }).quem, /^(host|cont)$/);
    assert.equal(await lerNoContainer(ambiente, PI.noContainer), noFim);
  },
);

// O binário real do Codex num container, com `CODEX_HOME` na pasta montada: antes de montar a pasta, o login falhava
// com "Resource busy (os error 16)" ao trocar o `auth.json` montado por rename. Só roda com um binário do Codex que
// execute dentro da imagem (um build linux estático, musl), apontado por `FABRIQUINHA_TESTE_CODEX_BIN`.
test(
  "CA-4: o `codex login --with-api-key` do container grava o auth.json por rename na pasta montada e o host o vê",
  {
    skip: !process.env.FABRIQUINHA_TESTE_DOCKER
      ? COM_DOCKER.skip
      : process.env.FABRIQUINHA_TESTE_CODEX_BIN
        ? false
        : "defina FABRIQUINHA_TESTE_CODEX_BIN com um binário linux estático do Codex",
  },
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    const ambiente = await alocar("espaco-1");
    execFileSync("docker", [
      "cp",
      process.env.FABRIQUINHA_TESTE_CODEX_BIN ?? "",
      `${ambiente.container_id}:/bin/codex`,
    ]);

    const login = await noContainer(
      ambiente,
      `printf 'sk-teste-do-container' | CODEX_HOME=${CODEX.pastaMontada} codex login --with-api-key`,
    );
    assert.equal(login.codigo, 0, login.saida);
    assert.match(readFileSync(join(raiz, CODEX.noHost), "utf8"), /sk-teste-do-container/);
    assert.match(await lerNoContainer(ambiente, CODEX.noContainer), /sk-teste-do-container/);
  },
);
