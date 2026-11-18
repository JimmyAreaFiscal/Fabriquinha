// I-314, CA-1 a CA-4, no Docker de verdade: só o host renova a credencial do Claude, do pi e do Codex, e cada container
// recebe uma cópia enxuta (o token de acesso, sem o de renovação) antes de cada comando. O container nunca grava nada que o
// host leia: o que ele escreve na cópia dele fica nele, e nenhuma pasta de credencial é montada.
// Pulado sem `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco/banco_temporario.ts";
import { rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import { AmbienteContainer } from "../../apoio-testes/falsos/ambiente_falso.ts";
import { montarGestaoDeAmbientes } from "../../src/modulos/ambiente/publico.ts";
import { instalacaoDoPi, PACOTE } from "../../src/shared/infra/isolamento_do_ambiente.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { ConfiguracaoDoAmbiente } from "../../src/shared/nucleo/configuracao_do_ambiente.ts";
import { raizCompartilhadaComODocker } from "../falsos.ts";

const COM_DOCKER = {
  skip: process.env.FABRIQUINHA_TESTE_DOCKER
    ? false
    : "defina FABRIQUINHA_TESTE_DOCKER=1 para rodar com o Docker de verdade",
};

const BRANCH_BASE = "main";
const DAQUI_A_UM_DIA = Date.now() + 24 * 60 * 60_000;
const jwtQueVenceEm = (venceEmMs: number) =>
  `cabecalho.${Buffer.from(JSON.stringify({ exp: Math.floor(venceEmMs / 1000) })).toString("base64url")}.assinatura`;

/** A credencial de cada agente: onde fica no host (relativo à raiz), como o agente a lê no container e o arquivo com `acesso`. */
const CREDENCIAIS = [
  {
    agente: "Claude",
    noHost: ".claude/.credentials.json",
    noContainer: '"$HOME/.claude/.credentials.json"',
    arquivo: (acesso: string) =>
      JSON.stringify({
        claudeAiOauth: { accessToken: acesso, refreshToken: "renovacao-do-host", expiresAt: DAQUI_A_UM_DIA },
      }),
  },
  {
    agente: "pi",
    noHost: "pi-do-auditor/auth.json",
    noContainer: '"$PI_CODING_AGENT_DIR/auth.json"',
    arquivo: (acesso: string) =>
      JSON.stringify({
        "openai-codex": { type: "oauth", access: acesso, refresh: "renovacao-do-host", expires: DAQUI_A_UM_DIA },
      }),
  },
  {
    agente: "Codex",
    noHost: ".codex/auth.json",
    noContainer: '"$HOME/.codex/auth.json"',
    arquivo: (acesso: string) =>
      JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: { access_token: `${jwtQueVenceEm(DAQUI_A_UM_DIA)}.${acesso}`, refresh_token: "renovacao-do-host" },
        last_refresh: new Date().toISOString(),
      }),
  },
] as const;

/** Um repositório com um `package.json` sem dependências e o lockfile que o `npm ci` exige: a imagem sai só com Node e Git. */
function repositorioSemDependencias(raizGit: string): void {
  mkdirSync(raizGit);
  writeFileSync(join(raizGit, "package.json"), '{"name":"minimo","version":"1.0.0"}');
  writeFileSync(
    join(raizGit, "package-lock.json"),
    '{"name":"minimo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"minimo","version":"1.0.0"}}}',
  );
  rodarGit(raizGit, "init", "-q", "-b", BRANCH_BASE);
  rodarGit(raizGit, "add", "-A");
  rodarGit(raizGit, "commit", "-q", "-m", "dependências");
  rodarGit(raizGit, "update-ref", `refs/remotes/origin/${BRANCH_BASE}`, "HEAD");
}

