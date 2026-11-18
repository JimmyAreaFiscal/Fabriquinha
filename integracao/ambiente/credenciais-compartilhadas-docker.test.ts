// I-314.R3, CA-1 a CA-4: a credencial do Claude, do pi e do Codex é a mesma do host em todo container do Ambiente, no
// Docker de verdade: a renovação de qualquer um vale para todos, e o container já criado a vê. O container renova do jeito
// e no caminho que o agente usa (o env que `AmbienteContainer.executar` dá ao agente, e não um caminho que o teste escolhe).
// Pulado sem `FABRIQUINHA_TESTE_DOCKER`, porque exige o Docker rodando e baixa a imagem na primeira vez.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate as proximoCicloDoNode } from "node:timers/promises";
import { pathToFileURL } from "node:url";
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
 * As três credenciais: onde ficam no host (relativo à raiz do teste) e o caminho em que o agente as usa dentro do container
 * (uma expressão de shell, resolvida com o env que `executar` dá ao agente). Claude e Codex renovam por temporário + rename
 * na pasta da credencial, que o container monta; o pi grava no lugar, e o container monta o arquivo.
 */
const CREDENCIAIS = [
  {
    agente: "Claude",
    noHost: "credenciais-claude/.credentials.json",
    noAgenteDoContainer: '"$CLAUDE_SECURESTORAGE_CONFIG_DIR/.credentials.json"',
    renovaPorRename: true,
  },
  {
    agente: "pi",
    noHost: "pi-do-auditor/auth.json",
    noAgenteDoContainer: '"$PI_CODING_AGENT_DIR/auth.json"',
    renovaPorRename: false,
  },
  {
    agente: "Codex",
    noHost: "credenciais-codex/auth.json",
    noAgenteDoContainer: '"$HOME/.codex/auth.json"',
    renovaPorRename: true,
  },
] as const;
type Credencial = (typeof CREDENCIAIS)[number];

const CLAUDE = CREDENCIAIS[0];
const PI = CREDENCIAIS[1];
const CODEX = CREDENCIAIS[2];

/**
 * A gestão de Ambientes no Docker de verdade, com as três credenciais do host gravadas em `antigo`, cada uma como o operador
 * a prepara (`CLAUDE_SECURESTORAGE_CONFIG_DIR` na pasta do Claude, o `~/.codex/auth.json` um symlink para a pasta do Codex), e
 * com o resto da configuração de cada agente ao lado, que o container não pode montar.
 */
