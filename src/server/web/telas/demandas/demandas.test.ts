import { CATALOGO_DO_CICLO_DE_VIDA } from "../../../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_de_teste.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDeDemandas, PaginaDaDemanda, PendenciaDoInicio } from "../../../contrato/demanda.ts";
import { pagina, quadro } from "./demandas.ts";
import { descreverEtapasDoSdlc } from "../../../consultas/etapas.ts";
import { definirEtapasDoSdlc } from "../../apresentacao/etapas.ts";

definirEtapasDoSdlc(descreverEtapasDoSdlc(CATALOGO_DO_CICLO_DE_VIDA));

type DemandaDoBoard = BoardDeDemandas["demandas"][number];

const ACAO_DO_TIPO: Record<PendenciaDoInicio["tipo"], PendenciaDoInicio["acao_esperada"]> = {
  gate_humano: "decidir_gate",
  item_bloqueado: "reabrir_com_instrucao",
  dialogo_do_agente: "responder",
  revisao_parada: "reabrir_com_instrucao",
  acao_externa: "integrar_na_plataforma",
  despacho_parado: "executar",
};

/** Uma Pendência como o servidor a manda; o `motivo` é o texto pronto. */
const pendencia = (tipo: PendenciaDoInicio["tipo"], item: string, motivo = "motivo"): PendenciaDoInicio => ({
  tipo,
  item,
  motivo,
  acao_esperada: ACAO_DO_TIPO[tipo],
  desde: "2026-11-05T10:00:00.000Z",
  demanda: item.split(".")[0] ?? item,
  projeto: "loja",
  titulo: "t",
});

const demanda = (id: string, resto: Partial<DemandaDoBoard> = {}): DemandaDoBoard => ({
  id,
  projeto: "loja",
  titulo: `Demanda ${id}`,
  estado: "em_execucao",
  terminal: false,
  rodadas: [],
  bloqueios: [],
  pendencias: [],
  ...resto,
});

test("sem trabalho nem demandas, o quadro diz que não há nada em vez de ficar vazio (CA-7)", () => {
  const html = quadro({ demandas: [], trabalho: [] });
  assert.match(html, /Não há trabalho em andamento\./);
  assert.match(html, /Nenhuma demanda em andamento\./);
});

test("o trabalho ativo traz o ticket, a etapa, a rodada, quando há, e se é o pi ou o sistema que roda (CA-6)", () => {
  const html = quadro({
    demandas: [],
    trabalho: [
      { ref: "I-206.T3", etapa: "implementar", rodada: "I-206.R2", pi_ativo: true },
      { ref: "I-206.T5", etapa: "planejar" },
    ],
  });
  assert.match(
    html,
    /I-206\.T3<\/span> Implementação · rodada <span class="id">I-206\.R2<\/span> <span class="pill pill-rodando">Sessão pi ativa<\/span><\/li>/,
  );
  assert.match(
    html,
    /I-206\.T5<\/span> Planejamento <span class="pill pill-rodando sem-pulso">Em execução \(sistema\)<\/span><\/li>/,
  );
});

