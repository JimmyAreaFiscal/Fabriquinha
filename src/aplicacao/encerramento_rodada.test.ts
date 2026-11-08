// Encerramento da rodada com banco real, git real, pi falso e hospedagem falsa (CA-2 a CA-12 da I-227).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso } from "../../apoio-testes/pi_falso.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { motivoDaFalhaDoTicket } from "../nucleo/tentativa.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { ErroDeRegra, ErroExterno } from "../nucleo/erros.ts";
import { marcaDoPRRodada } from "./evidencias/pr_rodada.ts";
import { gravarCommitDemanda } from "../armazenamento/commits_demanda.ts";
import { cursorDaBase } from "../armazenamento/retrabalho.ts";
import { registrarProjeto } from "./projeto/cadastro.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { carregarTrabalhosDoTicket } from "../armazenamento/trabalho_agentico.ts";
import { hospedagemFalsa } from "../../apoio-testes/hospedagem_falsa.ts";
import { criarRepositorioDeTeste, commitarArquivo, rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import {
  caminhoDaWorktreeRodada,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "../infra/repositorio/worktree-demanda.ts";
import { concluirEncerramentoRodada, iniciarEncerramentoRodada } from "./encerramento_rodada.ts";
import { conferirPromptComFoto } from "./fotos_retorno/conferir_foto.ts";
import { AmbienteHostLocal } from "../infra/ambiente/ambiente_host_local.ts";

const ambiente = new AmbienteHostLocal();

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-encerramento-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;
// A credencial do serviço, que os comandos de PR precisam ver.
process.env.GH_TOKEN = "token-do-servico";

const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const DEMANDA = "I-206";
const REF = { demanda_id: DEMANDA, rodada_id: 2 };
const BRANCH_DEMANDA = "fabriquinha/I-206";
const BRANCH_RODADA = "fabriquinha/I-206-2";
const MARCA = marcaDoPRRodada(DEMANDA, 8);

interface Opcoes {
  /** Os dois primeiros tickets de implementação e a documentação entregue pelo agente (padrão: sim). */
  documentacao?: boolean;
  statusEncerrar?: "aberto" | "em_execucao" | "falhou";
  estado?: "encerrar_rodada" | "implementar";
  instrucao?: string;
  semTicketEncerrar?: boolean;
  /** Um `encerrar_rodada` anterior da rodada que já registrou o PR 1. */
  anterior?: boolean;
  descricao?: string;
}

/** Projeto `loja`, demanda I-206 em execução com a rodada 2 em encerramento, os T3 e T4 commitados e registrados. */
async function cenario({
  documentacao = true,
  statusEncerrar = "em_execucao",
  estado = "encerrar_rodada",
  instrucao,
  semTicketEncerrar = false,
  anterior = false,
  descricao = "d",
}: Opcoes = {}) {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      preparacao: ["true"],
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    rodada_id: 2,
    ...extra,
  });
  const evidencia = (ticket_id: number, tipo: string, dados: object) => ({
    demanda_id: DEMANDA,
    ticket_id,
    tipo,
    autor: { tipo: "agente", trabalho_id: "1" },
    dados,
    em,
  });
  const mensagemPR = {
    titulo: "Encerrar a rodada",
    oQueMudou: "Conduz o encerramento.",
    decisoesNaoObvias: [],
    naoFeito: [],
    comoRevisar: ["Leia o diff."],
    naoVerificado: [],
  };
  gravarAgregadoPronto(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao,
      estado: "em_execucao",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: BRANCH_DEMANDA,
    },
    rodadas: [
      {
        ...REF,
        titulo: "r2",
        estado,
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: BRANCH_RODADA,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido", { titulo: "Primeiro" }),
      ticket(4, "implementar", "concluido", { titulo: "Segundo" }),
      ticket(5, "revisar_rodada", "concluido"),
      ...(anterior ? [ticket(7, "encerrar_rodada", "concluido")] : []),
      ...(semTicketEncerrar ? [] : [ticket(8, "encerrar_rodada", statusEncerrar, instrucao ? { instrucao } : {})]),
    ],
    tentativas: instrucao
      ? [
          {
            ticket: Endereco.doTicket(DEMANDA, 8),
            numero: 1,
            inicio: em,
            fim: em,
            instrucao,
            resultado: { tipo: "interrompida", por: { tipo: "auditor" } },
          },
        ]
      : [],
    pull_requests: anterior
      ? [
          {
            rodada_id: 2,
            numero: 1,
            url: "https://github.com/org/loja/pull/1",
            head: "a".repeat(40),
            estado: "aberto",
            atualizado_em: em,
          },
        ]
      : [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [
      ...(semTicketEncerrar
        ? []
        : documentacao
          ? [evidencia(8, "mensagem_pr", mensagemPR), evidencia(8, "aula_codigo", { resumo: "aula" })]
          : [evidencia(8, "mensagem_pr", mensagemPR)]),
      ...(anterior ? [evidencia(7, "pr_aberto", { id: "1", url: "https://github.com/org/loja/pull/1" })] : []),
    ],
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(ambiente, c.raiz, c.projeto, DEMANDA, c.log);
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, REF, c.log);
  const demanda = join(c.raiz, "worktrees", "loja", DEMANDA, "demanda");
  /** Commita na rodada e, com `ticket`, registra o commit como desse ticket de implementação. */
  const commitarNaRodada = (arquivo: string, ticket?: number) => {
    const sha = commitarArquivo(rodada, arquivo, `${arquivo}\n`);
    if (ticket !== undefined) {
      const mensagem = `feat: ${arquivo} [I-206/T-${String(ticket)}]`;
      gravarCommitDemanda(banco, DEMANDA, ticket, { sha, mensagem, em, arquivos: [] });
    }
    return sha;
  };
  commitarNaRodada("a.txt", 3);
  commitarNaRodada("b.txt", 4);
  const piFalso = instalarPiFalso(c.dir);
  return {
    c,
    banco,
    piFalso,
    rodada,
    demanda,
    commitarNaRodada,
    ag: () => carregarDemanda(banco, DEMANDA),
    ticket: () => carregarDemanda(banco, DEMANDA).tickets.find((t) => t.ticket_id === 8),
    evidencia: (tipo: string) =>
      carregarDemanda(banco, DEMANDA).evidencias.find((e) => e.tipo === tipo && e.ticket_id === 8),
    prompt: () =>
      piFalso
        .prompts()
        .map((entrada) => entrada.prompt)
        .join("\n"),
    noRemoto: (branch: string) => rodarGit(c.bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`),
    estado: () => carregarDemanda(banco, DEMANDA).rodadas[0]?.estado,
  };
}

test("CA-2, CA-7, CA-12 e CA-13: o PR vai da branch da rodada para a da demanda, nunca para a base, e a rodada fica no gate", async () => {
  const { c, banco, ag, ticket, evidencia, noRemoto, rodada } = await cenario();

  await concluirEncerramentoRodada(banco, REF);

  const prs = hospedagem.prs();
  assert.deepEqual(
    prs.map((p) => [p.head, p.base]),
    [[BRANCH_RODADA, BRANCH_DEMANDA]],
  );
  assert.equal(noRemoto(BRANCH_RODADA), rodarGit(rodada, "rev-parse", "HEAD"));
  assert.equal(noRemoto(BRANCH_DEMANDA), rodarGit(c.repo, "rev-parse", BRANCH_DEMANDA));
  assert.equal(ag().rodadas[0]?.estado, "gate_pr");
  assert.equal(ticket()?.estado, "em_execucao");
  const pr = prs[0];
  assert.ok(pr);
  assert.equal(pr.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.ok(pr.corpo.startsWith(MARCA));
  assert.match(pr.corpo, /I-206\.T3/);
  assert.match(pr.corpo, /I-206\.T4/);
  assert.doesNotMatch(`${pr.titulo}\n${pr.corpo}`, /T-\d/);
  assert.deepEqual(evidencia("pr_aberto")?.dados, {
    id: "1",
    url: "https://github.com/org/loja/pull/1",
    branch: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    head: rodarGit(rodada, "rev-parse", "HEAD"),
    corpoCompleto: pr.corpo,
    condensado: false,
  });
  assert.deepEqual(evidencia("pr_aberto")?.autor, { tipo: "fabriquinha" });
  assert.deepEqual(
    ag().pull_requests.map(({ rodada_id, numero, url, head, estado }) => ({ rodada_id, numero, url, head, estado })),
    [
      {
        rodada_id: 2,
        numero: 1,
        url: "https://github.com/org/loja/pull/1",
        head: rodarGit(rodada, "rev-parse", "HEAD"),
        estado: "aberto",
      },
    ],
  );
  assert.deepEqual(evidencia("relatorio_produtividade")?.autor, { tipo: "fabriquinha" });
  // Sem custo medido em nenhum ticket: incompleto, nunca somado como zero (CA-12).
  const relatorio = evidencia("relatorio_produtividade")?.dados as {
    tickets: { ticket: string; custoIncompleto: boolean }[];
    total: { custoIncompleto: boolean };
  };
  assert.deepEqual(
    relatorio.tickets.map((t) => [t.ticket, t.custoIncompleto]),
    [
      ["I-206.T3", true],
      ["I-206.T4", true],
      ["I-206.T5", true],
      ["I-206.T8", true],
    ],
  );
  assert.equal(relatorio.total.custoIncompleto, true);
});

test("CA-3: a ponta nova da demanda entra na rodada antes do PR, e o merge da D04 não barra a publicação", async () => {
  const { banco, demanda, rodada, noRemoto } = await cenario();
  const nova = commitarArquivo(demanda, "da-demanda.txt", "nova\n");

  await concluirEncerramentoRodada(banco, REF);

  rodarGit(rodada, "merge-base", "--is-ancestor", nova, "HEAD");
  assert.equal(noRemoto(BRANCH_RODADA), rodarGit(rodada, "rev-parse", "HEAD"));
  assert.equal(hospedagem.prs().length, 1);
});

test("a base é varrida uma vez antes de publicar o PR, e a falha da varredura só vai ao log", async () => {
  const varrida = await cenario();
  await concluirEncerramentoRodada(varrida.banco, REF);
  assert.equal(
    cursorDaBase(varrida.banco, "loja"),
    rodarGit(varrida.c.repo, "rev-parse", "refs/remotes/origin/integracao"),
  );

  const sem = await cenario();
  sem.banco.exec("DROP TABLE varredura_base"); // a varredura falha ao ler o cursor
  await concluirEncerramentoRodada(sem.banco, REF);
  assert.equal(hospedagem.prs().length, 1);
  assert.match(
    readFileSync(join(sem.c.raiz, "execucoes", "encerramento-I-206.R2.log"), "utf8"),
    /varrerBase falhou: .*varredura_base/,
  );
});

test("CA-4: conflito com a ponta da demanda não publica PR e volta a desenvolvimento com um corretivo para o merge", async () => {
  const { banco, demanda, ag, estado, noRemoto } = await cenario();
  commitarArquivo(demanda, "a.txt", "da demanda\n");
  commitarArquivo(demanda, "b.txt", "da demanda\n");

  await concluirEncerramentoRodada(banco, REF);

  assert.deepEqual(hospedagem.prs(), []);
  assert.equal(noRemoto(BRANCH_RODADA), "");
  assert.equal(estado(), "implementar");
  const corretivos = ag().tickets.filter((t) => t.ticket_id > 8);
  assert.equal(corretivos.length, 1);
  const [corretivo] = corretivos;
  assert.equal(corretivo?.etapa, "implementar");
  assert.deepEqual(
    ag()
      .caminhos_ticket.filter((x) => x.ticket_id === corretivo.ticket_id)
      .map((x) => x.caminho)
      .sort(),
    ["a.txt", "b.txt"],
  );
  assert.equal(ag().tickets.find((t) => t.ticket_id === 8)?.estado, "concluido");
});

test("CA-5 e CA-8: PR da queda adotado pela marca, sem PR novo, com conflito: volta a desenvolvimento e conclui o ticket", async () => {
  const { banco, ag, ticket, evidencia, estado } = await cenario();
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: `${MARCA}\nvelho`,
    estado: "aberto",
    conflito: true,
  });

  await concluirEncerramentoRodada(banco, REF);

  const prs = hospedagem.prs();
  assert.equal(prs.length, 1);
  assert.equal(prs[0]?.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.equal(evidencia("pr_aberto")?.dados.id, "1");
  assert.equal(evidencia("pr_aberto")?.dados.url, "https://github.com/org/loja/pull/1");
  assert.equal(estado(), "implementar");
  assert.equal(ticket()?.estado, "concluido");
  const corretivo = ag().tickets.find((t) => t.ticket_id > 8);
  assert.match(corretivo?.titulo ?? "", /conflito do PR da I-206\.R2/);
  assert.doesNotMatch(corretivo?.descricao ?? "", /T-\d/);
});

test("CA-6: check de CI falho volta a desenvolvimento com uma correção por check, sem chegar ao gate", async () => {
  const { banco, ag, estado } = await cenario();
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: `${MARCA}\nvelho`,
    estado: "aberto",
    checks: [
      { nome: "lint", estado: "falho" },
      { nome: "ci/teste", estado: "falho" },
      { nome: "build", estado: "aprovado" },
    ],
  });

  await concluirEncerramentoRodada(banco, REF);

  assert.equal(estado(), "implementar");
  assert.deepEqual(
    ag()
      .tickets.filter((t) => t.ticket_id > 8)
      .map((t) => t.titulo),
    ["Corrigir o check lint do PR da I-206.R2", "Corrigir o check ci/teste do PR da I-206.R2"],
  );
  assert.match(
    ag().tickets.find((t) => t.titulo === "Corrigir o check lint do PR da I-206.R2")?.descricao ?? "",
    /https:\/\/ci.exemplo.com\/lint/,
  );
});

test("o PR de um encerrar_rodada anterior da rodada é conhecido, mesmo sem a marca do ticket atual", async () => {
  const { banco, estado, ag } = await cenario({ anterior: true });
  hospedagem.abrirPr({
    head: BRANCH_RODADA,
    base: BRANCH_DEMANDA,
    titulo: "velho",
    corpo: "sem marca",
    estado: "aberto",
  });

  await concluirEncerramentoRodada(banco, REF);

  assert.equal(hospedagem.prs().length, 1);
  assert.equal(hospedagem.prs()[0]?.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.equal(estado(), "gate_pr");
  assert.deepEqual(
    ag().pull_requests.map((pr) => [pr.rodada_id, pr.numero]),
    [[2, 1]],
  );
});

test("CA-9: commit que nenhum ticket registrou falha antes do push, diz como desfazer e não cria PR", async () => {
  const { banco, rodada, ticket, evidencia, noRemoto, c } = await cenario();
  const orfao = commitarArquivo(rodada, "fora.txt", "fora\n");

  await assert.rejects(
    concluirEncerramentoRodada(banco, REF),
    (e: unknown) =>
      e instanceof ErroDeRegra &&
      e.message.includes(orfao.slice(0, 12)) &&
      e.message.includes("nenhum ticket de desenvolvimento da I-206.R2 registrou") &&
      e.message.includes(`git -C ${caminhoDaWorktreeRodada(c.raiz, "loja", REF)} reset --hard HEAD~1`),
  );

  assert.equal(noRemoto(BRANCH_RODADA), "");
  assert.deepEqual(hospedagem.prs(), []);
  assert.equal(ticket()?.estado, "falhou");
  assert.equal(evidencia("pr_aberto"), undefined);
});

test("commit da base publicada trazido por merge para a rodada não é órfão", async () => {
  const { banco, rodada, c, estado } = await cenario();
  commitarArquivo(c.repo, "da-base.txt", "base nova\n");
  rodarGit(c.repo, "push", "-q", "origin", "integracao");
  rodarGit(rodada, "fetch", "-q", "origin", "integracao");
  rodarGit(rodada, "merge", "-q", "--no-ff", "--no-edit", "FETCH_HEAD");

  await concluirEncerramentoRodada(banco, REF);

  assert.equal(estado(), "gate_pr");
});

test("CA-10: a hospedagem recusa o PR, o ticket falha com a saída do comando e o pr_aberto não é gravado", async () => {
  const { banco, ticket, evidencia, estado } = await cenario();
  hospedagem.falhar("pr create", "GraphQL: sem permissão");

  await assert.rejects(
    concluirEncerramentoRodada(banco, REF),
    (e: unknown) => e instanceof ErroExterno && e.message.includes("GraphQL: sem permissão"),
  );

  assert.equal(ticket()?.estado, "falhou");
  const ticketFalho = ticket();
  assert.ok(ticketFalho);
  assert.match(
    motivoDaFalhaDoTicket(carregarDemanda(banco, DEMANDA).tentativas, ticketFalho) ?? "",
    /GraphQL: sem permissão/,
  );
  assert.equal(evidencia("pr_aberto"), undefined);
  assert.equal(estado(), "encerrar_rodada");
});

test("CA-11: sem a documentação do agente o domínio recusa a conferência; o ticket segue em execução e nada é publicado", async () => {
  const { banco, ticket, evidencia } = await cenario({ documentacao: false });

  await assert.rejects(
    concluirEncerramentoRodada(banco, REF),
    (e: unknown) => e instanceof ErroDeRegra && e.message.startsWith("a documentação ainda não foi entregue"),
  );

  assert.equal(ticket()?.estado, "em_execucao");
  assert.equal(evidencia("relatorio_produtividade"), undefined);
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("pré-condições: rodada fora de encerramento, rodada ou ticket inexistente e ticket fora de execução recusam sem efeito", async () => {
  const fora = await cenario({ estado: "implementar" });
  await assert.rejects(concluirEncerramentoRodada(fora.banco, REF), /está em implementar e a demanda em em_execucao/);

  const inexistente = await cenario();
  await assert.rejects(
    concluirEncerramentoRodada(inexistente.banco, { ...REF, rodada_id: 9 }),
    /rodada I-206\.R9 não existe/,
  );

  const sem = await cenario({ semTicketEncerrar: true });
  await assert.rejects(concluirEncerramentoRodada(sem.banco, REF), /não tem ticket encerrar_rodada/);

  const aberto = await cenario({ statusEncerrar: "aberto" });
  await assert.rejects(concluirEncerramentoRodada(aberto.banco, REF), /I-206\.T8 está aberto/);
  assert.equal(aberto.ticket()?.estado, "aberto");
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("iniciar: reserva o encerrar_rodada aberto, roda o agente na worktree da rodada e a reabertura leva a instrução", async () => {
  const { banco, ticket, prompt } = await cenario({ statusEncerrar: "aberto", instrucao: "refaça a aula" });

  const { fim } = iniciarEncerramentoRodada(banco, REF, 1);
  await fim;

  assert.equal(ticket()?.estado, "em_execucao");
  const { sessoes, execucoes } = carregarTrabalhosDoTicket(banco, { demanda_id: DEMANDA, ticket_id: 8 });
  assert.equal(sessoes.length, 1);
  assert.equal(execucoes[0]?.falha, false);
  assert.match(prompt(), /refaça a aula/);
});

test("iniciar: com o ticket já em execução só roda o agente de novo, sem instrução", async () => {
  const { banco, ticket, prompt } = await cenario();

  await iniciarEncerramentoRodada(banco, REF, 1).fim;

  assert.equal(ticket()?.estado, "em_execucao");
  assert.doesNotMatch(prompt(), /Reabertura/);
});

test("iniciar: ticket falho não roda", async () => {
  const { banco } = await cenario({ statusEncerrar: "falhou" });
  assert.throws(() => iniciarEncerramentoRodada(banco, REF, 1), /I-206\.T8 está falhou/);
});

test("corpo além do limite da hospedagem: o pi padrão resume a demanda e o custo, e as seções do mensagem_pr ficam inteiras", async () => {
  const { c, banco, evidencia, piFalso } = await cenario({ descricao: `longa${"x".repeat(75)} `.repeat(900) });
  piFalso.roteirizar([{ chamadaUnica: { saida: "Resumo da I-206." } }]);

  await concluirEncerramentoRodada(banco, REF);

  const corpo = hospedagem.prs()[0]?.corpo ?? "";
  assert.ok(corpo.length <= 65_536);
  assert.ok(corpo.startsWith(`${MARCA}\n\n## Contexto (resumido)\n\nResumo da I-206.\n\n## O que mudou`));
  assert.match(corpo, /## Como revisar\n\n1\. Leia o diff\./);
  assert.doesNotMatch(corpo, /longa/);
  const resumo = piFalso
    .registro()
    .filter((entrada) => entrada.evento === "chamada_unica")
    .map((entrada) => entrada.argv?.at(-1))
    .find((prompt) => prompt?.startsWith("Resuma"));
  assert.match(String(resumo), /## Por quê[\s\S]*longa[\s\S]*## Autoria e custo/);
  assert.doesNotMatch(String(resumo), /## Como revisar/);
  assert.equal((evidencia("pr_aberto")?.dados as { condensado: boolean }).condensado, true);
  assert.doesNotMatch(readFileSync(join(c.raiz, "execucoes", "encerramento-I-206.R2.log"), "utf8"), /não resumiu/);
});

test("corpo além do limite e o pi sem resumo: o PR vai sem o contexto, e o log diz por quê", async () => {
  const { c, banco } = await cenario({ descricao: `longa${"x".repeat(75)} `.repeat(900) });

  await concluirEncerramentoRodada(banco, REF);

  const corpo = hospedagem.prs()[0]?.corpo ?? "";
  assert.ok(corpo.startsWith(`${MARCA}\n\n## O que mudou`));
  assert.match(corpo, /## Como revisar\n\n1\. Leia o diff\./);
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "encerramento-I-206.R2.log"), "utf8"),
    /I-206\.R2: o pi não resumiu o contexto do PR em [\d]+ caracteres; vai sem ele/,
  );
});

test("foto do retorno ao agente no encerramento da rodada: reabertura", async () => {
  const { c, banco, piFalso } = await cenario({ statusEncerrar: "aberto", instrucao: "refaça a aula" });
  await iniciarEncerramentoRodada(banco, REF, 1).fim;
  conferirPromptComFoto(piFalso.prompts().at(-1)?.prompt ?? "", c.raiz, "encerramento_rodada_reabertura");
});
