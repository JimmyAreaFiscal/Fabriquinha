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
  demanda: {
    id: "I-206",
    projeto: "loja",
    titulo: "Demanda <I-206>",
    tipo: "funcionalidade",
    descricao: "Corrigir <b>",
    fase: "execucao",
  },
  rodadas: [],
  tickets: [],
  decisoes: [],
  evidencias: [],
  encerramento: { passos: [], limpeza_pendente: [] },
  dependencias: [],
  dependentes: [],
  ...resto,
});

/** O trecho do HTML que começa em `marca` e vai até a próxima seção. */
const trecho = (html: string, marca: string): string => {
  const inicio = html.indexOf(marca);
  assert.notEqual(inicio, -1, `${marca} não está na página`);
  const fim = html.indexOf("<section", inicio + 1);
  return html.slice(inicio, fim === -1 ? undefined : fim);
};

test("a página vazia traz o cabeçalho, o trilho e a descrição na lateral, sem seções vazias", () => {
  const html = pagina(dadosDaPagina());
  assert.match(html, /href="\/home">← Início/);
  assert.match(html, /<h1>Demanda &#60;I-206&#62;<\/h1>/);
  assert.match(html, /<span class="tag">funcionalidade<\/span><span class="pill pill-rodando">Execução/);
  assert.match(html, /<aside class="dm-lateral" aria-label="Contexto da demanda">/);
  assert.match(
    html,
    /Descrição<\/h2><div class="md dm-descricao"><p>Corrigir &lt;b&gt;<\/p>\n<\/div><button [^>]*data-expandir>ler tudo/,
  );
  assert.doesNotMatch(
    html,
    /Aguarda você|Critérios de aceite|Dependências|Antes das rodadas|Depois das rodadas|Evidências da demanda|Encerramento final|dm-gate-titulo">Aprovação/,
  );
});

test("o trilho marca as fases feitas, a atual e os gates; concluída completa o trilho e cancelada fica sem ele", () => {
  const com = (fase: DadosDaPagina["demanda"]["fase"]) =>
    pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, fase } }));
  const execucao = com("execucao");
  assert.match(
    execucao,
    /<li class="dm-passo-trilho gate feito"><span class="dm-marco-trilho"><\/span><span>Aprovação do planejamento<\/span>/,
  );
  assert.match(
    execucao,
    /<li class="dm-passo-trilho atual" aria-current="step"><span class="dm-marco-trilho"><\/span><span>Execução</,
  );
  assert.match(execucao, /<li class="dm-passo-trilho"><span class="dm-marco-trilho"><\/span><span>Concluída</);
  for (const fase of ["concluida", "arquivada"] as const) {
    assert.equal(com(fase).match(/class="dm-passo-trilho (gate )?feito"/g)?.length, 8);
    assert.doesNotMatch(com(fase), /aria-current/);
  }
  assert.doesNotMatch(com("cancelada"), /dm-trilho/);
});