async function prepararGestaoComCredenciais(t: TestContext) {
  const { banco, fechar } = abrirBancoTemporario();
  const raiz = raizCompartilhadaComODocker();
  for (const { noHost } of CREDENCIAIS) {
    mkdirSync(join(raiz, noHost, ".."), { recursive: true });
    writeFileSync(join(raiz, noHost), '{"token":"antigo"}');
  }
  const configuracaoDoHost: [string, string][] = [
    [".claude/settings.json", "{}"],
    [".claude/projects/p/sessao.jsonl", "{}"],
    [".claude/hooks/h.sh", "#!/bin/sh"],
    [".codex/config.toml", ""],
    ["pi-do-auditor/settings.json", "{}"],
  ];
  for (const [arquivo, conteudo] of configuracaoDoHost) {
    mkdirSync(dirname(join(raiz, arquivo)), { recursive: true });
    writeFileSync(join(raiz, arquivo), conteudo);
  }
  symlinkSync(join(raiz, CODEX.noHost), join(raiz, ".codex", "auth.json"));
  const pastaDaCredencialDoClaude = dirname(join(raiz, CLAUDE.noHost));
  const variavelDaPastaDoClaude = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = pastaDaCredencialDoClaude;
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
    if (variavelDaPastaDoClaude === undefined) Reflect.deleteProperty(process.env, "CLAUDE_SECURESTORAGE_CONFIG_DIR");
    else process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = variavelDaPastaDoClaude;
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

/** Roda `linha` (shell) no container, como o agente a roda: o env, o `$HOME` e o `cwd` são os que `executar` dá ao agente. */
const noContainer = (ambiente: AmbienteContainer, linha: string) =>
  ambiente.executar({ programa: linha, argumentos: [], cwd: "/", env: {}, noShell: true, limiteMs: 60_000 });

async function lerNoContainer(ambiente: AmbienteContainer, { noAgenteDoContainer }: Credencial): Promise<string> {
  const { codigo, saida } = await noContainer(ambiente, `cat ${noAgenteDoContainer}`);
  assert.equal(codigo, 0, saida);
  return saida;
}

/** O host renova como o agente: temporário na mesma pasta + rename (Claude e Codex) ou no lugar (pi). */
function renovarNoHost(arquivo: string, conteudo: string, porRename: boolean): void {
  const gravado = porRename ? `${arquivo}.tmp` : arquivo;
  writeFileSync(gravado, conteudo);
  if (porRename) renameSync(gravado, arquivo);
}

/**
 * O container renova como o agente: temporário ao lado do alvo do caminho do agente (o Codex segue o symlink) + rename
 * (Claude e Codex), ou escrita no lugar (pi). `sufixoDoTemporario` separa o temporário do container do que o host usa.
 */
const comandoQueRenovaNoContainer = (
  { noAgenteDoContainer, renovaPorRename }: Credencial,
  conteudoDoPrintf: string,
  sufixoDoTemporario = "tmp",
) =>
  renovaPorRename
    ? `alvo="$(readlink -f ${noAgenteDoContainer})"; printf '${conteudoDoPrintf}' > "$alvo.${sufixoDoTemporario}" && mv "$alvo.${sufixoDoTemporario}" "$alvo"`
    : `printf '${conteudoDoPrintf}' > ${noAgenteDoContainer}`;

for (const credencial of CREDENCIAIS) {
  const { agente, noHost, renovaPorRename } = credencial;
  const comoRenova = renovaPorRename ? "por temporário + rename" : "no lugar";
  test(
    `CA-1/CA-4: o host renova a credencial do ${agente} ${comoRenova} e o container, já rodando, lê o conteúdo novo`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const ambiente = await alocar("espaco-1");
      assert.equal(await lerNoContainer(ambiente, credencial), '{"token":"antigo"}');

      renovarNoHost(join(raiz, noHost), '{"token":"renovado-no-host"}', renovaPorRename);
      assert.equal(await lerNoContainer(ambiente, credencial), '{"token":"renovado-no-host"}');
    },
  );

  test(
    `CA-2/CA-4: um container renova a credencial do ${agente} ${comoRenova}, no caminho do agente, e o outro container e o host veem o valor novo`,
    COM_DOCKER,
    async (t) => {
      const { raiz, alocar } = await prepararGestaoComCredenciais(t);
      const renovador = await alocar("espaco-1");
      const outro = await alocar("espaco-2");
      assert.notEqual(renovador.container_id, outro.container_id);

      const escrita = await noContainer(
        renovador,
        comandoQueRenovaNoContainer(credencial, '{"token":"renovado-no-container"}'),
      );
      assert.equal(escrita.codigo, 0, escrita.saida);
      assert.equal(readFileSync(join(raiz, noHost), "utf8"), '{"token":"renovado-no-container"}');
      assert.equal(await lerNoContainer(outro, credencial), '{"token":"renovado-no-container"}');
      assert.equal(await lerNoContainer(renovador, credencial), '{"token":"renovado-no-container"}');

      if (renovaPorRename) return;
      // O pi tem o arquivo montado: o rename sobre ele dá EBUSY, e a recusa não pode corromper nem trocar o arquivo.
      const porRename = await noContainer(
        renovador,
        `printf '{"token":"por-rename"}' > "$PI_CODING_AGENT_DIR/temporario" && mv "$PI_CODING_AGENT_DIR/temporario" ${PI.noAgenteDoContainer}`,
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

      renovarNoHost(join(raiz, noHost), '{"token":"novo-login-no-host"}', renovaPorRename);

      const reusado = await alocar("espaco-2");
      assert.equal(reusado.container_id, criadoAntes.container_id, "o container é o mesmo, sem recriar");
      assert.equal(await lerNoContainer(reusado, credencial), '{"token":"novo-login-no-host"}');
    },
  );
}

test(
  "a pasta montada em cada container só tem as credenciais: nada de settings.json, projects/, hooks/ nem config.toml do host",
  COM_DOCKER,
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    for (const dono of ["espaco-1", "espaco-2"]) {
      const ambiente = await alocar(dono);
      const { codigo, saida } = await noContainer(ambiente, "find /credenciais | sort");
      assert.equal(codigo, 0, saida);
      assert.equal(
        saida.trim(),
        [
          "/credenciais",
          "/credenciais/claude",
          "/credenciais/claude/.credentials.json",
          "/credenciais/codex",
          "/credenciais/codex/auth.json",
        ].join("\n"),
      );

      const [inspecao] = JSON.parse(
        execFileSync("docker", ["inspect", ambiente.container_id], { encoding: "utf8" }),
      ) as {
        HostConfig: { Binds: string[] };
      }[];
      const origens = (inspecao?.HostConfig.Binds ?? []).map((bind) => bind.split(":")[0]);
      for (const pastaDoAgente of [".claude", ".codex", "pi-do-auditor"])
        assert.ok(
          !origens.includes(join(raiz, pastaDoAgente)),
          `o container não monta a pasta ${pastaDoAgente} inteira`,
        );
      assert.ok(origens.includes(join(raiz, PI.noHost)), "o pi monta só o arquivo da credencial");
    }
  },
);