/** A gestão de Ambientes no Docker de verdade, com as três credenciais do host gravadas com o acesso `antigo`. */
async function prepararGestaoComCredenciais(t: TestContext) {
  const { banco, fechar } = abrirBancoTemporario();
  const raiz = raizCompartilhadaComODocker();
  for (const { noHost, arquivo } of CREDENCIAIS) {
    mkdirSync(dirname(join(raiz, noHost)), { recursive: true });
    writeFileSync(join(raiz, noHost), arquivo("antigo"));
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
  const projeto = {
    nome: "projeto",
    raiz_git: join(raiz, "repo"),
    branch_base: BRANCH_BASE,
    arquivos_de_dependencias: ["package.json"],
  };
  repositorioSemDependencias(projeto.raiz_git);
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

/** Roda `linha` (shell) no container, como o agente a roda: o env, o `$HOME` e o `cwd` são os que `executar` dá ao agente. */
async function noContainer(ambiente: AmbienteContainer, linha: string): Promise<string> {
  const { codigo, saida } = await ambiente.executar({
    programa: linha,
    argumentos: [],
    cwd: "/",
    env: {},
    noShell: true,
    limiteMs: 60_000,
  });
  assert.equal(codigo, 0, saida);
  return saida;
}

for (const { agente, noHost, noContainer: caminhoNoContainer, arquivo } of CREDENCIAIS) {
  test(
    `CA-1/CA-4: o host renova a credencial do ${agente} e o container, já rodando, recebe o acesso novo, sem o token de renovação`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const ambiente = await alocar("espaco-1");
      assert.match(await noContainer(ambiente, `cat ${caminhoNoContainer}`), /antigo/);
      writeFileSync(join(raiz, noHost), arquivo("renovado-no-host"));
      const copia = await noContainer(ambiente, `cat ${caminhoNoContainer}`);
      assert.match(copia, /renovado-no-host/);
      assert.doesNotMatch(copia, /renovacao-do-host/);
    },
  );

  test(
    `CA-2/CA-4: um container grava a própria credencial do ${agente} (e a troca por symlink): o outro container e o host não mudam`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const gravador = await alocar("espaco-1");
      const outro = await alocar("espaco-2");
      const doHostAntes = readFileSync(join(raiz, noHost), "utf8");
      await noContainer(
        gravador,
        `printf '{"anthropic":{"type":"api_key","key":"!touch /tmp/fuga"}}' > ${caminhoNoContainer} && ln -sfn /etc/passwd ${caminhoNoContainer}.symlink`,
      );
      assert.equal(readFileSync(join(raiz, noHost), "utf8"), doHostAntes);
      assert.match(await noContainer(outro, `cat ${caminhoNoContainer}`), /antigo/);
    },
  );

  test(
    `CA-3/CA-4: novo login do ${agente} no host depois de o container ser criado, e o ticket que começa nele depois usa a credencial nova`,
    COM_DOCKER,
    async (t) => {
      const { raiz, gestao, alocar } = await prepararGestaoComCredenciais(t);
      const criadoAntes = await alocar("espaco-1");
      await gestao.limpar(criadoAntes.id);
      writeFileSync(join(raiz, noHost), arquivo("novo-login-no-host"));
      const reusado = await alocar("espaco-2");
      assert.equal(reusado.container_id, criadoAntes.container_id, "o container é o mesmo, sem recriar");
      assert.match(await noContainer(reusado, `cat ${caminhoNoContainer}`), /novo-login-no-host/);
    },
  );
}

test(
  "nenhuma credencial é montada: o container não monta ~/.claude, ~/.codex, a pasta do pi nem pasta de credencial",
  COM_DOCKER,
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    const ambiente = await alocar("espaco-1");
    const [inspecao] = JSON.parse(execFileSync("docker", ["inspect", ambiente.container_id], { encoding: "utf8" })) as {
      HostConfig: { Binds: string[] | null };
    }[];
    const origens = (inspecao?.HostConfig.Binds ?? []).map((bind) => bind.split(":")[0] ?? "");
    for (const pastaDoHost of [".claude", ".codex", "pi-do-auditor"])
      assert.ok(
        !origens.some((origem) => origem.startsWith(join(raiz, pastaDoHost))),
        `o container não monta ${pastaDoHost}`,
      );
    assert.ok(!origens.some((origem) => origem.includes("credenciais")));
  },
);
