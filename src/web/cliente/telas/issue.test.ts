// Render da página da issue (F7 §4.4, §4.5): funções puras, sem DOM.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evidencia, Ticket } from "../../../dominio/agregado.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { PaginaDaIssue } from "../../rotas/issue.ts";
import {
  acaoDoAuditor,
  caminhoDaIssue,
  custo,
  data,
  duracao,
  estadoDoTrilho,
  evidenciaNaCaixa,
  execucoesDoTicket,
  PAINEIS,
  paginaDaIssue,
} from "./issue.ts";

// As datas saem no fuso do navegador; o teste fixa um.
process.env.TZ = "America/Sao_Paulo";

const AGORA = "2026-10-11T12:00:00.000Z";
const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";
const CONSULTA = "1c8d6b63-4f1f-4d2f-8e4b-7a2a3c0f9b21";
const XSS = `<img src=x onerror="alert(1)">`;
const sha = (c: string) => c.repeat(64);

const ticket = (id: number, etapa: Ticket["etapa"], status: Ticket["status"], titulo = `T${String(id)}`): Ticket => ({
  id,
  issue: 1,
  etapa,
  titulo,
  descricao: "",
  status,
  origem: "fabriquinha",
  criadoEm: AGORA,
});

const evidencia = (
  id: number,
  tickete: number,
  tipo: Evidencia["tipo"],
  resto: Partial<Evidencia> = {},
): Evidencia => ({
  id,
  ticket: tickete,
  tipo,
  produtor: "agente",
  dados: {},
  arquivos: [],
  em: AGORA,
  ...resto,
});

const sessao = (s: Partial<InfoSessao>): InfoSessao => ({
  sessao: SESSAO,
  issue: 1,
  projeto: "loja",
  ticket: 2,
  etapa: "desenho",
  modo: "autonomo",
  execucao: 2,
  estado: "terminada",
  desde: AGORA,
  dialogos: [],
  ...s,
});

const comando = (c: Record<string, unknown>) => ({ codigoSaida: 0, estourou: false, duracaoMs: 48_000, ...c });

function ticketDe(p: PaginaDaIssue, id: number): Ticket {
  const t = p.tickets.find((x) => x.id === id);
  assert.ok(t);
  return t;
}

