// Falso da suíte de integração do SDLC: a hospedagem (`gh` na frente do PATH, com o estado dos PRs num JSON). O pi falso
// é o de `apoio-testes/falsos/pi_falso.ts`. Combinado com a I-244: quem precisa de mais, acrescenta aqui.
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, type TestContext } from "node:test";
import { hospedagemFalsa } from "../apoio-testes/falsos/hospedagem_falsa.ts";
import { type GestaoDeAmbientes, montarGestaoDeAmbientes } from "../src/modulos/ambiente/publico.ts";
import { noLog } from "../src/shared/infra/registro.ts";
import {
  configuracaoDoAmbiente,
  salvarConfiguracaoDoAmbiente,
} from "../src/shared/armazenamento/configuracao_do_ambiente.ts";
import { AmbienteContainer, ligarGestaoDeAmbientesNosModulos } from "../apoio-testes/falsos/ambiente_falso.ts";
import { gravarProjeto, Projeto, projetoExistente } from "../src/modulos/demandas/publico.ts";
import { dirDoPiDoAuditor, PACOTE } from "../src/modulos/sessoes/publico.ts";
import { levarPiFalsoParaOContainer } from "./apoio-execucao.ts";
import { type Cenario, git } from "./apoio.ts";

/** O `gh` falso (a hospedagem já testada em `apoio-testes/falsos/hospedagem_falsa.ts`) com os cenários da seção 12 nomeados. */
export function ghFalso(dir: string) {
  const h = hospedagemFalsa(dir);
  h.zerar();
  return {
    ...h,
    conflito: (id: number) => {
      h.mudar(id, { conflito: true });
    },
    checkFalho: (id: number) => {
      h.mudar(id, { checks: [{ nome: "ci", estado: "falho" }] });
    },
    mergeFalha: (stderr = "merge rejeitado pela hospedagem") => {
      h.falhar("pr merge", stderr);
    },
  };
}

/** O pi falso da imagem: roteiro e registro ficam em `.git/objects/pi-falso`, a única parte gravável do `.git` que o container monta. */
const PI_DA_IMAGEM = `#!/bin/sh
pasta=$(git rev-parse --path-format=absolute --git-common-dir)/objects/pi-falso || exit 1
FALSO_PI_ROTEIRO="$pasta/pi-roteiro.json" FALSO_PI_REGISTRO="$pasta/pi-registro.jsonl" exec node /opt/pi-falso/pi_falso.ts "$@"
`;

/**
 * Faz do repositório do cenário o projeto de teste de `integracao/projeto-container/` (Dockerfile, teste, e2e e hook de
 * commit), com o pi falso na imagem, e o configura com a imagem do Ambiente. O commit já sai pelo hook do projeto.
 */
export function projetoDeTesteEmContainer(c: Cenario): void {
  cpSync(join(import.meta.dirname, "projeto-container"), c.repo, { recursive: true });
  const pastaDoPi = join(c.repo, "pi-falso");
  mkdirSync(pastaDoPi);
  copyFileSync(
    join(import.meta.dirname, "..", "apoio-testes", "falsos", "pi_falso.ts"),
    join(pastaDoPi, "pi_falso.ts"),
  );
  writeFileSync(join(pastaDoPi, "pi"), PI_DA_IMAGEM, { mode: 0o755 });
  appendFileSync(join(c.repo, "Dockerfile"), "COPY --chmod=755 pi-falso /opt/pi-falso\nENV PATH=/opt/pi-falso:$PATH\n");
  git(c.repo, "add", "-A");
  git(c.repo, "commit", "-q", "-m", "projeto de teste em container");
  git(c.repo, "push", "-q", "origin", "main");
  git(c.repo, "config", "core.hooksPath", "hooks");
  const projeto = projetoExistente(c.banco, c.projeto);
  gravarProjeto(
    c.banco,
    Projeto.parse({
      ...projeto,
      imagem_do_ambiente: "Dockerfile",
      verificacoes: {
        preparacao: ["node --version"],
        fitness: [{ nome: "e2e", comando: "npm run e2e", descricao: "o programa imprime a soma" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }],
      },
    }),
  );
}

