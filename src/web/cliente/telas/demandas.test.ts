import assert from "node:assert/strict";
import { test } from "node:test";
import { type DadosDaPagina, type DemandaDoQuadro, pagina, quadro } from "./demandas.ts";

const demanda = (id: string, resto: Partial<DemandaDoQuadro> = {}): DemandaDoQuadro => ({
  id,
  projeto: "loja",
  titulo: `Demanda ${id}`,
  fase: "execucao",
  rodadas: [],
  bloqueios: [],
  falhos: [],
  ...resto,
});

test("sem trabalho nem demandas, o quadro diz que não há nada em vez de ficar vazio (CA-7)", () => {
  const html = quadro({ demandas: [], trabalho: [] });
  assert.match(html, /Não há trabalho em andamento\./);
  assert.match(html, /Nenhuma demanda em andamento\./);
});

test("o trabalho ativo traz o ticket, a etapa e a rodada, quando há (CA-6)", () => {
  const html = quadro({
    demandas: [],
    trabalho: [
      { ref: "I-206.T3", etapa: "implementar", rodada: "I-206.R2" },
      { ref: "I-206.T5", etapa: "planejar" },
    ],
  });
  assert.match(html, /I-206\.T3<\/span> Implementação · rodada <span class="id">I-206\.R2/);
  assert.match(html, /I-206\.T5<\/span> Planejamento<\/li>/);
});

test("o cartão traz o título, a fase, as rodadas e o link do PR só na rodada que tem PR (CA-1, CA-2)", () => {
  const html = quadro({
    demandas: [
      demanda("I-206", {
        rodadas: [
          { ref: "I-206.R1", fase: "aprovacao_pull_request", pr: { id: "7", url: "https://pr/7?a=1&b=2" } },
          { ref: "I-206.R2", fase: "desenvolvimento" },
        ],
      }),
    ],
    trabalho: [],
  });
  assert.match(html, /Demanda I-206<\/h3>/);
  assert.match(html, /Execução/);
  assert.match(
    html,
    /I-206\.R1<\/span> <span class="pill pill-aguarda">Aprovação do PR<\/span> <a [^>]*href="https:\/\/pr\/7\?a=1&#38;b=2" target="_blank" rel="noopener">/,
  );
  assert.match(html, /I-206\.R2<\/span> <span class="pill pill-rodando">Desenvolvimento<\/span><\/li>/);
  assert.equal(html.match(/target="_blank"/g)?.length, 1);
  assert.match(html, /aguarda a decisão do Auditor/);
  assert.match(html, /href="\/demandas\/I-206">abrir a demanda →/);
});

test("as marcas: gate da demanda, ticket falho e bloqueio com título e fase (CA-3 a CA-5)", () => {
  const html = quadro({
    demandas: [
      demanda("I-206"),
      demanda("I-207", {
        falhos: [{ ref: "I-207.T1", etapa: "implementar" }],
        bloqueios: [
          { demanda_id: "I-206", fase: "execucao" },
          { demanda_id: "I-300", fase: "planejamento" },
        ],
      }),
      demanda("I-208", { fase: "aprovacao_demanda" }),
      demanda("I-209", { fase: "aprovacao_planejamento" }),
    ],
    trabalho: [],
  });
  assert.match(html, /ticket falho I-207\.T1/);
  assert.match(html, /aguarda I-206 · Demanda I-206 · Execução/);
  assert.match(html, /aguarda I-300 · Planejamento</);
  assert.equal(html.match(/aguarda a decisão do Auditor/g)?.length, 2);
  assert.equal(html.match(/class="cartao dm-cartao aguarda"/g)?.length, 2);
});