function exemplo(): PaginaDaIssue {
  return {
    issue: {
      id: 1,
      projeto: "loja",
      titulo: `Busca ${XSS}`,
      tipo: "funcionalidade",
      descricao: "**x**",
      fase: "desenvolvimento",
      deps: [2],
      criadaEm: AGORA,
    },
    tickets: [
      ticket(1, "registro", "concluido"),
      ticket(2, "desenho", "concluido"),
      ticket(3, "desenvolvimento", "aberto", `Cache ${XSS}`),
      ticket(4, "revisao", "falhou"),
    ],
    execucoes: [
      {
        id: 1,
        ticket: 2,
        modo: "autonomo",
        sessaoPi: SESSAO,
        resultado: "falha",
        erro: `tempo limite ${XSS}`,
        iniciadaEm: AGORA,
        terminadaEm: "2026-10-11T12:30:00.000Z",
      },
      {
        id: 2,
        ticket: 2,
        modo: "autonomo",
        sessaoPi: SESSAO,
        resultado: "sucesso",
        iniciadaEm: AGORA,
        terminadaEm: "2026-10-11T12:22:05.000Z",
      },
      { id: 3, ticket: 2, modo: "consulta", sessaoPi: CONSULTA, resultado: "em_andamento", iniciadaEm: AGORA },
    ],
    decisoes: [],
    evidencias: [
      evidencia(1, 1, "criterios_aceite", {
        dados: { criterios: [{ id: "CA-1", dado: XSS, quando: "abre", entao: "vê" }] },
      }),
      evidencia(2, 1, "comportamento", {
        dados: { descricao: "d", comoReproduzir: ["a"] },
        arquivos: [
          { nome: "atual.webm", sha256: sha("a"), mime: "video/webm", bytes: 10 },
          { nome: "passos.txt", sha256: sha("b"), mime: "text/plain; charset=utf-8", bytes: 10 },
        ],
      }),
      evidencia(3, 2, "desenho_solucao", {
        dados: {},
        arquivos: [{ nome: "desenho.html", sha256: sha("c"), mime: "text/html; charset=utf-8", bytes: 10 }],
      }),
      evidencia(4, 2, "prototipo", {
        dados: { descricao: "p" },
        arquivos: [{ nome: "tela.png", sha256: sha("d"), mime: "image/png", bytes: 10 }],
      }),
      evidencia(5, 2, "relatorio_complexidade", {
        dados: {
          variaveis: [],
          fluxos: [
            { nome: "Montar", situacao: "novo", depois: { tempo: "O(n)", espaco: "O(1)" } },
            {
              nome: "Listar",
              situacao: "alterado",
              antes: { tempo: "O(n^2)", espaco: "O(n)" },
              depois: { tempo: "O(n)", espaco: "O(n)" },
            },
          ],
        },
        arquivos: [{ nome: "etapas.html", sha256: sha("e"), mime: "text/html; charset=utf-8", bytes: 10 }],
      }),
    ],
    projeto: {
      nome: "loja",
      repo: "/repo",
      branchBase: "main",
      hospedagem: "github",
      preparacao: [],
      testes: ["npm test"],
      sonar: { projectKey: "loja" },
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      modelos: {},
    },
    dependencias: [{ id: 2, projeto: "base", fase: "aprovacao_pr" }],
    sessoes: [sessao({}), sessao({ sessao: CONSULTA, modo: "consulta", execucao: 3, estado: "rodando" })],
    custos: { 2: 1.861 },
    limpeza: [],
  };
}

test("formatos: data no fuso do navegador, duração e custo", () => {
  assert.equal(data(AGORA), "11/10 09:00");
  assert.deepEqual([0, 48_400, 60_000, 130_000, 3_600_000, 4_800_000].map(duracao), [
    "0 s",
    "48 s",
    "1 min",
    "2 min 10 s",
    "1 h",
    "1 h 20 min",
  ]);
  assert.equal(custo(0.5), "US$ 0,50");
  assert.equal(caminhoDaIssue("loja", 7), "/projects/loja/issues/I-7");
});

test("trilho: a falha antes de quem aguarda, e quem aguarda antes do que roda", () => {
  const rodando = sessao({ estado: "rodando" });
  const aguarda = sessao({ estado: "aguardando_humano", motivo: "gate_desenho" });
  const falha = sessao({ estado: "aguardando_humano", motivo: "falha" });
  assert.equal(estadoDoTrilho([]), undefined);
  assert.equal(estadoDoTrilho([rodando]), "rodando");
  assert.equal(estadoDoTrilho([rodando, aguarda]), "aguarda");
  assert.equal(estadoDoTrilho([aguarda, falha]), "falha");
});