test("só o ticket com sessão leva ao chat dela (CA-16, CA-17)", () => {
  const html = pagina(
    dadosDaPagina({
      tickets: [
        { ref: "I-206.T1", etapa: "planejar", status: "em_execucao", elegivel: false, sessao: "s/1" },
        { ref: "I-206.T2", etapa: "implementar", status: "aberto", elegivel: false },
      ],
    }),
  );
  const [, t1, t2] = html.split(/(?=<li class="dm-ticket )/);
  assert.match(String(t1), /href="\/sessions\/s%2F1">chat →/);
  assert.doesNotMatch(String(t2), /chat →/);
  const aberta = pagina(
    dadosDaPagina({
      tickets: [{ ref: "I-206.T3", etapa: "sessao_em_aberto", status: "em_execucao", elegivel: false, sessao: "s/3" }],
    }),
  );
  assert.doesNotMatch(aberta, /chat →/);
});

test("a linha do tempo põe os globais antes e depois das rodadas, pelo endereço público, com decisão, motivo e nota (CA-8, CA-9, CA-11)", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [
        { ref: "I-206.R1", titulo: "Primeira", fase: "aprovacao_pull_request" },
        { ref: "I-206.R2", titulo: "Segunda", fase: "sessao" },
      ],
      tickets: [
        { ref: "I-206.T9", etapa: "demanda", status: "concluido", elegivel: false },
        {
          ref: "I-206.T1",
          etapa: "implementar",
          status: "falhou",
          elegivel: false,
          rodada: "I-206.R1",
          titulo: "T",
          instrucao: "refaça",
          motivo_falha: "quebrou",
        },
        { ref: "I-206.T2", etapa: "encerrar_rodada", status: "concluido", elegivel: false, rodada: "I-206.R1" },
        { ref: "I-206.T3", etapa: "implementar", status: "em_execucao", elegivel: false, rodada: "I-206.R2" },
        { ref: "I-206.T5", etapa: "revisar_rodada", status: "concluido", elegivel: false, rodada: "I-206.R2" },
        { ref: "I-206.T4", etapa: "planejar", status: "aberto", elegivel: false },
      ],
      decisoes: [
        { ticket: "I-206.T1", resultado: "recusado", motivo: "falta teste do caminho de erro", por: "agente" },
        { ticket: "I-206.T2", resultado: "recusado", motivo: "x", por: "auditor" },
        { ticket: "I-206.T2", resultado: "aprovado", nota: 4, por: "auditor" },
        { ticket: "I-206.T5", resultado: "recusado", motivo: "falta CA-2", por: "agente" },
      ],
      evidencias: [{ tipo: "pr_aberto", ticket: "I-206.T2", dados: { id: "7", url: "https://pr/7" }, anexos: [] }],
    }),
  );
  const antes = trecho(html, 'aria-labelledby="titulo-antes"');
  const r1 = trecho(html, 'id="I-206.R1"');
  const r2 = trecho(html, 'id="I-206.R2"');
  const depois = trecho(html, 'aria-labelledby="titulo-depois"');
  assert.match(antes, /Antes das rodadas[\s\S]*I-206\.T9[\s\S]*Demanda/);
  assert.doesNotMatch(antes, /I-206\.T4/);
  assert.match(
    r1,
    /<li class="dm-ticket dm-marco-falhou" id="I-206\.T1">[\s\S]*Implementação<\/strong> <span>T<\/span>[\s\S]*Falhou/,
  );
  assert.match(r1, /Motivo da falha:<\/strong> quebrou/);
  assert.match(r1, /Instrução:<\/strong> refaça/);
  assert.match(
    r1,
    /Recusado<\/strong> por Agente: falta teste do caminho de erro<\/div><button [^>]*data-expandir>ler tudo/,
  );
  // Concluído e decidido: a última decisão toma o lugar do "Concluído", na pílula e no marco.
  assert.match(
    r1,
    /<li class="dm-ticket dm-marco-aprovado" id="I-206\.T2">[\s\S]*<span class="pill pill-ok">Aprovado<\/span>/,
  );
  assert.match(r1, /Recusado<\/strong> por Auditor: x/);
  assert.match(r1, /Aprovado<\/strong> por Auditor · nota 4<\/div><\/li>/);
  assert.match(r1, /nota 4/);
  assert.match(r1, /Aprovação do PR/);
  assert.match(r1, /href="https:\/\/pr\/7" target="_blank" rel="noopener">PR #7/);
  assert.doesNotMatch(r1, /I-206\.T3|I-206\.T4/);
  assert.match(r2, /<li class="dm-ticket dm-marco-em_execucao" id="I-206\.T3">[\s\S]*Em execução/);
  assert.match(
    r2,
    /<li class="dm-ticket dm-marco-recusado" id="I-206\.T5">[\s\S]*<span class="pill pill-falha">Recusado<\/span>/,
  );
  assert.match(r2, /Sessão de ajustes/);
  assert.doesNotMatch(r2, /nota|PR #/);
  assert.match(depois, /Depois das rodadas[\s\S]*I-206\.T4[\s\S]*Aberto/);
  assert.ok(html.indexOf("titulo-antes") < html.indexOf('id="I-206.R1"'));
  assert.ok(html.indexOf('id="I-206.R2"') < html.indexOf("titulo-depois"));
});

