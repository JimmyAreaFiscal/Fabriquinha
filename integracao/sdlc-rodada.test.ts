// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-11 e 12 (a rodada): revisão reprovada, PR com conflito ou check
// falho e reprovação humana do PR. O cenário é montado pelos serviços e pelo agendador, com banco e git reais numa raiz
// temporária, o pi e o `gh` falsos; nada passa pela web. O agente (revisor e documentador) é a parte do teste que age
// pelo domínio enquanto o pi falso espera no portão; as verificações do ticket são o único ponto injetado.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Ator, AUDITOR } from "../src/fluxo/nucleo/ator.ts";
import { MOTIVO_APROVACAO_AUTOMATICA_PR } from "../src/fluxo/nucleo/gate.ts";
import { Endereco } from "../src/demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { registrarCorrecoesSessao } from "../src/fluxo/nucleo/transicoes/transicoes_rodada.ts";
import { marcaDoPRRodada } from "../src/qualidade/aplicacao/pull_request/pr_rodada.ts";
import { decidirGate } from "../src/fluxo/aplicacao/gates/decidir_gate.ts";
import { cicloDoDespacho } from "../src/execucao/aplicacao/despacho.ts";
import {
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAutomatica,
} from "../src/execucao/aplicacao/trabalho/condutor.ts";
import { concluirSessaoAjustes } from "../src/execucao/aplicacao/sessoes/sessao_ajustes.ts";
import { comDemanda } from "../src/demanda/armazenamento/demandas.ts";
import { caminhoDaWorktreeRodada } from "../src/repositorio/infra/worktree/worktree-demanda.ts";
import {
  agente,
  agora,
  atual,
  despacho,
  encerrar,
  execucoesDe,
  fecharPortao,
  pi,
  pisAteAgora,
  revisar,
  rodadaDe,
  rodadaEmEncerramento,
  rodadaEmRevisao,
  statusDe,
} from "./apoio-execucao.ts";
import { AUTOR, base, type Cenario, ciclo, criarCenario, demanda, esperar, git } from "./apoio.ts";
import type { PassoPi } from "../apoio-testes/pi_falso.ts";
import { ghFalso } from "./falsos.ts";

const gh = ghFalso(base);

const correcao = (id: string, titulo: string) => ({
  demanda_id: id,
  ticket_id: 1,
  rodada_id: 1,
  titulo,
  descricao: "descrição da correção",
  arquivos_previstos: [],
});

/** Abre na hospedagem o PR que o encerramento adotará pela marca (o `problema` entra no estado dele). */
function prComProblema(c: Cenario, id: string, problema: "check" | "conflito"): void {
  const { branch } = rodadaDe(c, id, 1) ?? { branch: "" };
  gh.zerar();
  gh.abrirPr({
    head: branch,
    base: demanda(c, id).demanda.branch,
    titulo: "velho",
    corpo: `${marcaDoPRRodada(id, atual(c, id, "encerrar_rodada").ticket_id)}\nvelho`,
    estado: "aberto",
  });
  if (problema === "check") gh.checkFalho(1);
  else gh.conflito(1);
}

/** O corretivo aberto (o `implementar` de maior id) e a verificação de que o PR ainda não chegou ao gate. */
function corretivoAntesDoGate(c: Cenario, id: string, titulo: RegExp) {
  const rodada = rodadaDe(c, id, 1);
  assert.equal(rodada?.estado, "implementar");
  assert.equal(atual(c, id, "encerrar_rodada").estado, "concluido");
  const encerramentos = demanda(c, id).tickets.filter((x) => x.etapa === "encerrar_rodada");
  assert.deepEqual(
    demanda(c, id).decisoes.filter((d) => encerramentos.some((x) => x.ticket_id === d.ticket_id)),
    [],
    "sem decisão humana no gate do PR",
  );
  const corretivo = atual(c, id, "implementar");
  assert.equal(corretivo.estado, "aberto");
  assert.match(corretivo.titulo ?? "", titulo);
  return corretivo;
}

