// I-314.R1, CA-1 a CA-4: a credencial do Claude, do pi e do Codex é a mesma do host em todo container do Ambiente, no
// Docker de verdade: a renovação de qualquer um vale para todos, e o container já criado a vê. Pulado sem
// `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/** As três credenciais: onde ficam no host (relativo à raiz do teste) e no container (relativo ao `$HOME` dele). */
const CREDENCIAIS = [
  { agente: "Claude", noHost: ".claude/.credentials.json", noContainer: ".claude/.credentials.json" },
  { agente: "pi", noHost: "pi-do-auditor/auth.json", noContainer: ".pi/agent/auth.json" },
  { agente: "Codex", noHost: ".codex/auth.json", noContainer: ".codex/auth.json" },
] as const;

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

for (const { agente, noHost, noContainer: arquivoNoContainer } of CREDENCIAIS) {
  test(
    `CA-1/CA-4: o host renova a credencial do ${agente} e o container, já rodando, lê o conteúdo novo`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const ambiente = await alocar("espaco-1");
      assert.equal(await lerNoContainer(ambiente, arquivoNoContainer), '{"token":"antigo"}');

      writeFileSync(join(raiz, noHost), '{"token":"renovado-no-host"}');
      assert.equal(await lerNoContainer(ambiente, arquivoNoContainer), '{"token":"renovado-no-host"}');
    },
  );

  test(
    `CA-2/CA-4: um container renova a credencial do ${agente} e o outro container e o host veem o valor novo`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const renovador = await alocar("espaco-1");
      const outro = await alocar("espaco-2");
      assert.notEqual(renovador.container_id, outro.container_id);

      const escrita = await noContainer(
        renovador,
        `printf '{"token":"renovado-no-container"}' > "$HOME/${arquivoNoContainer}"`,
      );
      assert.equal(escrita.codigo, 0, escrita.saida);
      assert.equal(readFileSync(join(raiz, noHost), "utf8"), '{"token":"renovado-no-container"}');
      assert.equal(await lerNoContainer(outro, arquivoNoContainer), '{"token":"renovado-no-container"}');

      // Gravar um temporário e trocar por `rename` não funciona sobre o arquivo montado (EBUSY); a recusa não pode
      // corromper nem trocar o arquivo, e a escrita direta que o agente faz em seguida continua valendo para todos.
      const porRename = await noContainer(
        renovador,
        `d="$(dirname "$HOME/${arquivoNoContainer}")"; printf '{"token":"por-rename"}' > "$d/temporario" && mv "$d/temporario" "$HOME/${arquivoNoContainer}"`,
      );
      assert.notEqual(porRename.codigo, 0, "o rename sobre o arquivo montado deveria falhar");
      assert.equal(readFileSync(join(raiz, noHost), "utf8"), '{"token":"renovado-no-container"}');
      assert.equal(await lerNoContainer(outro, arquivoNoContainer), '{"token":"renovado-no-container"}');
    },
  );

  test(
    `CA-3/CA-4: a credencial do ${agente} mudou no host depois de o container ser criado, e o ticket que começa nele depois usa a nova`,
    COM_DOCKER,
    async (t) => {
      const { raiz, gestao, alocar } = await prepararGestaoComCredenciais(t);
      const criadoAntes = await alocar("espaco-1");
      await gestao.limpar(criadoAntes.id);

      writeFileSync(join(raiz, noHost), '{"token":"novo-login-no-host"}');

      const reusado = await alocar("espaco-2");
      assert.equal(reusado.container_id, criadoAntes.container_id, "o container é o mesmo, sem recriar");
      assert.equal(await lerNoContainer(reusado, arquivoNoContainer), '{"token":"novo-login-no-host"}');
    },
  );
}

test("a escrita concorrente do host e de um container na credencial não a corrompe", COM_DOCKER, async (t) => {
  const { raiz, alocar } = await prepararGestaoComCredenciais(t);
  const ambiente = await alocar("espaco-1");
  const arquivoNoHost = join(raiz, CREDENCIAIS[0].noHost);
  const rodadas = 300;
  // Os dois escrevem o documento inteiro, com o mesmo tamanho ("host" e "cont"): a escrita que trunca o arquivo
  // e grava de novo não é atômica, e um documento mais curto escrito por cima de um mais longo deixaria sobra no fim.
  const doContainer = noContainer(
    ambiente,
    `f="$HOME/${CREDENCIAIS[0].noContainer}"; i=1; while [ $i -le ${String(rodadas)} ]; do printf '{"quem":"cont","n":"%04d"}' $i > "$f"; i=$((i+1)); done`,
  );
  for (let n = 1; n <= rodadas; n++) {
    writeFileSync(arquivoNoHost, `{"quem":"host","n":"${String(n).padStart(4, "0")}"}`);
    await proximoCicloDoNode();
  }
  const { codigo, saida } = await doContainer;
  assert.equal(codigo, 0, saida);

  const noFim = readFileSync(arquivoNoHost, "utf8");
  assert.match((JSON.parse(noFim) as { quem: string }).quem, /^(host|cont)$/);
  assert.equal(await lerNoContainer(ambiente, CREDENCIAIS[0].noContainer), noFim);
});