test("Aguarda você liga ao gate da fase, ao PR e à sessão da rodada e aos tickets que pedem o Auditor", () => {
  const html = pagina(
    dadosDaPagina({
      demanda: { ...dadosDaPagina().demanda, fase: "aprovacao_planejamento" },
      rodadas: [
        { ref: "I-206.R1", titulo: "r", fase: "aprovacao_pull_request" },
        { ref: "I-206.R2", titulo: "r", fase: "sessao" },
        { ref: "I-206.R3", titulo: "r", fase: "revisao" },
      ],
      tickets: [
        {
          ref: "I-206.T1",
          etapa: "implementar",
          status: "falhou",
          elegivel: false,
          rodada: "I-206.R3",
          titulo: "Refazer <x>",
        },
        { ref: "I-206.T2", etapa: "implementar", status: "aberto", elegivel: true, rodada: "I-206.R3" },
        { ref: "I-206.T3", etapa: "implementar", status: "aberto", elegivel: false, rodada: "I-206.R3" },
      ],
    }),
  );
  const aguarda = trecho(html, "dm-aguarda");
  assert.match(aguarda, /href="#gate">Aprovação do planejamento ↓/);
  assert.match(aguarda, /href="#pr-I-206\.R1">Aprovação do PR · I-206\.R1 ↓/);
  assert.match(aguarda, /href="#ajustes-I-206\.R2">Sessão de ajustes · I-206\.R2 ↓/);
  assert.match(aguarda, /href="#I-206\.T1">Reabrir I-206\.T1 · Refazer &#60;x&#62; ↓/);
  assert.match(aguarda, /href="#I-206\.T2">Executar I-206\.T2 ↓/);
  assert.doesNotMatch(aguarda, /I-206\.T3|I-206\.R3/);
  // Só o aberto elegível tem o marco em destaque.
  assert.match(html, /<li class="dm-ticket dm-marco-elegivel" id="I-206\.T2">/);
  assert.match(html, /<li class="dm-ticket dm-marco-aberto" id="I-206\.T3">/);
  // Cada link tem para onde ir.
  for (const alvo of ['id="gate"', 'id="pr-I-206.R1"', 'id="ajustes-I-206.R2"', 'id="I-206.T1"', 'id="I-206.T2"'])
    assert.ok(html.includes(alvo), alvo);
});

test("rodada sem ticket e PR com endereço que não é http não viram link", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [{ ref: "I-206.R1", titulo: "R", fase: "revisao" }],
      tickets: [
        { ref: "I-206.T1", etapa: "encerrar_rodada", status: "concluido", elegivel: false, rodada: "I-206.R1" },
      ],
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

test("as evidências viram chips junto de quem as gerou; o chip guarda os anexos e os dados para a caixa (CA-10)", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [{ ref: "I-206.R1", titulo: "R", fase: "revisao" }],
      tickets: [{ ref: "I-206.T1", etapa: "implementar", status: "concluido", elegivel: false, rodada: "I-206.R1" }],
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
        { tipo: "desenho_solucao", dados: {}, anexos: [{ nome: "d.html", classe: "html", link: "/api/d" }] },
        { tipo: "tipo_novo", dados: {}, anexos: [] },
      ],
    }),
  );
  const ticket = trecho(html, 'id="I-206.T1"');
  assert.match(
    ticket,
    /<button type="button" class="dm-chip" data-evidencia="Comportamento · I-206\.T1">Comportamento<\/button><template><ul class="dm-anexos"><li><a class="link" href="\/api\/x\?a=1&#38;b=2" target="_blank" rel="noopener">print\.png<\/a><\/li><li><a class="link" href="\/api\/y" target="_blank" rel="noopener">log\.txt<\/a><\/li><\/ul><pre class="dm-dados">\{\n {2}&#34;a&#34;: &#34;&#60;b&#62;&#34;\n\}<\/pre><\/template>/,
  );
  // A imagem ganha chip próprio, que abre na caixa; o log fica só na caixa da evidência.
  assert.match(
    ticket,
    /<a class="dm-chip" href="\/api\/x\?a=1&#38;b=2" target="_blank" rel="noopener" data-imagem="print\.png">print\.png<\/a>/,
  );
  assert.equal(html.match(/data-imagem/g)?.length, 1);
  // A da rodada fica no cabeçalho dela; sem anexos, a caixa traz só os dados.
  assert.match(
    trecho(html, 'id="I-206.R1"'),
    /data-evidencia="Revisão integral · I-206\.R1">Revisão integral<\/button><template><pre class="dm-dados">\{\}<\/pre><\/template>[\s\S]*<ol class="dm-tickets dm-tempo">/,
  );
  const daDemanda = trecho(html, 'aria-labelledby="titulo-evidencias"');
  assert.match(daDemanda, /Evidências da demanda/);
  assert.match(daDemanda, /data-evidencia="Desenho da solução · demanda">Desenho da solução</);
  assert.match(
    daDemanda,
    /<button type="button" class="dm-chip" data-html="\/api\/d" data-nome="Desenho da solução">Desenho da solução · HTML<\/button>/,
  );
  assert.match(daDemanda, /data-evidencia="tipo novo · demanda">tipo novo</);
});