test("o texto do servidor é escapado", () => {
  const html = quadro({ demandas: [demanda("I-1", { titulo: "<img onerror=x>" })], trabalho: [] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&#60;img onerror=x&#62;/);
});

const dadosDaPagina = (resto: Partial<DadosDaPagina> = {}): DadosDaPagina => ({
  demanda: { id: "I-206", projeto: "loja", titulo: "Demanda <I-206>", fase: "execucao" },
  rodadas: [],
  tickets: [],
  decisoes: [],
  evidencias: [],
  encerramento: { passos: [], limpeza_pendente: [] },
  dependencias: [],
  dependentes: [],
  ...resto,
});

test("a página vazia traz só o cabeçalho e o link ao quadro, sem seções vazias", () => {
  const html = pagina(dadosDaPagina());
  assert.match(html, /href="\/demandas">← Demandas/);
  assert.match(html, /<h1>Demanda &#60;I-206&#62;<\/h1>/);
  assert.doesNotMatch(html, /Dependências|Tickets globais|Evidências|Encerramento final|Aprovação d/);
});

test("os tickets ficam na rodada ou nos globais, pelo endereço público, com decisão, motivo e nota (CA-8, CA-9, CA-11)", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [
        { ref: "I-206.R1", titulo: "Primeira", fase: "aprovacao_pull_request" },
        { ref: "I-206.R2", titulo: "Segunda", fase: "sessao" },
      ],
      tickets: [
        {
          ref: "I-206.T1",
          etapa: "implementar",
          status: "falhou",
          rodada: "I-206.R1",
          titulo: "T",
          instrucao: "refaça",
          motivo_falha: "quebrou",
        },
        { ref: "I-206.T2", etapa: "encerrar_rodada", status: "concluido", rodada: "I-206.R1" },
        { ref: "I-206.T3", etapa: "implementar", status: "em_execucao", rodada: "I-206.R2" },
        { ref: "I-206.T4", etapa: "planejar", status: "aberto" },
      ],
      decisoes: [
        { ticket: "I-206.T1", resultado: "recusado", motivo: "falta teste do caminho de erro", por: "agente" },
        { ticket: "I-206.T2", resultado: "recusado", motivo: "x", por: "auditor" },
        { ticket: "I-206.T2", resultado: "aprovado", nota: 4, por: "auditor" },
      ],
      evidencias: [{ tipo: "pr_aberto", ticket: "I-206.T2", dados: { id: "7", url: "https://pr/7" }, anexos: [] }],
    }),
  );
  const [, , r1, r2, globais] = html.split(/(?=<section)/);
  assert.match(r1 ?? "", /id="I-206\.R1"[\s\S]*I-206\.T1[\s\S]*Implementação[\s\S]*Falhou/);
  assert.match(r1 ?? "", /Motivo da falha:<\/strong> quebrou/);
  assert.match(r1 ?? "", /Instrução:<\/strong> refaça/);
  assert.match(r1 ?? "", /Recusado<\/strong> por agente: falta teste do caminho de erro/);
  assert.match(r1 ?? "", /nota 4/);
  assert.match(r1 ?? "", /Aprovação do PR/);
  assert.match(r1 ?? "", /href="https:\/\/pr\/7" target="_blank" rel="noopener">PR #7/);
  assert.doesNotMatch(r1 ?? "", /I-206\.T3|I-206\.T4/);
  assert.match(r2 ?? "", /I-206\.T3[\s\S]*Em execução/);
  assert.match(r2 ?? "", /Sessão de ajustes/);
  assert.doesNotMatch(r2 ?? "", /nota|PR #/);
  assert.match(globais ?? "", /Tickets globais[\s\S]*I-206\.T4[\s\S]*Aberto/);
});

test("rodada sem ticket e PR com endereço que não é http não viram link", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [{ ref: "I-206.R1", titulo: "R", fase: "revisao" }],
      tickets: [{ ref: "I-206.T1", etapa: "encerrar_rodada", status: "concluido", rodada: "I-206.R1" }],
      evidencias: [{ tipo: "pr_aberto", ticket: "I-206.T1", dados: { id: "7", url: "javascript:x" }, anexos: [] }],
    }),
  );
  assert.doesNotMatch(html, /javascript:x" /);
  assert.match(html, /PR #7/);
  assert.match(
    pagina(dadosDaPagina({ rodadas: [{ ref: "I-206.R1", titulo: "R", fase: "revisao" }] })),
    /Sem tickets\./,
  );
});