/** O agente da correção chama a `perguntar` e fica parado até a resposta; o Auditor automático (um `pi -p`) responde "Sim". */
const agenteQuePergunta: PassoPi[] = [
  {
    agente,
    termina: "nunca",
    eventos: [
      {
        type: "tool_execution_start",
        toolCallId: "p1",
        toolName: "perguntar",
        args: { question: "Sigo com o caso X?", options: [{ label: "Sim" }, { label: "Não" }] },
      },
      {
        type: "extension_ui_request",
        id: "d1",
        method: "select",
        title: "Sigo com o caso X?",
        options: ["Sim", "Não"],
      },
    ],
  },
  { chamadaUnica: { saida: { decisao: "responder", resposta: "Sim", justificativa: "é o caso da correção" } } },
];

/** Os atores das colunas de autoria, como o banco os guarda (sem passar pelo agregado): `prefixo_tipo`, `_trabalho_id`... */
function atoresDasColunas(c: Cenario, tabela: string, prefixo: string): unknown[] {
  const linhas = c.banco.prepare(`SELECT * FROM ${tabela}`).all() as Record<string, unknown>[];
  return linhas.map((linha) => {
    const colunas = Object.entries(linha).filter(
      ([coluna, valor]) => coluna.startsWith(`${prefixo}_`) && valor !== null,
    );
    return Object.fromEntries(colunas.map(([coluna, valor]) => [coluna.slice(prefixo.length + 1), valor]));
  });
}