test("o chip resume o resultado dos tipos que a Fabriquinha gera, em verde ou vermelho", () => {
  const evidencia = (tipo: string, dados: unknown) => ({ tipo, ticket: "I-206.T1", dados, anexos: [] });
  const html = pagina(
    dadosDaPagina({
      tickets: [{ ref: "I-206.T1", etapa: "implementar", status: "concluido", elegivel: false }],
      evidencias: [
        evidencia("execucao_testes", { aprovada: true }),
        evidencia("execucao_testes", { aprovada: false }),
        evidencia("matriz_fitness", { linhas: [{ codigoSaida: 0 }, { codigoSaida: 0 }] }),
        evidencia("matriz_fitness", { linhas: [{ codigoSaida: 0 }, { codigoSaida: 1 }] }),
        evidencia("relatorio_sonar", {}),
        evidencia("relatorio_sonar", { issues: [] }),
        evidencia("relatorio_sonar", { issues: [{}, {}] }),
        evidencia("arquivos_alterados", {
          arquivos: [
            { adicionadas: 3, removidas: 1 },
            { adicionadas: 2, removidas: 10 },
          ],
        }),
        evidencia("comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: true }] }),
        evidencia("comprovacao_criterios", {
          criterios: [
            { id: "CA-1", atendido: true },
            { id: "CA-2", atendido: false },
          ],
        }),
      ],
    }),
  );
  const chip = (classe: string, texto: string) => {
    assert.match(html, new RegExp(`class="dm-chip${classe}" data-evidencia="[^"]*">${texto}</button>`));
  };
  chip(" dm-chip-ok", "Testes ✓");
  chip(" dm-chip-falha", "Testes ✗");
  chip(" dm-chip-ok", "Fitness 2/2");
  chip(" dm-chip-falha", "Fitness 1/2");
  chip("", "SonarQube");
  chip(" dm-chip-ok", "SonarQube · 0 issues");
  chip(" dm-chip-falha", "SonarQube · 2 issues");
  chip("", "2 arquivos · \\+5 −11");
  chip(" dm-chip-ok", "Critérios 1/1");
  chip(" dm-chip-falha", "Critérios 1/2");
});

test("os critérios na lateral trazem a última comprovação e quantas vezes falharam; na aprovação, ficam só no gate", () => {
  const criterios = {
    tipo: "criterios_aceite",
    dados: {
      criterios: ["CA-1", "CA-2", "CA-3", "CA-4"].map((id) => ({
        id,
        dado: "d",
        quando: "q",
        entao: `então ${id} \`x\``,
      })),
    },
    anexos: [],
  };
  const comprovacao = (ticket: string, atendidos: Record<string, boolean>) => ({
    tipo: "comprovacao_criterios",
    ticket,
    dados: { criterios: Object.entries(atendidos).map(([id, atendido]) => ({ id, atendido })) },
    anexos: [],
  });
  const evidencias = [
    criterios,
    comprovacao("I-206.T1", { "CA-1": false, "CA-2": false, "CA-3": true }),
    comprovacao("I-206.T2", { "CA-1": true, "CA-2": false, "CA-3": false }),
  ];
  const html = trecho(pagina(dadosDaPagina({ evidencias })), 'aria-labelledby="titulo-criterios"');
  const criterio = (id: string, classe: string, estado: string) => {
    assert.match(
      html,
      new RegExp(
        `dm-bolinha-${classe}" aria-hidden="true"></span><span class="mono">${id}</span><span class="muted">${estado}</span></div><div class="dm-ca-entao md">então ${id} <code>x</code></div>`,
      ),
    );
  };
  criterio("CA-1", "ok", "comprovado");
  criterio("CA-2", "falha", "não comprovado em 2 comprovações");
  criterio("CA-3", "falha", "não comprovado em 1 comprovação");
  criterio("CA-4", "neutro", "sem comprovação");
  const naAprovacao = pagina(
    dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, fase: "aprovacao_demanda" }, evidencias }),
  );
  assert.doesNotMatch(naAprovacao, /titulo-criterios|titulo-descricao/);
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

