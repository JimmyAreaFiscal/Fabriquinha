// I-276, CA-4: uma rodada inteira (implementar, revisar_rodada e encerrar_rodada) num Ambiente falso. Tudo o que é do
// Espaço de Trabalho passa por ele: o git da worktree, a Preparação, cada Verificação e o pi de cada ticket. As
// chamadas diretas a `infra/processo.ts` que sobram são do core (`gh`, `sonar-scanner`, rede do git).
import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { after, test } from "node:test";
import { AmbienteFalso, espiarProcessosForaDoAmbiente } from "../apoio-testes/ambiente_falso.ts";
import { montarAmbienteDoServico } from "../src/aplicacao/espaco/ambiente_do_servico.ts";
import type { DepsDespacho } from "../src/aplicacao/despacho.ts";
import { gravarProjeto, projetoExistente } from "../src/armazenamento/projetos.ts";
import { Projeto } from "../src/nucleo/projeto.ts";
import { abrirPortao, agente, demandaEmExecucao, encerrar, pi, rodadaDe, revisar } from "./apoio-execucao.ts";
import { caminhoDaWorktreeRodada } from "../src/infra/repositorio/worktree-demanda.ts";
import { base, ciclo, criarCenario, demanda } from "./apoio.ts";
import { ghFalso } from "./falsos.ts";

// O `gh` falso, e com ele o `bin` do PATH onde também fica o sonar-scanner falso.
ghFalso(base);

// sonar-scanner e SonarQube falsos: o scanner informa a tarefa do Compute Engine e o servidor não acusa issue.
const bin = join(base, "bin");
writeFileSync(
  join(bin, "sonar-scanner"),
  `#!/bin/sh
for a; do case $a in -Dsonar.working.directory=*) w=\${a#*=};; esac; done
printf 'ceTaskId=AX1\\n' > "$w/report-task.txt"
`,
);
chmodSync(join(bin, "sonar-scanner"), 0o755);
const servidorSonar = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "", "http://sonar");
  const corpo =
    pathname === "/api/system/status"
      ? { status: "UP" }
      : pathname === "/api/ce/task"
        ? { task: { status: "SUCCESS" } }
        : { paging: { total: 0 }, issues: [] };
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(corpo));
});
servidorSonar.listen(0, "127.0.0.1");
await once(servidorSonar, "listening");
process.env.SONAR_HOST_URL = `http://127.0.0.1:${String((servidorSonar.address() as AddressInfo).port)}`;
process.env.SONAR_TOKEN = "segredo";
after(() => {
  servidorSonar.close();
});

/** O despacho que fecha o ticket com as Verificações de verdade, e não com as injetadas dos outros testes. */
const despachoComVerificacoesReais: DepsDespacho = {
  implementacao: { opcoesSonar: { limiteMs: 60_000, intervaloMs: 1 } },
};

test("CA-4: git da worktree, Preparação, Verificações e pi de cada ticket da rodada passam pelo Ambiente", async (t) => {
  const ambiente = new AmbienteFalso();
  montarAmbienteDoServico(ambiente);
  const espiao = espiarProcessosForaDoAmbiente();
  t.after(() => {
    espiao.parar();
  });

  const c = criarCenario(t);
  const projetoDoCenario = projetoExistente(c.banco, c.projeto);
  gravarProjeto(
    c.banco,
    Projeto.parse({
      ...projetoDoCenario,
      verificacoes: {
        preparacao: ["echo marca-preparacao"],
        fitness: [{ nome: "f", comando: "echo marca-fitness", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "echo marca-teste" }],
      },
    }),
  );
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  abrirPortao();
  pi.roteirizar([{ agente, uso: null }]);
  await ciclo(c, despachoComVerificacoesReais);
  assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");
  await revisar(c, id, { resultado: "aprovado" });
  await encerrar(c, id);

  const rodada = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
  const comandosNaRodada = ambiente.registro.filter((r) => r.comando.cwd === rodada);
  const gitNaRodada = (subcomando: string) =>
    ambiente.registro.some(
      ({ comando: { programa, argumentos } }) =>
        programa === "git" && argumentos[0] === "-C" && argumentos[1] === rodada && argumentos.includes(subcomando),
    );
  const shellNaRodada = (linhaDeComando: string) =>
    comandosNaRodada.some(
      ({ via, comando }) => via === "executar" && comando.noShell && comando.programa === linhaDeComando,
    );

  // O git da worktree: o commit do ticket, o status e o merge da rodada, e a lista de arquivos do Sonar.
  for (const subcomando of ["commit", "status", "merge", "ls-files"]) assert.ok(gitNaRodada(subcomando), subcomando);
  // A Preparação e cada Verificação que executa código.
  assert.ok(shellNaRodada("echo marca-preparacao"), "preparação");
  assert.ok(shellNaRodada("echo marca-teste"), "execucao_testes");
  assert.ok(shellNaRodada("echo marca-fitness"), "matriz_fitness");
  // O pi de cada ticket da rodada: implementar, revisar_rodada e encerrar_rodada.
  const ticketsDaRodada = demanda(c, id).tickets.filter((x) => x.rodada_id === 1);
  assert.deepEqual(
    ticketsDaRodada.map((x) => x.etapa),
    ["implementar", "revisar_rodada", "encerrar_rodada"],
  );
  assert.equal(comandosNaRodada.filter((r) => r.via === "lancar").length, ticketsDaRodada.length);

  // Fora do Ambiente só sobra o core, e o espião enxerga processos diretos: o `sonar-scanner`, que lê a worktree pelo caminho do host.
  assert.ok(
    espiao.chamadas.some((x) => x.programa === "sonar-scanner"),
    "o espião vê o sonar-scanner",
  );
  const pastaDasWorktrees = join(c.raiz, "worktrees");
  const diretasDoEspaco = espiao.chamadas.filter(
    ({ programa, argumentos, cwd }) =>
      programa !== "sonar-scanner" &&
      (programa === "/bin/sh" ||
        argumentos.includes("rpc") ||
        [cwd, ...argumentos].some((valor) => valor?.startsWith(pastaDasWorktrees))),
  );
  assert.deepEqual(diretasDoEspaco, []);
});