test("CA-SDLC-11: revisão reprovada devolve as correções ao desenvolvimento, que percorrem nova revisão e o encerramento", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmRevisao(c);
  const primeira = atual(c, id, "implementar");

  // Reprovada: o motivo fica na decisão, a correção nasce aberta na mesma rodada e a rodada volta ao desenvolvimento.
  const reprovada = await revisar(c, id, {
    resultado: "reprovado",
    motivo: "falta tratar o caso X",
    correcoes: [correcao(id, "Tratar o caso X")],
  });
  const ag = demanda(c, id);
  assert.equal(rodadaDe(c, id, 1)?.estado, "implementar");
  assert.equal(statusDe(c, { demanda_id: id, ticket_id: reprovada }), "concluido");
  assert.deepEqual(
    ag.decisoes.filter((d) => d.ticket_id === reprovada).map((d) => [d.resultado, d.motivo, d.por]),
    [
      [
        "reprovado",
        "falta tratar o caso X",
        { tipo: "agente", trabalho_id: execucoesDe(c, { demanda_id: id, ticket_id: reprovada }).at(-1)?.id },
      ],
    ],
  );
  const corretivo = atual(c, id, "implementar");
  assert.ok(corretivo.ticket_id > reprovada);
  assert.equal(corretivo.estado, "aberto");
  assert.equal(corretivo.titulo, "Tratar o caso X");
  // I-266.T6: o ticket corretivo é do Agente revisor; a Fabriquinha só o materializa.
  assert.deepEqual(corretivo.criado_por, {
    tipo: "agente",
    trabalho_id: execucoesDe(c, { demanda_id: id, ticket_id: reprovada }).at(-1)?.id,
  });

  // I-280: a reprovação grava a versão 2 do Plano (a 1 é o aprovado), do Agente revisor, com os tickets corretivos criados.
  assert.deepEqual(
    ag.versoes_plano.map((v) => v.numero),
    [1, 2],
  );
  const versaoDaCorrecao = ag.versoes_plano[1];
  assert.ok(versaoDaCorrecao);
  assert.equal(versaoDaCorrecao.origem, "revisao_rodada");
  assert.deepEqual(versaoDaCorrecao.autor, corretivo.criado_por);
  const { tickets_novos } = versaoDaCorrecao.dados as { tickets_novos: { titulo: string }[] };
  assert.deepEqual(
    tickets_novos.map((t) => t.titulo),
    [corretivo.titulo],
  );

  // A correção executa pelo agendador, como qualquer implementação, e a rodada volta à revisão com um revisor novo.
  pi.roteirizar(agenteQuePergunta);
  await ciclo(c, despacho());
  assert.equal(statusDe(c, corretivo), "concluido");
  // I-266.T7: a resposta do Auditor automático fica registrada como Agente da execução em curso, não como Auditor.
  const execucaoDaCorrecao = execucoesDe(c, corretivo).at(-1)?.id;
  const linhaDaResposta = readFileSync(join(c.raiz, "execucoes", `E-${String(execucaoDaCorrecao)}`, "log"), "utf8")
    .split("\n")
    .find((linha) => linha.includes(PREFIXO_DA_RESPOSTA_AUTOMATICA));
  assert.ok(linhaDaResposta, "a resposta do Auditor automático está no log da execução");
  const resposta = JSON.parse(
    linhaDaResposta.slice(
      linhaDaResposta.indexOf(PREFIXO_DA_RESPOSTA_AUTOMATICA) + PREFIXO_DA_RESPOSTA_AUTOMATICA.length,
    ),
  ) as RespostaAutomatica;
  assert.equal(resposta.resposta, "Sim");
  assert.deepEqual(resposta.ator, { tipo: "agente", trabalho_id: execucaoDaCorrecao });
  assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");
  const nova = atual(c, id, "revisar_rodada");
  assert.ok(nova.ticket_id > corretivo.ticket_id);
  assert.equal(nova.estado, "aberto");

  // Nova revisão aprovada leva ao encerramento, que publica o PR da rodada com as duas implementações.
  const aprovada = await revisar(c, id, { resultado: "aprovado" });
  assert.equal(aprovada, nova.ticket_id);
  assert.equal(rodadaDe(c, id, 1)?.estado, "encerrar_rodada");
  await encerrar(c, id);
  assert.equal(rodadaDe(c, id, 1)?.estado, "gate_pr");
  const [pr] = gh.prs();
  assert.equal(gh.prs().length, 1);
  assert.equal(pr?.head, rodadaDe(c, id, 1)?.branch);
  assert.equal(pr?.base, ag.demanda.branch);
  for (const ticket of [primeira, corretivo]) assert.ok(pr.corpo.includes(`${id}.T${String(ticket.ticket_id)}`));
  const worktree = caminhoDaWorktreeRodada(c.raiz, c.projeto, { demanda_id: id, rodada_id: 1 });
  assert.equal(git(worktree, "log", "--format=%s", "--grep", `\\[${id}\\.T`).split("\n").length, 2);

  // I-266.T6: a evidência que a própria Fabriquinha grava tem sempre o autor `fabriquinha`, nunca o da demanda.
  const evidenciasDaFabriquinha = demanda(c, id).evidencias.filter((e) => e.tipo === "execucao_testes");
  assert.ok(evidenciasDaFabriquinha.length > 0);
  for (const e of evidenciasDaFabriquinha) assert.deepEqual(e.autor, { tipo: "fabriquinha" });

  // Relidas do banco, todas as autorias são Atores válidos (a transição não tem coluna de ator: vale a da decisão ou da evidência).
  const relidas = [
    ...atoresDasColunas(c, "decisao_ticket", "por"),
    ...atoresDasColunas(c, "ticket_demanda", "criado_por"),
    ...atoresDasColunas(c, "evidencia_demanda", "autor"),
    ...atoresDasColunas(c, "demanda", "criada_por").map((externo) => ({ tipo: "externo", ...(externo as object) })),
  ];
  assert.ok(relidas.length > 0);
  for (const ator of relidas) Ator.parse(ator);
});

