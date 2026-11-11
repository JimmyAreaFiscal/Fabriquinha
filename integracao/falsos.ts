// Falso da suíte de integração do SDLC: a hospedagem (`gh` na frente do PATH, com o estado dos PRs num JSON). O pi falso
// é o de `apoio-testes/pi_falso.ts`. Combinado com a I-244: quem precisa de mais, acrescenta aqui.
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, type TestContext } from "node:test";
import { hospedagemFalsa } from "../apoio-testes/hospedagem_falsa.ts";
import { ConjuntoDeAmbientes } from "../src/ambiente/aplicacao/conjunto_de_ambientes/conjunto.ts";
import { montarConjuntoDoServico } from "../src/ambiente/aplicacao/espaco/ambiente_do_servico.ts";
import { gravarProjeto, projetoExistente } from "../src/ambiente/armazenamento/projetos.ts";
import { salvarConfiguracaoDoAmbiente } from "../src/compartilhado/armazenamento/servico.ts";
import { dirDoPiDoAuditor, PACOTE } from "../src/harness/pi/pi.ts";
import { GeradorDeAmbientes } from "../src/ambiente/infra/container/gerador_de_ambientes.ts";
import { Projeto } from "../src/ambiente/nucleo/projeto.ts";
import { relogioDoSistema } from "../src/compartilhado/nucleo/relogio.ts";
import { levarPiFalsoParaOContainer } from "./apoio-execucao.ts";
import { type Cenario, git } from "./apoio.ts";

/** O `gh` falso (a hospedagem já testada em `apoio-testes/hospedagem_falsa.ts`) com os cenários da seção 12 nomeados. */
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
  copyFileSync(join(import.meta.dirname, "..", "apoio-testes", "pi_falso.ts"), join(pastaDoPi, "pi_falso.ts"));
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

/** O gerador de verdade, que lembra os containers que criou: o teste elimina só os dele, e não os do serviço. */
class GeradorQueLembraOsContainers extends GeradorDeAmbientes {
  readonly criados: Awaited<ReturnType<GeradorDeAmbientes["criar"]>>[] = [];

  override async criar(...argumentos: Parameters<GeradorDeAmbientes["criar"]>) {
    const criado = await super.criar(...argumentos);
    this.criados.push(criado);
    return criado;
  }
}

/**
 * Liga o Ambiente `container` do serviço: o conjunto de containers do cenário, o `auth.json` do pi que o container
 * recebe e o pi falso na imagem, que devolve. Ao fim do teste, elimina os containers que o cenário criou.
 * `portaDaApi` é a única porta do host que o container alcança; só o teste da rede põe um servidor nela.
 */
export function ligarContainerAoCenario(t: TestContext, c: Cenario, portaDaApi = 1) {
  salvarConfiguracaoDoAmbiente(c.banco, {
    tipo: "container",
    memoria_maxima_mb: 1024,
    cpus: 1,
    ociosidade_para_eliminar_min: 60,
  });
  writeFileSync(join(dirDoPiDoAuditor(), "auth.json"), "{}");
  // A API do agente não sobe nestes testes: o agente falso fala com o core pelo que o teste faz por ele.
  const gerador = new GeradorQueLembraOsContainers();
  const conjunto = new ConjuntoDeAmbientes(c.banco, gerador, relogioDoSistema, {
    raiz: c.raiz,
    porta_da_api: portaDaApi,
    home_do_usuario: c.raiz,
    pacote_do_harness: PACOTE,
    dir_do_harness_do_auditor: dirDoPiDoAuditor(),
  });
  montarConjuntoDoServico(() => conjunto);
  const piDoContainer = levarPiFalsoParaOContainer(join(c.repo, ".git", "objects", "pi-falso"));
  t.after(async () => {
    montarConjuntoDoServico(() => undefined);
    for (const criado of gerador.criados) await gerador.eliminar(criado);
  });
  return piDoContainer;
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