test("o cartão traz o título, o estado, as rodadas e o link do PR só na rodada que tem PR (CA-1, CA-2)", () => {
  const html = quadro({
    demandas: [
      demanda("I-206", {
        pendencias: [pendencia("gate_humano", "I-206.R1")],
        rodadas: [
          { ref: "I-206.R1", estado: "gate_pr", pr: { id: "7", url: "https://pr/7?a=1&b=2" } },
          { ref: "I-206.R2", estado: "implementar" },
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
  assert.match(html, /aguarda você · gate · I-206\.R1/);
  assert.match(html, /href="\/demandas\/I-206">abrir a demanda →/);
});

test("as marcas: uma por Pendência, do tipo e do item, e a dependência à parte, com título e estado (CA-3 a CA-5)", () => {
  const html = quadro({
    demandas: [
      demanda("I-206"),
      demanda("I-207", {
        pendencias: [pendencia("item_bloqueado", "I-207.T1")],
        bloqueios: [
          { demanda_id: "I-206", estado: "em_execucao" },
          { demanda_id: "I-300", estado: "planejar" },
        ],
      }),
      demanda("I-208", { estado: "gate_demanda", pendencias: [pendencia("gate_humano", "I-208")] }),
      demanda("I-209", { estado: "encerrar_demanda", pendencias: [pendencia("acao_externa", "I-209")] }),
    ],
    trabalho: [],
  });
  assert.match(html, /pill-falha">aguarda você · bloqueado · I-207\.T1/);
  assert.match(html, /bloqueada por I-206 · Demanda I-206 · Execução/);
  assert.match(html, /bloqueada por I-300 · Planejamento</);
  assert.match(html, /pill-aguarda">aguarda você · gate · I-208/);
  assert.match(html, /pill-aguarda">aguarda você · ação externa · I-209/);
  // A dependência não é "Aguarda você": o cartão da I-206 e o da I-207 só ganham a classe pelo que a I-207 e as outras esperam.
  assert.equal(html.match(/class="cartao dm-cartao aguarda"/g)?.length, 3);
  assert.doesNotMatch(html, /aguarda você · [^<]*I-300/);
});

test("o texto do servidor é escapado", () => {
  const html = quadro({ demandas: [demanda("I-1", { titulo: "<img onerror=x>" })], trabalho: [] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&#60;img onerror=x&#62;/);
});

const EM = "2026-01-01T00:00:00.000Z";
const USO = { modelos: [], custo: { conhecido: 0, trabalhosSemCusto: 0, trabalhosComCustoEstimado: 0 } };

const dadosDaPagina = (resto: Partial<PaginaDaDemanda> = {}): PaginaDaDemanda => ({
  pendencias: [],
  demanda: {
    id: "I-206",
    projeto: "loja",
    titulo: "Demanda <I-206>",
    tipo: "funcionalidade",
    descricao: "Corrigir <b>",
    estado: "em_execucao",
    terminal: false,
    arquivavel: false,
  },
  rodadas: [],
  tickets: [],
  decisoes: [],
  evidencias: [],
  encerramento: { passos: [], limpeza_pendente: [] },
  dependencias: [],
  dependentes: [],
  uso: { ...USO, textoDoCusto: "US$ 1,50" },
  ...resto,
});

/** A demanda da página no estado pedido, com a classificação que a API entrega. */
const demandaNoEstado = (estado: PaginaDaDemanda["demanda"]["estado"]): PaginaDaDemanda["demanda"] => ({
  ...dadosDaPagina().demanda,
  estado,
  terminal: ["concluida", "arquivada", "cancelada"].includes(estado),
  arquivavel: estado === "concluida",
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

test("o cabeçalho mostra o texto do custo que a rota entrega, com ≥ e o aviso quando falta custo", () => {
  assert.match(pagina(dadosDaPagina()), /<span class="muted">Custo US\$ 1,50<\/span>/);
  const paginaComSessaoSemCusto = pagina(
    dadosDaPagina({ uso: { ...USO, textoDoCusto: "≥ US$ 4,20 (1 sessão sem custo)" } }),
  );
  assert.match(paginaComSessaoSemCusto, /Custo ≥ US\$ 4,20 \(1 sessão sem custo\)<\/span>/);
});

test("o trilho marca os estados feitas, a atual e os gates; concluída completa o trilho e cancelada fica sem ele", () => {
  const com = (estado: PaginaDaDemanda["demanda"]["estado"]) =>
    pagina(dadosDaPagina({ demanda: demandaNoEstado(estado) }));
  const execucao = com("em_execucao");
  assert.match(
    execucao,
    /<li class="dm-passo-trilho gate feito"><span class="dm-marco-trilho"><\/span><span>Aprovação do planejamento<\/span>/,
  );
  assert.match(
    execucao,
    /<li class="dm-passo-trilho atual" aria-current="step"><span class="dm-marco-trilho"><\/span><span>Execução</,
  );
  assert.match(execucao, /<li class="dm-passo-trilho"><span class="dm-marco-trilho"><\/span><span>Concluída</);
  for (const estado of ["arquivada", "concluida"] as const) {
    assert.equal(com(estado).match(/class="dm-passo-trilho (gate )?feito"/g)?.length, 8);
    assert.doesNotMatch(com(estado), /aria-current/);
  }
  assert.doesNotMatch(com("cancelada"), /dm-trilho/);
});

test("só o ticket com sessão leva ao chat dela, inclusive a sessão de ajustes (CA-16, CA-17)", () => {
  const html = pagina(
    dadosDaPagina({
      tickets: [
        {
          ref: "I-206.T1",
          etapa: "planejar",
          estado: "em_execucao",
          satisfaz_dependencia: false,
          elegivel: false,
          sessao: "s/1",
        },
        { ref: "I-206.T2", etapa: "implementar", estado: "aberto", satisfaz_dependencia: false, elegivel: false },
      ],
    }),
  );
  const [, t1, t2] = html.split(/(?=<li class="dm-ticket )/);
  assert.match(String(t1), /href="\/sessions\/s%2F1">chat →/);
  assert.doesNotMatch(String(t2), /chat →/);
  const aberta = pagina(
    dadosDaPagina({
      tickets: [
        {
          ref: "I-206.T3",
          etapa: "ajustar_resultado",
          estado: "em_execucao",
          satisfaz_dependencia: false,
          elegivel: false,
          sessao: "s/3",
        },
      ],
    }),
  );
  assert.match(aberta, /href="\/sessions\/s%2F3">chat →/);
});

test("a linha do tempo põe os globais antes e depois das rodadas, pelo endereço público, com decisão, motivo e nota (CA-8, CA-9, CA-11)", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [
        {
          ref: "I-206.R1",
          titulo: "Primeira",
          estado: "gate_pr",
          pr: { id: "7", url: "https://pr/7" },
          ticket_atual_por_etapa: { encerrar_rodada: "I-206.T2" },
        },
        { ref: "I-206.R2", titulo: "Segunda", estado: "ajustar_resultado", ticket_atual_por_etapa: {} },
      ],
      tickets: [
        {
          ref: "I-206.T9",
          etapa: "entender_e_desenhar",
          estado: "concluido",
          satisfaz_dependencia: true,
          elegivel: false,
        },
        {
          ref: "I-206.T1",
          etapa: "implementar",
          estado: "falhou",
          satisfaz_dependencia: false,
          elegivel: false,
          rodada: "I-206.R1",
          titulo: "T",
          instrucao: "refaça",
          motivo: "quebrou",
        },
        {
          ref: "I-206.T2",
          etapa: "encerrar_rodada",
          estado: "concluido",
          satisfaz_dependencia: true,
          elegivel: false,
          rodada: "I-206.R1",
        },
        {
          ref: "I-206.T3",
          etapa: "implementar",
          estado: "em_execucao",
          satisfaz_dependencia: false,
          elegivel: false,
          rodada: "I-206.R2",
        },
        {
          ref: "I-206.T5",
          etapa: "revisar_rodada",
          estado: "concluido",
          satisfaz_dependencia: true,
          elegivel: false,
          rodada: "I-206.R2",
        },
        { ref: "I-206.T4", etapa: "planejar", estado: "aberto", satisfaz_dependencia: false, elegivel: false },
      ],
      decisoes: [
        {
          ticket: "I-206.T1",
          gate: "gate_pr",
          em: EM,
          resultado: "reprovado",
          motivo: "falta teste do caminho de erro",
          por: "agente",
        },
        { ticket: "I-206.T2", gate: "gate_pr", em: EM, resultado: "reprovado", motivo: "x", por: "auditor" },
        { ticket: "I-206.T2", gate: "gate_pr", em: EM, resultado: "aprovado", nota: 4, por: "auditor" },
        { ticket: "I-206.T5", gate: "gate_pr", em: EM, resultado: "reprovado", motivo: "falta CA-2", por: "agente" },
      ],
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
    /Reprovado<\/strong> por Agente: falta teste do caminho de erro<\/div><button [^>]*data-expandir>ler tudo/,
  );
  // Concluído e decidido: a última decisão toma o lugar do "Concluído", na pílula e no marco.
  assert.match(
    r1,
    /<li class="dm-ticket dm-marco-aprovado" id="I-206\.T2">[\s\S]*<span class="pill pill-ok">Aprovado<\/span>/,
  );
  assert.match(r1, /Reprovado<\/strong> por Auditor: x/);
  assert.match(r1, /Aprovado<\/strong> por Auditor · nota 4<\/div><\/li>/);
  assert.match(r1, /nota 4/);
  assert.match(r1, /Aprovação do PR/);
  assert.match(r1, /href="https:\/\/pr\/7" target="_blank" rel="noopener">PR #7/);
  assert.doesNotMatch(r1, /I-206\.T3|I-206\.T4/);
  assert.match(r2, /<li class="dm-ticket dm-marco-em_execucao" id="I-206\.T3">[\s\S]*Em execução/);
  assert.match(
    r2,
    /<li class="dm-ticket dm-marco-reprovado" id="I-206\.T5">[\s\S]*<span class="pill pill-falha">Reprovado<\/span>/,
  );
  assert.match(r2, /Sessão de ajustes/);
  assert.doesNotMatch(r2, /nota|PR #/);
  assert.match(depois, /Depois das rodadas[\s\S]*I-206\.T4[\s\S]*Aberto/);
  assert.ok(html.indexOf("titulo-antes") < html.indexOf('id="I-206.R1"'));
  assert.ok(html.indexOf('id="I-206.R2"') < html.indexOf("titulo-depois"));
});

test("Aguarda você mostra as Pendências do servidor e liga cada uma ao lugar onde o Auditor resolve", () => {
  const html = pagina(
    dadosDaPagina({
      demanda: { ...dadosDaPagina().demanda, estado: "gate_planejamento" },
      pendencias: [
        pendencia("gate_humano", "I-206", "Aprovação do planejamento aguarda decisão"),
        pendencia("gate_humano", "I-206.R1", "PR #7 da rodada aguarda decisão"),
        pendencia("dialogo_do_agente", "I-206.R2", "A sessão de ajustes do resultado aguarda o Auditor"),
        pendencia("item_bloqueado", "I-206.T1", "Tentativas esgotadas: <x>"),
        pendencia("despacho_parado", "I-206.T2"),
        pendencia("dialogo_do_agente", "I-206.T4", "O agente pergunta: seguir?"),
        pendencia("revisao_parada", "I-206", "A revisão integral não começou"),
      ],
      rodadas: [
        { ref: "I-206.R1", titulo: "r", estado: "gate_pr", ticket_atual_por_etapa: {} },
        { ref: "I-206.R2", titulo: "r", estado: "ajustar_resultado", ticket_atual_por_etapa: {} },
        { ref: "I-206.R3", titulo: "r", estado: "revisar_rodada", ticket_atual_por_etapa: {} },
      ],
      tickets: [
        {
          ref: "I-206.T1",
          etapa: "implementar",
          estado: "falhou",
          satisfaz_dependencia: false,
          elegivel: false,
          rodada: "I-206.R3",
          titulo: "Refazer <x>",
        },
        {
          ref: "I-206.T2",
          etapa: "implementar",
          estado: "aberto",
          satisfaz_dependencia: false,
          elegivel: true,
          rodada: "I-206.R3",
        },
        {
          ref: "I-206.T3",
          etapa: "implementar",
          estado: "aberto",
          satisfaz_dependencia: false,
          elegivel: false,
          rodada: "I-206.R3",
        },
      ],
    }),
  );
  const aguarda = trecho(html, "dm-aguarda");
  assert.match(aguarda, /href="#gate">Decidir I-206: Aprovação do planejamento aguarda decisão ↓/);
  assert.match(aguarda, /href="#pr-I-206\.R1">Decidir I-206\.R1: PR #7 da rodada aguarda decisão ↓/);
  assert.match(aguarda, /href="#ajustes-I-206\.R2">Responder I-206\.R2: A sessão de ajustes/);
  assert.match(aguarda, /href="#I-206\.T1">Reabrir o ticket I-206\.T1: Tentativas esgotadas: &#60;x&#62; ↓/);
  assert.match(aguarda, /href="#I-206\.T2">Executar I-206\.T2: motivo ↓/);
  assert.match(aguarda, /href="#I-206\.T4">Responder I-206\.T4: O agente pergunta: seguir\? ↓/);
  // A revisão parada não tem lugar na página: o texto fica sem link.
  assert.match(aguarda, /<li>Ver a demanda I-206: A revisão integral não começou<\/li>/);
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
      rodadas: [
        {
          ref: "I-206.R1",
          titulo: "R",
          estado: "revisar_rodada",
          pr: { id: "7", url: "javascript:x" },
          ticket_atual_por_etapa: { encerrar_rodada: "I-206.T1" },
        },
      ],
      tickets: [
        {
          ref: "I-206.T1",
          etapa: "encerrar_rodada",
          estado: "concluido",
          satisfaz_dependencia: true,
          elegivel: false,
          rodada: "I-206.R1",
        },
      ],
    }),
  );
  assert.doesNotMatch(html, /javascript:x" /);
  assert.match(html, /PR #7/);
  assert.match(
    pagina(
      dadosDaPagina({
        rodadas: [{ ref: "I-206.R1", titulo: "R", estado: "revisar_rodada", ticket_atual_por_etapa: {} }],
      }),
    ),
    /Sem tickets\./,
  );
});

test("as dependências trazem o link e o estado da predecessora (CA-13)", () => {
  const html = pagina(dadosDaPagina({ dependencias: [{ demanda_id: "I-205", estado: "em_execucao" }] }));
  assert.match(html, /Dependências[\s\S]*href="\/demandas\/I-205">I-205<\/a> <span class="pill pill-rodando">Execução/);
});

test("as evidências viram chips junto de quem as gerou; o chip guarda os anexos e os dados para a caixa (CA-10)", () => {
  const html = pagina(
    dadosDaPagina({
      rodadas: [{ ref: "I-206.R1", titulo: "R", estado: "revisar_rodada", ticket_atual_por_etapa: {} }],
      tickets: [
        {
          ref: "I-206.T1",
          etapa: "implementar",
          estado: "concluido",
          satisfaz_dependencia: true,
          elegivel: false,
          rodada: "I-206.R1",
        },
      ],
      evidencias: [
        {
          tipo: "comportamento",
          em: EM,
          ticket: "I-206.T1",
          dados: { a: "<b>" },
          anexos: [
            { nome: "print.png", classe: "imagem", mime: "x/y", bytes: 1, link: "/api/x?a=1&b=2" },
            { nome: "log.txt", classe: "texto", mime: "x/y", bytes: 1, link: "/api/y" },
          ],
        },
        { tipo: "revisao_integral", em: EM, rodada: "I-206.R1", dados: {}, anexos: [] },
        {
          tipo: "desenho_solucao",
          em: EM,
          dados: {},
          anexos: [{ nome: "d.html", classe: "html", mime: "x/y", bytes: 1, link: "/api/d" }],
        },
        { tipo: "tipo_novo", em: EM, dados: {}, anexos: [] },
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
  const evidencia = (tipo: string, dados: unknown) => ({ tipo, em: EM, ticket: "I-206.T1", dados, anexos: [] });
  const html = pagina(
    dadosDaPagina({
      tickets: [
        { ref: "I-206.T1", etapa: "implementar", estado: "concluido", satisfaz_dependencia: true, elegivel: false },
      ],
      evidencias: [
        evidencia("execucao_testes", { comandos: [{ comando: "npm run check", codigoSaida: 0 }] }),
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
    em: EM,
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
    em: EM,
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
    dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, estado: "gate_demanda" }, evidencias }),
  );
  assert.doesNotMatch(naAprovacao, /titulo-criterios|titulo-descricao/);
});

const passos = (verificacao: boolean, pr: boolean, integracao: boolean): PaginaDaDemanda["encerramento"]["passos"] => [
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

test("a integração à espera do merge humano: o passo, o link do PR e o Aguarda você, sem pedir a execução", () => {
  const html = pagina(
    dadosDaPagina({
      demanda: { ...dadosDaPagina().demanda, estado: "encerrar_demanda" },
      pendencias: [pendencia("acao_externa", "I-206", "Integrar o PR final #9 na plataforma")],
      tickets: [
        { ref: "I-206.T8", etapa: "encerrar_demanda", estado: "aberto", satisfaz_dependencia: false, elegivel: false },
      ],
      encerramento: {
        passos: passos(true, true, false),
        limpeza_pendente: [],
        aguardando_merge: { url: "https://pr/9" },
      },
    }),
  );
  assert.match(
    html,
    /Integração<\/strong> <span class="pill pill-aguarda">Aguardando você<\/span> <span class="dm-texto"><a class="link" href="https:\/\/pr\/9" target="_blank" rel="noopener">aprove e integre o PR final na plataforma ↗/,
  );
  const aguarda = trecho(html, "dm-aguarda");
  assert.match(aguarda, /href="#titulo-encerramento">Integrar o PR I-206: Integrar o PR final #9 na plataforma ↓/);
  assert.doesNotMatch(aguarda, /Executar I-206\.T8/);
});

test("o gate da demanda traz Aprovar e Reprovar com o motivo, ligados à rota da decisão (CA-14 a CA-16)", () => {
  const html = pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, estado: "gate_demanda" } }));
  assert.match(html, /<span class="dm-gate-titulo">Aprovação da demanda<\/span>/);
  assert.match(html, /<textarea id="motivo-decisao"/);
  assert.match(html, /data-gate="reprovado" data-caminho="\/api\/demandas\/I-206\/decisao"[^>]*>Reprovar</);
  assert.match(html, /data-gate="aprovado" data-caminho="\/api\/demandas\/I-206\/decisao"[^>]*>Aprovar</);
});

/** Uma evidência da própria demanda, sem anexos. */
const daDemanda = (tipo: string, dados: unknown, anexos: PaginaDaDemanda["evidencias"][number]["anexos"] = []) => ({
  tipo,
  em: EM,
  dados,
  anexos,
});
const naAprovacao = (evidencias: PaginaDaDemanda["evidencias"]) =>
  pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, estado: "gate_demanda" }, evidencias }));
const DESENHO = {
  resumo: "Guardar o cupom na `sessao`.",
  arquivosPrevistos: [
    { caminho: "src/a.ts", acao: "alterar", motivo: "ler <x>" },
    { caminho: "src/b.ts", acao: "criar", motivo: "m" },
  ],
  foraDeEscopo: ["cupons <expirados>"],
};
const HTML = {
  nome: "desenho.html",
  classe: "html" as const,
  mime: "text/html",
  bytes: 1,
  link: "/api/demandas/I-206/anexos/abc?tipo=desenho_solucao",
};

test("a aprovação da demanda mostra tipo, descrição, comportamento, critérios e o desenho antes do motivo", () => {
  const html = naAprovacao([
    daDemanda("comportamento", { descricao: "Hoje **some**", comoReproduzir: ["x"] }),
    daDemanda("criterios_aceite", { criterios: [{ id: "CA-1", dado: "d <i>", quando: "`q`", entao: "e" }] }),
    daDemanda("desenho_solucao", DESENHO, [
      { nome: "nota.txt", classe: "texto", mime: "x/y", bytes: 1, link: "/t" },
      HTML,
    ]),
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
  const html = pagina(dadosDaPagina({ demanda: { ...dadosDaPagina().demanda, estado: "gate_planejamento" } }));
  assert.match(html, /data-caminho="\/api\/demandas\/[^"]*\/planejamento\/decisao"[^>]*>Reprovar planejamento</);
  assert.match(html, />Aprovar planejamento</);
  assert.match(html, /dm-gate-titulo">Aprovação do planejamento</);
});

test("a rodada em Aprovação do PR traz a nota e Aprovar PR/Reprovar PR ligados à rota do PR (CA-20 a CA-23)", () => {
  const base = dadosDaPagina();
  const html = pagina({
    ...base,
    rodadas: [{ ref: "I-206.R1", titulo: "r", estado: "gate_pr", ticket_atual_por_etapa: {} }],
  });
  assert.match(html, /<select id="nota-I-206\.R1"/);
  const reprovacao = html.slice(html.indexOf("Reprovação do PR"));
  assert.doesNotMatch(reprovacao, /<select/);
  assert.match(reprovacao, /<textarea id="motivo-I-206\.R1"/);
  const comTicket = pagina({
    ...base,
    rodadas: [{ ref: "I-206.R1", titulo: "r", estado: "gate_pr", ticket_atual_por_etapa: {} }],
    tickets: [
      {
        ref: "I-206.T1",
        rodada: "I-206.R1",
        etapa: "implementar",
        estado: "concluido",
        satisfaz_dependencia: true,
        elegivel: false,
      },
    ],
  });
  assert.match(
    comTicket,
    /<\/ol>\s*<div class="dm-gate" id="pr-I-206\.R1"><span class="dm-gate-titulo">Aprovação do PR</,
  );
  assert.match(html, /<option value="5">5<\/option>/);
  assert.match(
    html,
    /data-gate="reprovado" data-caminho="\/api\/demandas\/rodadas\/I-206\.R1\/pr" data-campo="motivo-I-206\.R1">Reprovar PR</,
  );
  assert.match(
    html,
    /data-gate="aprovado" data-caminho="\/api\/demandas\/rodadas\/I-206\.R1\/pr" data-nota="nota-I-206\.R1">Aprovar PR</,
  );
  assert.doesNotMatch(
    pagina({ ...base, rodadas: [{ ref: "I-206.R1", titulo: "r", estado: "concluida", ticket_atual_por_etapa: {} }] }),
    /Aprovar PR/,
  );
});

test("o gate do PR traz o botão que abre o PR no GitHub ou no Azure DevOps, só com endereço http(s)", () => {
  const comPR = (url: string) =>
    pagina({
      ...dadosDaPagina(),
      rodadas: [
        {
          ref: "I-206.R1",
          titulo: "r",
          estado: "gate_pr",
          pr: { id: "7", url },
          ticket_atual_por_etapa: { encerrar_rodada: "I-206.T2" },
        },
      ],
      tickets: [
        {
          ref: "I-206.T2",
          rodada: "I-206.R1",
          etapa: "encerrar_rodada",
          estado: "em_execucao",
          satisfaz_dependencia: false,
          elegivel: false,
        },
      ],
    });
  const gate = (html: string) => html.slice(html.indexOf('id="pr-I-206.R1"'));
  assert.match(
    gate(comPR("https://github.com/o/r/pull/7")),
    /<a class="btn" href="https:\/\/github\.com\/o\/r\/pull\/7" target="_blank" rel="noopener">Abrir PR #7 no GitHub ↗<\/a>/,
  );
  assert.match(gate(comPR("https://dev.azure.com/o/p/_git/r/pullrequest/7")), />Abrir PR #7 no Azure DevOps ↗</);
  assert.doesNotMatch(gate(comPR("javascript:alert(1)")), /Abrir PR/);
});

test("o gate do PR traz os artefatos da rodada, a última evidência de cada tipo, com os prints e o HTML", () => {
  const html = pagina({
    ...dadosDaPagina(),
    rodadas: [
      { ref: "I-206.R1", titulo: "r", estado: "gate_pr", ticket_atual_por_etapa: { encerrar_rodada: "I-206.T3" } },
    ],
    tickets: [
      {
        ref: "I-206.T1",
        rodada: "I-206.R1",
        etapa: "revisar_rodada",
        estado: "concluido",
        satisfaz_dependencia: true,
        elegivel: false,
      },
      {
        ref: "I-206.T2",
        rodada: "I-206.R1",
        etapa: "revisar_rodada",
        estado: "concluido",
        satisfaz_dependencia: true,
        elegivel: false,
      },
      {
        ref: "I-206.T3",
        rodada: "I-206.R1",
        etapa: "encerrar_rodada",
        estado: "em_execucao",
        satisfaz_dependencia: false,
        elegivel: false,
      },
      { ref: "I-206.T4", etapa: "planejar", estado: "concluido", satisfaz_dependencia: true, elegivel: false },
    ],
    evidencias: [
      { tipo: "plano", em: EM, ticket: "I-206.T4", dados: {}, anexos: [] },
      {
        tipo: "comprovacao_criterios",
        em: EM,
        ticket: "I-206.T1",
        dados: { criterios: [{ atendido: false }] },
        anexos: [],
      },
      {
        tipo: "comprovacao_criterios",
        em: EM,
        ticket: "I-206.T2",
        dados: { criterios: [{ atendido: true }] },
        anexos: [{ nome: "ca-1.png", classe: "imagem", mime: "x/y", bytes: 1, link: "/a/1" }],
      },
      {
        tipo: "aula_codigo",
        em: EM,
        ticket: "I-206.T3",
        dados: {},
        anexos: [{ nome: "aula.html", classe: "html", mime: "x/y", bytes: 1, link: "/a/2" }],
      },
    ],
  });
  const gate = html.slice(html.indexOf('id="pr-I-206.R1"'), html.indexOf("Reprovação do PR"));
  assert.match(gate, /<div class="titulo-bloco">Artefatos<\/div><div class="dm-chips">/);
  assert.match(gate, /data-evidencia="Comprovação dos critérios · I-206\.T2">Critérios 1\/1</);
  assert.doesNotMatch(gate, /Critérios 0\/1/);
  assert.match(gate, /data-imagem="ca-1\.png"/);
  assert.match(gate, /data-html="\/a\/2" data-nome="Aula do código">Aula do código · HTML</);
  assert.doesNotMatch(gate, /Plano/);
  // Sem evidência na rodada, o gate não ganha um bloco vazio.
  const vazio = pagina({
    ...dadosDaPagina(),
    rodadas: [{ ref: "I-206.R1", titulo: "r", estado: "gate_pr", ticket_atual_por_etapa: {} }],
  });
  assert.doesNotMatch(vazio, />Artefatos</);
});

test("o gate do planejamento traz o último plano, e não as evidências de outros tickets", () => {
  const html = pagina({
    ...dadosDaPagina(),
    demanda: { ...dadosDaPagina().demanda, estado: "gate_planejamento" },
    tickets: [
      {
        ref: "I-206.T1",
        etapa: "entender_e_desenhar",
        estado: "concluido",
        satisfaz_dependencia: true,
        elegivel: false,
      },
      { ref: "I-206.T2", etapa: "planejar", estado: "concluido", satisfaz_dependencia: true, elegivel: false },
      { ref: "I-206.T3", etapa: "planejar", estado: "concluido", satisfaz_dependencia: true, elegivel: false },
    ],
    evidencias: [
      { tipo: "plano", em: EM, ticket: "I-206.T2", dados: { versao: "antiga" }, anexos: [] },
      { tipo: "plano", em: EM, ticket: "I-206.T3", dados: { versao: "nova" }, anexos: [] },
      { tipo: "comportamento", em: EM, ticket: "I-206.T1", dados: {}, anexos: [] },
    ],
  });
  const gate = html.slice(html.indexOf('id="gate"'), html.indexOf("</textarea>"));
  assert.match(gate, /data-evidencia="Plano · I-206\.T3">Plano</);
  assert.match(gate, /nova/);
  assert.doesNotMatch(gate, /antiga|Comportamento/);
});

test("a sessão de ajustes leva ao chat da sessão do ticket e conclui pela página (CA-10)", () => {
  const rodadas = [
    {
      ref: "I-206.R1",
      titulo: "r",
      estado: "ajustar_resultado" as const,
      ticket_atual_por_etapa: { ajustar_resultado: "I-206.T3" },
    },
  ];
  const ticket = {
    ref: "I-206.T3",
    etapa: "ajustar_resultado" as const,
    estado: "aberto" as const,
    satisfaz_dependencia: false,
    elegivel: false,
    rodada: "I-206.R1",
  };
  const html = pagina({ ...dadosDaPagina({ tickets: [{ ...ticket, sessao: "s/3" }] }), rodadas });
  const secao = html.slice(html.indexOf('<div id="ajustes-I-206.R1">'));
  assert.match(secao, /Sessão de ajustes de I-206\.R1/);
  assert.match(secao, /<a class="btn btn-grande btn-primario" href="\/sessions\/s%2F3">Abrir a sessão →<\/a>/);
  assert.match(secao, /data-acao="concluir" data-caminho="\/api\/demandas\/rodadas\/I-206\.R1\/ajustes\/concluir"/);
  assert.doesNotMatch(secao, /<textarea/);

  const semSessao = pagina({ ...dadosDaPagina({ tickets: [ticket] }), rodadas });
  assert.match(semSessao, /A conversa começa quando o pi da sessão sobe/);
  assert.doesNotMatch(semSessao, /Abrir a sessão/);
});

test("o quadro só linka o PR da rodada quando a URL é http(s)", () => {
  const d = (url: string) => ({
    ...demanda("I-206"),
    rodadas: [{ ref: "I-206.R1", estado: "gate_pr" as const, pr: { id: "7", url } }],
  });
  assert.match(quadro({ demandas: [d("https://x/7")], trabalho: [] }), /href="https:\/\/x\/7"/);
  assert.doesNotMatch(quadro({ demandas: [d("javascript:x")], trabalho: [] }), /javascript/);
});

test("o ticket em falha traz a instrução e Reabrir; o aberto elegível traz Executar agora (CA-17, CA-24 a CA-26)", () => {
  const com = (estado: "falhou" | "aberto" | "concluido", elegivel = true) =>
    pagina({
      ...dadosDaPagina(),
      tickets: [
        {
          ref: "I-206.T3",
          etapa: "implementar",
          estado,
          satisfaz_dependencia: estado === "concluido",
          elegivel,
        },
      ],
    });
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
  const html = pagina(
    dadosDaPagina({ dependentes: [{ demanda_id: "I-207", titulo: "Dep <b>", estado: "em_execucao" }] }),
  );
  assert.match(html, /data-demanda="abrir-cancelar"[^>]*>Cancelar a demanda/);
  assert.match(html, /data-confirmar-cancelar hidden>[\s\S]*href="\/demandas\/I-207">I-207<\/a> Dep &#60;b&#62;/);
  assert.match(html, /dm-gate-perigo" data-confirmar-cancelar hidden><span class="dm-gate-titulo">Cancelar I-206</);
  assert.match(html, /data-demanda="cancelar" data-caminho="\/api\/demandas\/I-206\/cancelar"/);
  assert.match(pagina(dadosDaPagina()), /Nenhuma outra demanda depende desta/);
});

test("Arquivar só na demanda concluída; cancelada e arquivada não têm ação (CA-29)", () => {
  const com = (estado: PaginaDaDemanda["demanda"]["estado"]) =>
    pagina(dadosDaPagina({ demanda: demandaNoEstado(estado) }));
  assert.match(com("concluida"), /data-demanda="arquivar" data-caminho="\/api\/demandas\/I-206\/arquivar"/);
  assert.doesNotMatch(com("concluida"), /Cancelar a demanda/);
  assert.doesNotMatch(com("cancelada"), /data-demanda/);
  assert.doesNotMatch(com("arquivada"), /data-demanda/);
});

test("o cartão de demanda cancelada não diz que aguarda a decisão do Auditor", () => {
  const html = quadro({
    demandas: [
      demanda("I-206", { estado: "cancelada", terminal: true, rodadas: [{ ref: "I-206.R1", estado: "gate_pr" }] }),
    ],
    trabalho: [],
  });
  assert.doesNotMatch(html, /aguarda você/);
});