test("as dependências trazem o link e a fase da predecessora (CA-13)", () => {
  const html = pagina(dadosDaPagina({ dependencias: [{ demanda_id: "I-205", fase: "execucao" }] }));
  assert.match(html, /Dependências[\s\S]*href="\/demandas\/I-205">I-205<\/a> <span class="pill pill-rodando">Execução/);
});

test("a evidência traz o tipo legível, o dono, os anexos (imagem marcada) e os dados em details (CA-10)", () => {
  const html = pagina(
    dadosDaPagina({
      evidencias: [
        {
          tipo: "comportamento",
          ticket: "I-206.T1",
          dados: { a: "<b>" },
          anexos: [
            { nome: "print.png", classe: "imagem", link: "/api/x?a=1&b=2" },
            { nome: "log.txt", classe: "texto", link: "/api/y" },
          ],
        },
        { tipo: "revisao_integral", rodada: "I-206.R1", dados: {}, anexos: [] },
        { tipo: "custos_realizados", dados: {}, anexos: [] },
      ],
    }),
  );
  assert.match(html, /<strong>Comportamento<\/strong> <span class="id">I-206\.T1/);
  assert.match(html, /href="\/api\/x\?a=1&#38;b=2" target="_blank" rel="noopener" data-imagem="print\.png">print\.png/);
  assert.match(html, /href="\/api\/y" target="_blank" rel="noopener">log\.txt/);
  assert.equal(html.match(/data-imagem/g)?.length, 1);
  assert.match(
    html,
    /<details><summary>dados<\/summary><pre class="dm-dados">\{\n {2}&#34;a&#34;: &#34;&#60;b&#62;&#34;\n\}/,
  );
  assert.match(html, /Revisão integral<\/strong> <span class="id">I-206\.R1/);
  assert.match(html, /custos realizados<\/strong> <span class="id">demanda/);
});

const passos = (verificacao: boolean, pr: boolean, integracao: boolean): DadosDaPagina["encerramento"]["passos"] => [
  { passo: "verificacao", feito: verificacao },
  { passo: "pr", feito: pr },
  { passo: "integracao", feito: integracao },
];

test("o encerramento só aparece com progresso, passo a passo", () => {
  assert.doesNotMatch(
    pagina(dadosDaPagina({ encerramento: { passos: passos(false, false, false), limpeza_pendente: [] } })),
    /Encerramento final/,
  );
  assert.match(
    pagina(dadosDaPagina({ encerramento: { passos: passos(false, true, false), limpeza_pendente: [] } })),
    /Verificação<\/strong> <span class="pill pill-neutro">Pendente/,
  );
  const html = pagina(dadosDaPagina({ encerramento: { passos: passos(true, false, false), limpeza_pendente: [] } }));
  assert.match(html, /Verificação<\/strong> <span class="pill pill-ok">Feito/);
  assert.match(html, /PR final<\/strong> <span class="pill pill-neutro">Pendente/);
  assert.match(html, /Integração<\/strong> <span class="pill pill-neutro">Pendente/);
  assert.match(html, /Limpeza<\/strong> <span class="pill pill-neutro">Pendente/);
});

test("falha na verificação ou na integração marca só esse passo, com o motivo", () => {
  const verificacao = pagina(
    dadosDaPagina({
      encerramento: {
        passos: passos(false, false, false),
        limpeza_pendente: [],
        falha: { etapa: "check_final", motivo: "npm falhou" },
      },
    }),
  );
  assert.match(
    verificacao,
    /Verificação<\/strong> <span class="pill pill-falha">Falhou<\/span> <span class="dm-texto">npm falhou/,
  );
  assert.equal(verificacao.match(/Falhou/g)?.length, 1);
  const integracao = pagina(
    dadosDaPagina({
      encerramento: {
        passos: passos(true, true, false),
        limpeza_pendente: [],
        falha: { etapa: "integracao", motivo: "conflito" },
      },
    }),
  );
  assert.match(
    integracao,
    /Integração<\/strong> <span class="pill pill-falha">Falhou<\/span> <span class="dm-texto">conflito/,
  );
  assert.doesNotMatch(integracao, /Integração concluída/);
});

test("integração feita e limpeza falha: concluída e falhou, nunca nada integrado (CA-12)", () => {
  for (const encerramento of [
    {
      passos: passos(true, true, true),
      limpeza_pendente: ["worktree-1"],
      falha: { etapa: "limpeza" as const, motivo: "disco cheio" },
    },
    { passos: passos(true, true, true), limpeza_pendente: ["worktree-1"] },
  ]) {
    const html = pagina(dadosDaPagina({ encerramento }));
    assert.match(html, /Integração concluída\. Limpeza falhou/);
    assert.match(html, /Integração<\/strong> <span class="pill pill-ok">Feito/);
    assert.match(
      html,
      /Limpeza<\/strong> <span class="pill pill-falha">Falhou<\/span> <span class="dm-texto">[^<]*pendente: worktree-1/,
    );
    assert.doesNotMatch(html, /nada foi integrado/i);
  }
  assert.match(
    pagina(dadosDaPagina({ encerramento: { passos: passos(true, true, true), limpeza_pendente: [] } })),
    /Limpeza<\/strong> <span class="pill pill-ok">Feito/,
  );
});

test("o gate da demanda traz Aprovar e Recusar com o motivo, ligados à rota da decisão (CA-14 a CA-16)", () => {
  const html = pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, fase: "aprovacao_demanda" } }));
  assert.match(html, /<span class="dm-gate-titulo">Aprovação da demanda<\/span>/);
  assert.match(html, /<textarea id="motivo-decisao"/);
  assert.match(html, /data-gate="false" data-caminho="\/api\/demandas\/I-206\/decisao"[^>]*>Recusar</);
  assert.match(html, /data-gate="true" data-caminho="\/api\/demandas\/I-206\/decisao"[^>]*>Aprovar</);
});