test("os agentes da rodada recebem o que a Fabriquinha apurou: o diff e a matriz de fitness com os logs na revisão, os não previstos e o impacto no encerramento", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  // O revisor explica a matriz coletada antes do pi dele: cada linha e o log dela, num arquivo que ele consegue ler.
  const revisor = pi.prompts()[0]?.prompt ?? "";
  assert.match(revisor, /## Matriz de fitness functions[\s\S]*- \*\*f\*\* \(d\): `true` saiu com código 0/);
  const [, log] = /- `f\.log`: `([^`]+)`/.exec(revisor) ?? [];
  assert.ok(log !== undefined && existsSync(log), `o log da fitness f no disco: ${String(log)}`);
  // E confere o diff que a Fabriquinha apurou na mesma preparação: o arquivo novo, fora dos caminhos do plano.
  assert.match(revisor, /## Arquivos alterados[\s\S]*- `feature\.txt` \(A, \+1 −0\): não previsto/);

  // O documentador justifica exatamente os arquivos alterados fora dos caminhos do plano, apurados na revisão, e sabe
  // que o impacto alto do relatório da demanda exige a reversão. ponytail: o relatório entra direto no agregado, porque
  // a definição congela no envio e o apoio não o registra; é o mesmo estado que a ferramenta externa deixaria.
  comDemanda(c.banco, id, (ag) => ({
    ...ag,
    evidencias: [
      ...ag.evidencias,
      {
        demanda_id: id,
        rodada_id: undefined,
        ticket_id: undefined,
        tipo: "relatorio_impactos_arquitetura",
        autor: AUTOR,
        em: agora(),
        dados: { impacto: "alto" },
      },
    ],
  }));
  await encerrar(c, id);
  const documentador = pi.prompts()[0]?.prompt ?? "";
  assert.match(documentador, /## Arquivos não previstos[\s\S]*- `feature\.txt`/);
  assert.match(documentador, /## Impacto na arquitetura\n\nalto: escreva em `reversao`/);
});

test("aprovação automática ligada para o projeto: o encerramento pelo agendador integra o PR da rodada sem o Auditor", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  process.env.FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA = c.projeto;
  t.after(() => {
    delete process.env.FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA;
  });

  await encerrar(c, id);

  assert.equal(rodadaDe(c, id, 1)?.estado, "concluida");
  assert.equal(gh.prs()[0]?.estado, "mergeado");
  const gate = atual(c, id, "encerrar_rodada").ticket_id;
  const decisao = demanda(c, id).decisoes.find((d) => d.ticket_id === gate);
  assert.deepEqual(
    [decisao?.resultado, decisao?.nota, decisao?.motivo],
    ["aprovado", undefined, MOTIVO_APROVACAO_AUTOMATICA_PR],
  );
});

// Commita na worktree em que o pi roda: o que a conversa da sessão de ajustes não pode deixar.
const intruso = join(base, "agente-intruso.mjs");
writeFileSync(
  intruso,
  `import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