// O estresse: host e container renovando ao mesmo tempo, e a credencial nunca sai corrompida. O container roda o laço
// enquanto o host renova sem parar, para as duas escritas se sobreporem de verdade (o docker exec leva um tempo para subir).
const RODADAS_DO_CLAUDE_NO_CONTAINER = 1000;
const RODADAS_DO_PI_NO_CONTAINER = 5000;

/** Renova no host (`renovarNoHost`) sem parar enquanto `comandoDoContainer` roda, e confere a saída 0 do container. */
async function renovarNoHostEnquantoOContainerRoda(
  comandoDoContainer: ReturnType<typeof noContainer>,
  renovarUmaVez: (rodada: number) => void | Promise<void>,
): Promise<void> {
  const andamento = { containerTerminou: false };
  const doContainer = comandoDoContainer.finally(() => {
    andamento.containerTerminou = true;
  });
  for (let rodada = 1; !andamento.containerTerminou; rodada++) {
    await renovarUmaVez(rodada);
    await proximoCicloDoNode();
  }
  const { codigo, saida } = await doContainer;
  assert.equal(codigo, 0, saida);
}

test(
  "a renovação concorrente por rename do host e de um container (Claude), com documentos de tamanhos diferentes, nunca deixa a credencial corrompida",
  COM_DOCKER,
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    const ambiente = await alocar("espaco-1");
    const arquivoNoHost = join(raiz, CLAUDE.noHost);
    const documentoLongoDoContainer = `{"quem":"cont","n":"%04d","enchimento":"${"c".repeat(400)}"}`;
    const doContainer = noContainer(
      ambiente,
      `i=1; while [ $i -le ${String(RODADAS_DO_CLAUDE_NO_CONTAINER)} ]; do ${comandoQueRenovaNoContainer(CLAUDE, documentoLongoDoContainer.replace("%04d", "'$i'"), "cont")}; i=$((i+1)); done`,
    );
    await renovarNoHostEnquantoOContainerRoda(doContainer, (rodada) => {
      renovarNoHost(arquivoNoHost, `{"quem":"host","n":"${String(rodada)}"}`, true);
      // O rename é atômico: quem lê no meio da briga vê sempre um documento inteiro.
      assert.match((JSON.parse(readFileSync(arquivoNoHost, "utf8")) as { quem: string }).quem, /^(host|cont)$/);
    });

    const noFim = readFileSync(arquivoNoHost, "utf8");
    assert.match((JSON.parse(noFim) as { quem: string }).quem, /^(host|cont)$/);
    assert.equal(await lerNoContainer(ambiente, CLAUDE), noFim);
  },
);