test("o gate do planejamento usa a rota do planejamento (CA-17 a CA-19)", () => {
  const html = pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, fase: "aprovacao_planejamento" } }));
  assert.match(html, /data-caminho="\/api\/demandas\/[^"]*\/planejamento\/decisao"[^>]*>Reprovar planejamento</);
  assert.match(html, />Aprovar planejamento</);
  assert.match(html, /dm-gate-titulo">Aprovação do planejamento</);
});

test("a rodada em Aprovação do PR traz a nota e Aprovar PR/Reprovar PR ligados à rota do PR (CA-20 a CA-23)", () => {
  const base = dadosDaPagina();
  const html = pagina({ ...base, rodadas: [{ ref: "I-206.R1", titulo: "r", fase: "aprovacao_pull_request" }] });
  assert.match(html, /<select id="nota-I-206\.R1"/);
  const comTicket = pagina({
    ...base,
    rodadas: [{ ref: "I-206.R1", titulo: "r", fase: "aprovacao_pull_request" }],
    tickets: [{ ref: "I-206.T1", rodada: "I-206.R1", etapa: "implementar", status: "concluido" }],
  });
  assert.match(comTicket, /<\/ul>\s*<div class="dm-gate"><span class="dm-gate-titulo">Aprovação do PR</);
  assert.match(html, /<option value="5">5<\/option>/);
  assert.match(
    html,
    /data-gate="false" data-caminho="\/api\/demandas\/rodadas\/I-206\.R1\/pr" data-campo="motivo-I-206\.R1">Reprovar PR</,
  );
  assert.match(
    html,
    /data-gate="true" data-caminho="\/api\/demandas\/rodadas\/I-206\.R1\/pr" data-nota="nota-I-206\.R1">Aprovar PR</,
  );
  assert.doesNotMatch(
    pagina({ ...base, rodadas: [{ ref: "I-206.R1", titulo: "r", fase: "concluida" }] }),
    /Aprovar PR/,
  );
});