export default async () => {
  writeFileSync("intruso.txt", "x\\n");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qm", "intruso"]);
};
`,
);

test("CA-SDLC-12: conflito ou check falho do PR geram correção antes de novo gate; reprovação humana abre conversa na hora e não muda o código", async (t) => {
  // Check falho: a correção volta ao desenvolvimento (D05: a devolução técnica vai ao prompt) e só então há novo gate.
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  prComProblema(c, id, "check");
  await encerrar(c, id);
  const corretivo = corretivoAntesDoGate(c, id, /Corrigir o check ci do PR da I-\d+\.R1/);
  assert.equal(gh.prs().length, 1);

  let aprovada = false;
  pi.roteirizar([{ agente }]);
  await ciclo(
    c,
    despacho(() => aprovada),
  );
  const devolvido = demanda(c, id).tickets.find((x) => x.ticket_id === corretivo.ticket_id);
  assert.deepEqual(
    [
      devolvido?.estado,
      demanda(c, id).tentativas.filter(
        (tentativa) => tentativa.ticket.ticket_id === corretivo.ticket_id && tentativa.resultado?.tipo === "reprovacao",
      ).length,
    ],
    ["aberto", 1],
  );
  aprovada = true;
  await ciclo(
    c,
    despacho(() => aprovada),
  );
  assert.match(pi.prompts().at(-1)?.prompt ?? "", /execucao_testes: reprovado no teste/);
  assert.equal(statusDe(c, corretivo), "concluido");
  assert.equal(rodadaDe(c, id, 1)?.estado, "revisar_rodada");

  // Revista e reencerrada, com o check já verde, a rodada chega ao gate; a nota do PR (D03) fecha a rodada.
  await revisar(c, id, { resultado: "aprovado" });
  gh.mudar(1, { checks: [{ nome: "ci", estado: "aprovado" }] });
  await encerrar(c, id);
  assert.equal(rodadaDe(c, id, 1)?.estado, "gate_pr");
  assert.equal(gh.prs().length, 1);
  await decidirGate(c.banco, "gate_pr", Endereco.daRodada(id, 1), { resultado: "aprovado", nota: 4 }, AUDITOR);
  assert.equal(rodadaDe(c, id, 1)?.estado, "concluida");
  assert.equal(demanda(c, id).decisoes.find((d) => d.ticket_id === atual(c, id, "encerrar_rodada").ticket_id)?.nota, 4);

  // Conflito do PR: mesma regra, com a correção de resolver o conflito.
  const conflitante = criarCenario(t);
  const idConflito = await rodadaEmEncerramento(conflitante);
  prComProblema(conflitante, idConflito, "conflito");
  await encerrar(conflitante, idConflito);
  corretivoAntesDoGate(conflitante, idConflito, /Resolver o conflito do PR da I-\d+\.R1/);

  // Reprovação humana: com o PR limpo no gate, o Auditor reprova e a conversa abre na hora, sem esperar o agendador.
  const humana = criarCenario(t);
  const idHumana = await rodadaEmEncerramento(humana);
  gh.zerar();
  await encerrar(humana, idHumana);
  assert.equal(rodadaDe(humana, idHumana, 1)?.estado, "gate_pr");
  const ref = { demanda_id: idHumana, rodada_id: 1 };
  const worktree = caminhoDaWorktreeRodada(humana.raiz, humana.projeto, ref);
  const ponta = (branch: string) => git(humana.repo, "rev-parse", `refs/heads/${branch}`);
  const { branch: branchRodada } = rodadaDe(humana, idHumana, 1) ?? { branch: "" };
  const { branch: branchDemanda } = demanda(humana, idHumana).demanda;
  const [rodadaAntes, demandaAntes] = [ponta(branchRodada), ponta(branchDemanda)];

  fecharPortao();
  pi.roteirizar([{ agente: intruso }]);
  const chamadasAntes = pisAteAgora();
  await decidirGate(
    humana.banco,
    "gate_pr",
    Endereco.daRodada(idHumana, 1),
    { resultado: "reprovado", motivo: "o PR mistura duas mudanças" },
    AUDITOR,
  );
  await esperar(() => pisAteAgora() === chamadasAntes + 1, "o pi da conversa receber o prompt sem esperar o agendador");
  assert.match(pi.prompts().at(-1)?.prompt ?? "", /sessão de ajustes[\s\S]*o PR mistura duas mudanças/);
  assert.equal(rodadaDe(humana, idHumana, 1)?.estado, "ajustar_resultado");
  const gate = atual(humana, idHumana, "encerrar_rodada").ticket_id;
  const reprovacao = demanda(humana, idHumana).decisoes.find((d) => d.ticket_id === gate);
  assert.deepEqual(
    [reprovacao?.resultado, reprovacao?.motivo, reprovacao?.nota],
    ["reprovado", "o PR mistura duas mudanças", undefined],
  );
  await esperar(() => git(worktree, "log", "-1", "--format=%s") === "intruso", "o agente da conversa commitar");
  assert.equal(cicloDoDespacho(humana.banco, humana.config, despacho()).length, 0);

  // A conversa só registra correções: o que ela commitou é desfeito ao concluir, e nada é implementado nem integrado.
  const { ticket_id } = atual(humana, idHumana, "ajustar_resultado");
  comDemanda(humana.banco, idHumana, (ag) =>
    registrarCorrecoesSessao(
      ag,
      { ...ref, ticket_id, correcoes: [correcao(idHumana, "Separar as mudanças")] },
      AUDITOR,
      { agora: agora() },
    ),
  );
  await concluirSessaoAjustes(humana.banco, ref, AUDITOR); // aguarda o fim da conversa
  assert.equal(rodadaDe(humana, idHumana, 1)?.estado, "implementar");
  assert.equal(atual(humana, idHumana, "implementar").estado, "aberto");
  assert.equal(ponta(branchRodada), rodadaAntes);
  assert.equal(ponta(branchDemanda), demandaAntes);
  assert.equal(git(worktree, "status", "--porcelain"), "");
  assert.equal(gh.prs().length, 1);
  assert.equal(gh.prs()[0]?.estado, "aberto");
});