/** Uma evidência da própria demanda, sem anexos. */
const daDemanda = (tipo: string, dados: unknown, anexos: DadosDaPagina["evidencias"][number]["anexos"] = []) => ({
  tipo,
  dados,
  anexos,
});
const naAprovacao = (evidencias: DadosDaPagina["evidencias"]) =>
  pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, fase: "aprovacao_demanda" }, evidencias }));
const DESENHO = {
  resumo: "Guardar o cupom na `sessao`.",
  arquivosPrevistos: [
    { caminho: "src/a.ts", acao: "alterar", motivo: "ler <x>" },
    { caminho: "src/b.ts", acao: "criar", motivo: "m" },
  ],
  foraDeEscopo: ["cupons <expirados>"],
};
const HTML = { nome: "desenho.html", classe: "html", link: "/api/demandas/I-206/anexos/abc?tipo=desenho_solucao" };

test("a aprovação da demanda mostra tipo, descrição, comportamento, critérios e o desenho antes do motivo", () => {
  const html = naAprovacao([
    daDemanda("comportamento", { descricao: "Hoje **some**", comoReproduzir: ["x"] }),
    daDemanda("criterios_aceite", { criterios: [{ id: "CA-1", dado: "d <i>", quando: "`q`", entao: "e" }] }),
    daDemanda("desenho_solucao", DESENHO, [{ nome: "nota.txt", classe: "texto", link: "/t" }, HTML]),
    daDemanda("relatorio_impactos_arquitetura", {
      impacto: "alto",
      novosAcoplamentos: [{ de: "a", para: "b", motivo: "m" }],
    }),
    // A do ticket não é a da demanda.
    { ...daDemanda("criterios_aceite", { criterios: [] }), ticket: "I-206.T1" },
  ]);
  assert.match(html, /<dt>Tipo<\/dt><dd><span class="tag">funcionalidade<\/span>/);
  assert.match(html, /<dt>Descrição<\/dt><dd><div class="md"><p>Corrigir &lt;b&gt;<\/p>/);
  assert.match(html, /<dt>Comportamento<\/dt><dd><div class="md"><p>Hoje <strong>some<\/strong>/);
  assert.match(html, /<td class="mono">CA-1<\/td><td class="md">d &lt;i&gt;<\/td><td class="md"><code>q<\/code>/);
  assert.match(html, /<strong>2<\/strong><span>arquivos previstos/);
  assert.match(html, /<strong>1<\/strong><span>acoplamento novo/);
  assert.match(html, /<span class="impacto-alto">alto<\/span><\/strong><span>impacto na arquitetura/);
  assert.match(html, /Guardar o cupom na <code>sessao<\/code>/);
  assert.match(html, /<td class="mono">src\/<wbr>a\.ts<\/td><td>alterar<\/td><td class="md">ler &lt;x&gt;/);
  assert.match(html, /Fora de escopo[\s\S]*<li>cupons &lt;expirados&gt;<\/li>/);
  assert.match(
    html,
    /data-html="\/api\/demandas\/I-206\/anexos\/abc\?tipo=desenho_solucao" data-nome="Desenho da solução"/,
  );
  // O relatório sem HTML não ganha card.
  assert.doesNotMatch(html, /data-nome="Impactos/);
  assert.ok(html.indexOf("dm-aprovacao") < html.indexOf('id="motivo-decisao"'));
});

test("a aprovação sem relatório de impactos mostra só os arquivos previstos; sem evidências, diz o que falta", () => {
  const semRelatorio = naAprovacao([daDemanda("desenho_solucao", { ...DESENHO, foraDeEscopo: [] })]);
  assert.match(semRelatorio, /<strong>2<\/strong><span>arquivos previstos/);
  assert.doesNotMatch(semRelatorio, /impacto na arquitetura|acoplamento|Fora de escopo|Comportamento|cards-art/);
  const comRelatorio = naAprovacao([
    daDemanda("desenho_solucao", { ...DESENHO, arquivosPrevistos: [DESENHO.arquivosPrevistos[0]] }),
    daDemanda("relatorio_impactos_arquitetura", { impacto: "medio", novosAcoplamentos: [] }, [HTML]),
  ]);
  assert.match(comRelatorio, /<strong>1<\/strong><span>arquivo previsto</);
  assert.match(comRelatorio, /<strong>0<\/strong><span>acoplamentos novos/);
  assert.match(comRelatorio, /data-nome="Impactos na arquitetura"/);
  assert.doesNotMatch(comRelatorio, /data-nome="Desenho da solução"/);
  const vazia = naAprovacao([]);
  assert.match(vazia, /Sem critérios de aceite\./);
  assert.match(vazia, /Sem desenho da solução\./);
  // Fora da aprovação da demanda, nada disso.
  assert.doesNotMatch(pagina(dadosDaPagina()), /dm-aprovacao/);
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
  const reprovacao = html.slice(html.indexOf("Reprovação do PR"));
  assert.doesNotMatch(reprovacao, /<select/);
  assert.match(reprovacao, /<textarea id="motivo-I-206\.R1"/);
  const comTicket = pagina({
    ...base,
    rodadas: [{ ref: "I-206.R1", titulo: "r", fase: "aprovacao_pull_request" }],
    tickets: [{ ref: "I-206.T1", rodada: "I-206.R1", etapa: "implementar", status: "concluido", elegivel: false }],
  });
  assert.match(
    comTicket,
    /<\/ol>\s*<div class="dm-gate" id="pr-I-206\.R1"><span class="dm-gate-titulo">Aprovação do PR</,
  );
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

test("a rodada em sessão de ajustes liga à seção da conversa, no mesmo documento (CA-10)", () => {
  const html = pagina({ ...dadosDaPagina(), rodadas: [{ ref: "I-206.R1", titulo: "r", fase: "sessao" }] });
  assert.match(html, /<a class="link" href="#ajustes-I-206\.R1">Sessão de ajustes ↓<\/a>/);
  assert.match(html, /<div id="ajustes-I-206\.R1" data-ajustes="I-206\.R1"><\/div>/);
});

test("o quadro só linka o PR da rodada quando a URL é http(s)", () => {
  const d = (url: string) => ({
    ...demanda("I-206"),
    rodadas: [{ ref: "I-206.R1", fase: "aprovacao_pull_request" as const, pr: { id: "7", url } }],
  });
  assert.match(quadro({ demandas: [d("https://x/7")], trabalho: [] }), /href="https:\/\/x\/7"/);
  assert.doesNotMatch(quadro({ demandas: [d("javascript:x")], trabalho: [] }), /javascript/);
});

test("o ticket em falha traz a instrução e Reabrir; o aberto elegível traz Executar agora (CA-17, CA-24 a CA-26)", () => {
  const com = (status: "falhou" | "aberto" | "concluido", elegivel = true) =>
    pagina({ ...dadosDaPagina(), tickets: [{ ref: "I-206.T3", etapa: "implementar", status, elegivel }] });
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
  assert.doesNotMatch(com("aberto", false), /data-acao/);
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
    pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, fase } }));
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