test("a rodada em sessão de ajustes liga à conversa dos ajustes (CA-22)", () => {
  const html = pagina({ ...dadosDaPagina(), rodadas: [{ ref: "I-206.R1", titulo: "r", fase: "sessao" }] });
  assert.match(html, /href="\/api\/demandas\/rodadas\/I-206\.R1\/ajustes" target="_blank" rel="noopener"/);
});

test("o quadro só linka o PR da rodada quando a URL é http(s)", () => {
  const d = (url: string) => ({
    ...demanda("I-206"),
    rodadas: [{ ref: "I-206.R1", fase: "aprovacao_pull_request" as const, pr: { id: "7", url } }],
  });
  assert.match(quadro({ demandas: [d("https://x/7")], trabalho: [] }), /href="https:\/\/x\/7"/);
  assert.doesNotMatch(quadro({ demandas: [d("javascript:x")], trabalho: [] }), /javascript/);
});

test("o ticket em falha traz a instrução e Reabrir; o aberto traz Executar agora (CA-24 a CA-26)", () => {
  const com = (status: "falhou" | "aberto" | "concluido") =>
    pagina({ ...dadosDaPagina(), tickets: [{ ref: "I-206.T3", etapa: "implementar", status }] });
  const falho = com("falhou");
  assert.match(falho, /<textarea id="instrucao-I-206\.T3"/);
  assert.match(falho, /dm-gate dm-gate-perigo"><span class="dm-gate-titulo">Reabrir I-206\.T3</);
  assert.match(
    falho,
    /data-acao="reabrir" data-caminho="\/api\/demandas\/tickets\/I-206\.T3\/reabrir" data-campo="instrucao-I-206\.T3">Reabrir</,
  );
  assert.match(
    com("aberto"),
    /data-acao="executar" data-caminho="\/api\/demandas\/tickets\/I-206\.T3\/executar">Executar agora</,
  );
  assert.doesNotMatch(com("concluido"), /data-acao/);
});

test("Cancelar só abre a confirmação, que lista as dependentes que vão junto (CA-27)", () => {
  const html = pagina(dadosDaPagina({ dependentes: [{ demanda_id: "I-207", titulo: "Dep <b>", fase: "execucao" }] }));
  assert.match(html, /data-demanda="abrir-cancelar"[^>]*>Cancelar a demanda/);
  assert.match(html, /data-confirmar-cancelar hidden>[\s\S]*href="\/demandas\/I-207">I-207<\/a> Dep &#60;b&#62;/);
  assert.match(html, /dm-gate-perigo" data-confirmar-cancelar hidden><span class="dm-gate-titulo">Cancelar I-206</);
  assert.match(html, /data-demanda="cancelar" data-caminho="\/api\/demandas\/I-206\/cancelar"/);
  assert.match(pagina(dadosDaPagina()), /Nenhuma outra demanda depende desta/);
});

test("Arquivar só na demanda concluída; cancelada e arquivada não têm ação (CA-29)", () => {
  const com = (fase: DadosDaPagina["demanda"]["fase"]) =>
    pagina(dadosDaPagina({ demanda: { id: "I-206", projeto: "loja", titulo: "T", fase } }));
  assert.match(com("concluida"), /data-demanda="arquivar" data-caminho="\/api\/demandas\/I-206\/arquivar"/);
  assert.doesNotMatch(com("concluida"), /Cancelar a demanda/);
  assert.doesNotMatch(com("cancelada"), /data-demanda/);
  assert.doesNotMatch(com("arquivada"), /data-demanda/);
});

test("o cartão de demanda cancelada não diz que aguarda a decisão do Auditor", () => {
  const html = quadro({
    demandas: [demanda("I-206", { fase: "cancelada", rodadas: [{ ref: "I-206.R1", fase: "aprovacao_pull_request" }] })],
    trabalho: [],
  });
  assert.doesNotMatch(html, /aguarda a decisão/);
});