interface ArmazenamentoDeCredenciaisDoPi {
  modify(provedor: string, renovar: (atual: unknown) => Promise<unknown>): Promise<unknown>;
}

/** O `AuthStorage` do pi instalado no host: lê, trava (`auth.json.lock` ao lado do arquivo) e grava o `auth.json` como o pi. */
async function armazenamentoDeCredenciaisDoPi(arquivo: string): Promise<ArmazenamentoDeCredenciaisDoPi> {
  const { AuthStorage } = (await import(
    pathToFileURL(join(instalacaoDoPi().raiz, "dist", "core", "auth-storage.js")).href
  )) as { AuthStorage: { create(arquivo: string): ArmazenamentoDeCredenciaisDoPi } };
  return AuthStorage.create(arquivo);
}

// O lock do pi fica ao lado do auth.json, e o host e o container têm cada um o seu: o que protege o arquivo compartilhado
// da escrita no lugar dos dois (truncar e gravar) tem que existir, senão um documento curto escrito sobre um longo deixa
// a sobra do longo no fim. Por isso os documentos têm tamanhos diferentes (com o mesmo tamanho, a corrupção some).
// Com o AuthStorage real e dois locks separados, a corrupção aparece em segundos: este teste cobra o lock compartilhado.
test(
  "a renovação concorrente do pi no host (AuthStorage) e no container, com documentos de tamanhos diferentes, nunca corrompe o auth.json",
  COM_DOCKER,
  async (t) => {
    const { raiz, alocar } = await prepararGestaoComCredenciais(t);
    const ambiente = await alocar("espaco-1");
    const arquivoNoHost = join(raiz, PI.noHost);
    const armazenamentoDoHost = await armazenamentoDeCredenciaisDoPi(arquivoNoHost);
    const documentoLongoDoContainer = `{"anthropic":{"type":"oauth","access":"cont-%04d-${"c".repeat(600)}","refresh":"r","expires":1}}`;
    const doContainer = noContainer(
      ambiente,
      `i=1; while [ $i -le ${String(RODADAS_DO_PI_NO_CONTAINER)} ]; do ${comandoQueRenovaNoContainer(PI, documentoLongoDoContainer.replace("%04d", "'$i'"))}; i=$((i+1)); done`,
    );
    // O `modify` lê o arquivo com o lock do host e falha no JSON.parse se o container o deixou corrompido.
    await renovarNoHostEnquantoOContainerRoda(doContainer, async (rodada) => {
      await armazenamentoDoHost.modify("anthropic", () =>
        Promise.resolve({ type: "oauth", access: `host-${String(rodada)}`, refresh: "r", expires: 1 }),
      );
    });

    const noFim = readFileSync(arquivoNoHost, "utf8");
    assert.ok(JSON.parse(noFim) as object);
    assert.equal(await lerNoContainer(ambiente, PI), noFim);
  },
);

// O binário real do Codex num container, sem `CODEX_HOME`, como o agente o roda: ele grava o `auth.json` do `HOME` por
// temporário + rename e tem que seguir o symlink até a pasta montada, em vez de trocá-lo por um arquivo só do container.
// Só roda com um binário do Codex que execute dentro da imagem (um build linux estático, musl), apontado por
// `FABRIQUINHA_TESTE_CODEX_BIN`.
test(
  "CA-4: o `codex login --with-api-key` do container grava o auth.json por rename na pasta montada, o symlink continua e o host o vê",
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

    const login = await noContainer(ambiente, "printf 'sk-teste-do-container' | codex login --with-api-key");
    assert.equal(login.codigo, 0, login.saida);
    assert.match(readFileSync(join(raiz, CODEX.noHost), "utf8"), /sk-teste-do-container/);
    assert.match(await lerNoContainer(ambiente, CODEX), /sk-teste-do-container/);
    const symlink = await noContainer(ambiente, 'test -L "$HOME/.codex/auth.json"');
    assert.equal(symlink.codigo, 0, "o login não trocou o symlink por um arquivo só do container");
  },
);