/**
 * Liga o Ambiente `container` do serviço: a gestão de Ambientes do cenário, montada como a composição a monta (com a
 * Configuração lida do banco), o `auth.json` do pi que o container recebe e o pi falso na imagem, que devolve com a
 * gestão. Ao fim do teste, elimina os containers que o cenário criou. `portaDaApi` é a única porta do host que o
 * container alcança; só o teste da rede põe um servidor nela.
 */
export async function ligarContainerAoCenario(t: TestContext, c: Cenario, portaDaApi = 1) {
  writeFileSync(join(dirDoPiDoAuditor(), "auth.json"), "{}");
  // A API do agente não sobe nestes testes: o agente falso fala com o core pelo que o teste faz por ele.
  const montada = await montarGestaoDeAmbientes({
    banco: c.banco,
    configuracao: () => configuracaoDoAmbiente(c.banco),
    servico: {
      raiz: c.raiz,
      porta_da_api: portaDaApi,
      home_do_usuario: c.raiz,
      pacote_do_harness: PACOTE,
      dir_do_harness_do_auditor: dirDoPiDoAuditor(),
    },
    registrarErro: noLog,
  });
  // A gestão do serviço, que lembra os containers que alocou: o teste elimina só os dele, e não os do serviço, mesmo
  // depois de o cenário fechar o banco.
  const containersDoCenario = new Set<string>();
  const gestao: GestaoDeAmbientes = {
    listar: () => montada.listar(),
    async alocar(ocupante, projeto) {
      const ambiente = await montada.alocar(ocupante, projeto);
      if (ambiente instanceof AmbienteContainer) containersDoCenario.add(ambiente.container_id);
      return ambiente;
    },
    ambienteDo: (ocupante) => montada.ambienteDo(ocupante),
    limpar: (id) => montada.limpar(id),
    deletar: (id) => montada.deletar(id),
    parar: () => montada.parar(),
  };
  // Montada no host_local, a gestão não confere o conjunto com o docker: no Docker de verdade, a conferência eliminaria
  // como órfãos os containers do serviço que roda na máquina. O `container` só vale depois da montagem.
  salvarConfiguracaoDoAmbiente(c.banco, {
    tipo: "container",
    memoria_maxima_mb: 1024,
    cpus: 1,
    ociosidade_para_eliminar_min: 60,
    conjunto: "variavel",
    capacidade_do_conjunto: null,
    minimo_do_conjunto: 0,
  });
  ligarGestaoDeAmbientesNosModulos(gestao);
  const piDoContainer = levarPiFalsoParaOContainer(join(c.repo, ".git", "objects", "pi-falso"));
  t.after(async () => {
    ligarGestaoDeAmbientesNosModulos();
    await montada.parar();
    for (const containerId of containersDoCenario)
      execFileSync("docker", ["rm", "--force", containerId], { stdio: "ignore" });
  });
  return { pi: piDoContainer, gestao };
}

/**
 * Uma raiz nova para o cenário, na home: o Docker Desktop só compartilha com o container as pastas dela, e o cenário
 * monta a worktree, o `.git` e as sessões. `criarCenario` a apaga ao fim do teste.
 */
export function raizCompartilhadaComODocker(): string {
  const pasta = join(homedir(), ".cache");
  mkdirSync(pasta, { recursive: true });
  return mkdtempSync(join(pasta, "teste-com-docker-"));
}

/** O `sonar-scanner` falso (na frente do PATH, em `bin`) e o SonarQube falso: o scanner informa a tarefa e o servidor não acusa issue. */
export async function instalarSonarFalso(bin: string): Promise<void> {
  writeFileSync(
    join(bin, "sonar-scanner"),
    `#!/bin/sh
for a; do case $a in -Dsonar.working.directory=*) w=\${a#*=};; esac; done
printf 'ceTaskId=AX1\\n' > "$w/report-task.txt"
`,
    { mode: 0o755 },
  );
  const servidor = createServer((req, res) => {
    const pathname = (req.url ?? "").split("?")[0];
    const corpo =
      pathname === "/api/system/status"
        ? { status: "UP" }
        : pathname === "/api/ce/task"
          ? { task: { status: "SUCCESS" } }
          : { paging: { total: 0 }, issues: [] };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(corpo));
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  process.env.SONAR_HOST_URL = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`;
  process.env.SONAR_TOKEN = "segredo";
  after(() => {
    servidor.close();
  });
}