test("página: caminho, título, trilho, detalhes, descrição, tickets com sessões e artefatos, tudo escapado", () => {
  const html = paginaDaIssue(exemplo(), "<p><strong>x</strong></p>");
  assert.doesNotMatch(html, /<img src=x/, "texto do agente nunca vira HTML");
  assert.match(html, /<a href="\/projects">Projetos<\/a> › <a href="\/projects\/loja">loja<\/a> › I-1<\/nav>/);
  assert.match(html, /<h1 class="titulo-issue"><span class="id">I-1<\/span>Busca &#60;img/);
  assert.match(html, /<ol class="trilho-fases rodando"/, "a consulta roda; a sessão terminada não conta");
  assert.match(html, /<dt>Tipo<\/dt><dd><span class="tag">funcionalidade<\/span>/);
  assert.match(html, /<dt>Criada<\/dt><dd>11\/10 09:00<\/dd>/);
  assert.doesNotMatch(html, /<dt>PR<\/dt>/);
  assert.match(
    html,
    /<span class="dep"><a href="\/projects\/base\/issues\/I-2">I-2<\/a><span class="fase">aprovação do PR<\/span><button [^>]*data-remover-dep="2"/,
  );
  assert.match(html, /data-acao="mostrar-dep">\+ adicionar/);
  assert.match(html, /<div class="md descricao" data-descricao><p><strong>x<\/strong><\/p><\/div>/);
  assert.match(html, /data-acao="ver-descricao">ver tudo/);

  // Tickets em ordem de criação, com a sessão principal antes da consulta.
  assert.deepEqual(
    [...html.matchAll(/data-ticket="(\d+)"/g)].map((m) => m[1]),
    ["1", "2", "3", "4"],
  );
  assert.match(html, /<li class="falhou">[\s\S]*?<span>revisão<\/span><span class="pill st-falhou">falhou<\/span>/);
  assert.match(
    html,
    new RegExp(
      `<a class="chat" href="/sessions/${SESSAO}"><span class="pill pill-neutro">autônoma</span><span class="ir">chat →</span></a><a class="chat" href="/sessions/${CONSULTA}"><span class="pill pill-rodando">rodando</span>`,
    ),
  );

  // Artefatos do ticket mais recente ao mais antigo; a classe do card e o ponto de aprovada.
  assert.deepEqual(
    [...html.matchAll(/<div class="etapa-nome">(\w+)<span class="id">(T-\d)<\/span>/g)].map(
      (m) => `${String(m[1])} ${String(m[2])}`,
    ),
    ["Desenho T-2", "Registro T-1"],
  );
  assert.deepEqual(
    [...html.matchAll(/data-evidencia="(\d)"><span class="tipo">([^<]+)<\/span>([^<]+)/g)].map((m) =>
      m.slice(1).join(" "),
    ),
    [
      "3 HTML Desenho da solução",
      "4 IMG Protótipo",
      "5 TABELA Complexidade",
      "1 TABELA Critérios de aceite",
      "2 VÍDEO Comportamento",
    ],
  );
  assert.doesNotMatch(html, /class="ponto/);
  assert.doesNotMatch(html, /acao-auditor/, "sem ação, a coluna da direita só tem os artefatos");
});

test("página: sem título, tipo, descrição, dependência e artefato; issue concluída não muda dependências", () => {
  const p = exemplo();
  const vazia: PaginaDaIssue = {
    ...p,
    issue: { ...p.issue, titulo: null, tipo: null, fase: "concluida", deps: [] },
    dependencias: [],
    evidencias: [],
    sessoes: [],
  };
  const html = paginaDaIssue(vazia, "");
  assert.match(html, /<span class="id">I-1<\/span><span class="muted">sem título<\/span>/);
  assert.match(html, /<dt>Tipo<\/dt><dd><span class="muted">—<\/span>/);
  assert.match(html, /<dt>Dependências<\/dt><dd><span class="muted">—<\/span>/);
  assert.doesNotMatch(html, /adicionar|data-form-dep/);
  assert.match(html, /<p class="muted vazio">Sem descrição.<\/p>/);
  assert.match(html, /<p class="muted">Nenhum artefato ainda.<\/p>/);
  assert.match(html, /<ol class="trilho-fases" /);

  const comDep = paginaDaIssue({ ...vazia, dependencias: [{ id: 2, projeto: "loja", fase: "concluida" }] }, "");
  assert.match(comDep, /<span class="fase">concluída<\/span><\/span>/, "sem o × de remover");
});

test("PR, aprovada e reprovada nos cards", () => {
  const p = exemplo();
  const html = paginaDaIssue(
    {
      ...p,
      evidencias: [
        evidencia(9, 4, "pr_aberto", {
          produtor: "fabriquinha",
          dados: { id: "212", url: "https://github.com/o/r/pull/212" },
        }),
        evidencia(10, 4, "execucao_testes", { aprovada: true, dados: { comandos: [] } }),
        evidencia(11, 4, "comprovacao_criterios", { aprovada: false, dados: { criterios: [] } }),
        evidencia(12, 4, "mensagem_pr", { dados: { titulo: "t" } }),
        evidencia(13, 4, "explicacao_fitness", { dados: { explicacoes: [] } }),
      ],
    },
    "",
  );
  assert.match(
    html,
    /<dt>PR<\/dt><dd><a class="pr" href="https:\/\/github.com\/o\/r\/pull\/212" target="_blank"[^>]*>#212 ↗/,
  );
  assert.match(html, /Testes<span class="ponto ok" title="aprovada">/);
  assert.match(html, /Comprovação dos critérios<span class="ponto nok" title="reprovada">/);
  assert.match(html, /<span class="tipo">JSON<\/span>PR aberto/);
  assert.match(html, /<span class="tipo">JSON<\/span>Mensagem do PR/);
  assert.doesNotMatch(html, /Explicação das fitness/, "entra na tabela da matriz_fitness");
});

test("Ação do Auditor: Executar agora habilitado, desabilitado com o motivo do D8, e o aviso da limpeza", () => {
  const p = exemplo();
  const t3 = ticketDe(p, 3);
  assert.equal(acaoDoAuditor(p), "");
  const livre = acaoDoAuditor({ ...p, executar: { ticket: t3 } });
  assert.match(livre, /^<div class="acao-auditor" aria-label="Ação do Auditor" role="region">/);
  assert.match(livre, /<span class="mono">T-3<\/span> · Cache &#60;img[^<]* · desenvolvimento/);
  assert.match(
    livre,
    /<button type="button" class="btn btn-primario" data-acao="executar" data-executar="3">Executar agora/,
  );
  assert.doesNotMatch(livre, /bloqueio/);

  const motivo = "já há uma execução autônoma em andamento (D8): E-9 de T-4";
  const ocupada = acaoDoAuditor({ ...p, executar: { ticket: t3, ocupada: motivo } });
  assert.match(ocupada, new RegExp(`data-executar="3" disabled title="${motivo.replace(/[()]/g, "\\$&")}">`));
  assert.match(ocupada, /<p class="bloqueio">já há uma execução/);

  const limpeza = acaoDoAuditor({
    ...p,
    limpeza: ["git -C /repo worktree remove --force /w/I-1", "git -C /repo worktree prune"],
  });
  assert.match(limpeza, /<section class="painel-acao falhou" role="status">/);
  assert.match(
    limpeza,
    /<pre class="comandos">git -C \/repo worktree remove --force \/w\/I-1\ngit -C \/repo worktree prune<\/pre>/,
  );

  // O ponto de extensão dos painéis de gate: um painel novo entra na mesma coluna.
  PAINEIS.unshift(() => "<section>gate</section>");
  try {
    assert.match(paginaDaIssue(p, ""), /<div class="acao-auditor"[^>]*><section>gate<\/section><\/div>/);
  } finally {
    PAINEIS.shift();
  }
});

test("caixa do ticket: as execuções com modo, resultado, início, duração, custo, erro, log e prompt", () => {
  const p = exemplo();
  const caixa = execucoesDoTicket(p, ticketDe(p, 2));
  assert.equal(caixa.titulo, "T-2 · T2");
  assert.equal(caixa.meta, "desenho · concluído");
  const linhas = [...caixa.corpo.matchAll(/<tr><td class="mono">(E-\d)<\/td>(.*?)<\/tr>/g)];
  assert.deepEqual(
    linhas.map((m) => m[1]),
    ["E-1", "E-2", "E-3"],
  );
  assert.match(
    String(linhas[0]?.[2]),
    /<td>autônomo<\/td><td class="nok">falha<\/td><td>11\/10 09:00<\/td><td class="num">30 min<\/td><td class="num">—<\/td><td>tempo limite &#60;img/,
  );
  assert.match(
    String(linhas[1]?.[2]),
    /<td class="">sucesso<\/td>.*<td class="num">22 min 5 s<\/td><td class="num">US\$ 1,86<\/td>/,
  );
  assert.match(String(linhas[2]?.[2]), /<td>consulta<\/td><td class="">em andamento<\/td>.*<td class="num">—<\/td>/);
  assert.match(
    caixa.corpo,
    /href="\/api\/execucoes\/1\/log" target="_blank" rel="noopener">log<\/a> · <a class="link" href="\/api\/execucoes\/1\/prompt"/,
  );

  const sem = execucoesDoTicket(p, ticketDe(p, 3));
  assert.equal(sem.corpo, '<p class="muted">Ainda sem execução.</p>');
});

function evidenciaDe(p: PaginaDaIssue, id: number): Evidencia {
  const e = p.evidencias.find((x) => x.id === id);
  assert.ok(e);
  return e;
}

test("caixa da evidência: HTML em iframe sandbox, imagem, vídeo e texto, com abrir em nova aba e baixar", () => {
  const p = exemplo();
  const html = evidenciaNaCaixa(p, evidenciaDe(p, 3));
  assert.equal(html.titulo, "Desenho da solução");
  assert.equal(html.meta, "desenho_solucao · desenho · T-2");
  assert.equal(
    html.corpo,
    `<div class="evidencia"><iframe sandbox="allow-scripts" src="/arquivos/${sha("c")}" title="desenho.html"></iframe></div>`,
  );
  assert.deepEqual([html.aba, html.baixar], [`/arquivos/${sha("c")}`, `/arquivos/${sha("c")}?baixar`]);

  const img = evidenciaNaCaixa(p, evidenciaDe(p, 4));
  assert.match(
    img.corpo,
    new RegExp(
      `^<div class="evidencia"><img src="/arquivos/${sha("d")}" alt="tela.png" /><pre class="json">\\{\n  &#34;descricao&#34;: &#34;p&#34;\n\\}</pre></div>$`,
    ),
  );

  // Mais de um anexo: cada um com os seus links, e nada no cabeçalho.
  const varios = evidenciaNaCaixa(p, evidenciaDe(p, 2));
  assert.equal(varios.aba, undefined);
  assert.match(
    varios.corpo,
    new RegExp(
      `<figcaption><span class="mono">atual.webm</span><a class="link" href="/arquivos/${sha("a")}" target="_blank" rel="noopener">abrir em nova aba ↗</a><a class="link" href="/arquivos/${sha("a")}\\?baixar" download>baixar</a></figcaption><video controls preload="metadata" src="/arquivos/${sha("a")}" aria-label="atual.webm"></video>`,
    ),
  );
  assert.match(varios.corpo, new RegExp(`<pre data-texto="/arquivos/${sha("b")}">carregando…</pre>`));

  const semNada = evidenciaNaCaixa(p, evidencia(20, 99, "mensagem_pr"));
  assert.deepEqual([semNada.meta, semNada.corpo], ["mensagem_pr · T-99", '<div class="evidencia"></div>']);
});

test("caixa da evidência: as tabelas dos tipos de gate, com o HTML abaixo e os anexos citados como links", () => {
  const p = exemplo();
  const criterios = evidenciaNaCaixa(p, evidenciaDe(p, 1));
  assert.match(criterios.corpo, /<th>ID<\/th><th>Dado<\/th><th>Quando<\/th><th>Então<\/th>/);
  assert.match(criterios.corpo, /<td class="mono">CA-1<\/td><td>&#60;img src=x[^<]*<\/td><td>abre<\/td><td>vê<\/td>/);

  const complexidade = evidenciaNaCaixa(p, evidenciaDe(p, 5));
  assert.match(
    complexidade.corpo,
    /<td>Montar<\/td><td>novo<\/td><td class="bigo muted">—<\/td><td class="bigo">O\(n\) · O\(1\)<\/td>/,
  );
  assert.match(complexidade.corpo, /<td class="bigo">O\(n\^2\) · O\(n\)<\/td>/);
  assert.match(
    complexidade.corpo,
    /<\/table><\/div><iframe sandbox="allow-scripts" src="\/arquivos\/e{64}"/,
    "a tabela antes do HTML",
  );
  assert.equal(complexidade.aba, `/arquivos/${sha("e")}`);

  const log = { nome: "npm-test.log", sha256: sha("f"), mime: "text/plain; charset=utf-8", bytes: 1 };
  const print = { nome: "ca1.png", sha256: sha("9"), mime: "image/png", bytes: 1 };
  const outros: PaginaDaIssue = {
    ...p,
    evidencias: [
      evidencia(30, 3, "execucao_testes", {
        aprovada: false,
        arquivos: [log],
        dados: {
          comandos: [
            comando({ comando: "npm test", log: "npm-test.log" }),
            comando({ comando: "npm run e2e", codigoSaida: 1, duracaoMs: 130_000, log: "sumiu.log" }),
            comando({ comando: "npm run lento", codigoSaida: null, estourou: true, log: "x" }),
          ],
        },
      }),
      evidencia(31, 3, "matriz_fitness", {
        aprovada: true,
        arquivos: [log],
        dados: {
          linhas: [comando({ nome: "cobertura", log: "npm-test.log" }), comando({ nome: "sem-segredo", log: "x" })],
        },
      }),
      evidencia(32, 3, "explicacao_fitness", { dados: { explicacoes: [{ nome: "cobertura", explicacao: "92%" }] } }),
      evidencia(33, 4, "explicacao_fitness", {
        dados: { explicacoes: [{ nome: "sem-segredo", explicacao: "de outro ticket" }] },
      }),
      evidencia(34, 3, "relatorio_sonar", { dados: { arquivosAnalisados: ["a", "b"], issues: [] } }),
      evidencia(35, 3, "relatorio_sonar", {
        dados: {
          arquivosAnalisados: ["a"],
          issues: [
            { arquivo: "a.ts", linha: 3, regra: "ts:S1", severidade: "MAJOR", mensagem: XSS },
            { arquivo: "b.ts", regra: "ts:S2", severidade: "MINOR", mensagem: "m" },
          ],
        },
      }),
      evidencia(36, 4, "arquivos_alterados", {
        dados: {
          arquivos: [
            { caminho: "src/a.ts", status: "M", adicionadas: 12, removidas: 3, previsto: "src/*.ts" },
            { caminho: "src/config.ts", status: "A", adicionadas: 4, removidas: 0, previsto: null },
            { caminho: "logo.png", status: "A", adicionadas: null, removidas: null, previsto: null },
          ],
        },
      }),
      evidencia(37, 4, "mensagem_pr", {
        dados: { naoPrevistos: [{ caminho: "src/config.ts", motivo: "chave do HMAC" }] },
      }),
      evidencia(38, 4, "comprovacao_criterios", {
        aprovada: true,
        arquivos: [print],
        dados: {
          criterios: [
            { id: "CA-1", atendido: true, comoVerificado: "teste", arquivos: ["ca1.png", "x.mp4"] },
            { id: "CA-2", atendido: false, comoVerificado: "não deu", arquivos: [] },
          ],
        },
      }),
    ],
  };
  const testes = evidenciaNaCaixa(outros, evidenciaDe(outros, 30));
  assert.match(
    testes.corpo,
    /^<div class="evidencia"><p class="marca-aprovada"><span class="pill pill-falha">reprovada<\/span><\/p>/,
  );
  assert.match(
    testes.corpo,
    new RegExp(
      `<td class="mono">npm test</td><td class="ok">✓ passou</td><td class="num">48 s</td><td><a class="link" href="/arquivos/${sha("f")}" target="_blank" rel="noopener">npm-test.log</a></td>`,
    ),
  );
  assert.match(
    testes.corpo,
    /<td class="nok">✗ reprovou \(código 1\)<\/td><td class="num">2 min 10 s<\/td><td>sumiu.log<\/td>/,
  );
  assert.match(testes.corpo, /<td class="nok">✗ estourou o tempo<\/td>/);
  assert.doesNotMatch(testes.corpo, /<pre data-texto/, "o log fica no link da tabela");
  assert.equal(testes.aba, undefined);

  const fitness = evidenciaNaCaixa(outros, evidenciaDe(outros, 31));
  assert.match(fitness.corpo, /<span class="pill pill-ok">aprovada<\/span>/);
  assert.match(
    fitness.corpo,
    /<th>Fitness function<\/th><th>Resultado<\/th><th class="num">Duração<\/th><th>Explicação do agente<\/th><th>Log<\/th>/,
  );
  assert.match(
    fitness.corpo,
    /<td class="mono">cobertura<\/td><td class="ok">✓ passou<\/td><td class="num">48 s<\/td><td>92%<\/td>/,
  );
  assert.match(
    fitness.corpo,
    /<td class="mono">sem-segredo<\/td>.*?<td>—<\/td>/,
    "a explicação de outro ticket não entra",
  );

  const sonar = evidenciaNaCaixa(outros, evidenciaDe(outros, 34));
  assert.match(sonar.corpo, /<td class="num">2<\/td><td class="num ok">0<\/td>/);
  assert.equal(sonar.corpo.match(/<table/g)?.length, 1);
  const comIssues = evidenciaNaCaixa(outros, evidenciaDe(outros, 35));
  assert.match(comIssues.corpo, /<td class="num nok">2<\/td>/);
  assert.match(comIssues.corpo, /<td class="mono">a.ts:3<\/td><td class="mono">ts:S1<\/td><td>MAJOR<\/td><td>&#60;img/);
  assert.match(comIssues.corpo, /<td class="mono">b.ts<\/td>/);

  const alterados = evidenciaNaCaixa(outros, evidenciaDe(outros, 36));
  assert.match(
    alterados.corpo,
    /<td class="mono">src\/a.ts<\/td><td>M<\/td><td class="num"><span class="ok">\+12<\/span> <span class="nok">−3<\/span><\/td><td class="mono">src\/\*.ts<\/td>/,
  );
  assert.match(alterados.corpo, /<td class="nao-previsto">não previsto: chave do HMAC<\/td>/);
  assert.match(alterados.corpo, /<td class="num">binário<\/td><td class="nao-previsto">não previsto<\/td>/);

  const comprovacao = evidenciaNaCaixa(outros, evidenciaDe(outros, 38));
  assert.match(
    comprovacao.corpo,
    /<td class="mono">CA-1<\/td><td class="ok">✓ sim<\/td><td>teste<\/td><td><a class="link" href="\/arquivos\/9{64}"[^>]*>ca1.png<\/a>, x.mp4<\/td>/,
  );
  assert.match(comprovacao.corpo, /<td class="nok">✗ não<\/td><td>não deu<\/td><td><\/td>/);
  assert.doesNotMatch(comprovacao.corpo, /<img/, "o print fica no link da tabela");
});

test("tickets: a sessão que aguarda mostra o motivo, e a falha em vermelho", () => {
  const p = exemplo();
  const html = paginaDaIssue(
    {
      ...p,
      sessoes: [
        sessao({ estado: "aguardando_humano", motivo: "gate_desenho" }),
        sessao({ sessao: CONSULTA, ticket: 4, etapa: "revisao", estado: "aguardando_humano", motivo: "falha" }),
      ],
    },
    "",
  );
  assert.match(html, /<span class="pill pill-aguarda">Gate do desenho<\/span><span class="ir">chat →<\/span>/);
  assert.match(html, /<span class="pill pill-falha">Falha<\/span>/);
  assert.match(html, /<ol class="trilho-fases falha"/);
});
