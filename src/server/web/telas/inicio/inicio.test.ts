import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricasDoMes } from "../../../contrato/metricas.ts";
import type { TipoPendencia } from "../../../../modulos/sdlc/nucleo/demanda/pendencia.ts";
import type { PendenciaDoInicio } from "../../../contrato/demanda.ts";
import type { CartaoDoBoard, DadosDoInicio, SessaoRodando } from "../../../contrato/inicio.ts";
import type { MotivoDeRecusaEmJson } from "../../../contrato/despacho.ts";
import { inicio, ROTULO_DO_TIPO_DE_PENDENCIA, textoDoMotivoDeRecusa } from "./inicio.ts";
import { descreverEtapasDoSdlc } from "../../../consultas/etapas.ts";
import { definirEtapasDoSdlc } from "../../apresentacao/etapas.ts";

definirEtapasDoSdlc(descreverEtapasDoSdlc());

const agora = Date.parse("2026-10-28T12:00:00.000Z");
const mes = {
  mes: "2026-10",
  projeto: null,
  total: {
    execucoes: 1,
    falhas: 0,
    duracaoMs: 0,
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, total: 0 },
    custo: { conhecido: 0, trabalhosSemCusto: 0 },
    textoDoCusto: "US$ 0,00",
    modelos: [],
  },
  demandas: { registradas: 0, concluidas: 0 },
  tickets: { criados: 0, concluidos: 0 },
  prs: { abertos: 0, mergeados: 0 },
} as unknown as MetricasDoMes;

const dados = (resto: Partial<DadosDoInicio> = {}): DadosDoInicio => ({
  mes,
  aguarda: [],
  rodando: [],
  quantidadeEmAndamento: 0,
  board: [],
  ...resto,
});

const pendencia = (tipo: TipoPendencia, resto: Partial<PendenciaDoInicio> = {}): PendenciaDoInicio => ({
  tipo,
  item: "I-206",
  motivo: `motivo de ${tipo}`,
  acao_esperada: "decidir_gate",
  demanda: "I-206",
  projeto: "loja",
  titulo: "Busca <rápida>",
  desde: "2026-10-28T11:15:00.000Z",
  ...resto,
});

const sessao = (resto: Partial<SessaoRodando> = {}): SessaoRodando => ({
  sessao: "s1",
  projeto: "loja",
  demanda: "I-206",
  titulo: "Busca",
  rodada: "I-206.R2",
  ticket: "I-206.T3",
  etapa: "implementar",
  modo: "autonomo",
  estado: "rodando",
  desde: "2026-10-28T11:59:30.000Z",
  inicio: "2026-10-28T11:00:00.000Z",
  resultado: "concluida",
  ...resto,
});

const cartao = (resto: Partial<CartaoDoBoard> = {}): CartaoDoBoard => ({
  coluna: "implementar",
  ref: "I-206.R2",
  demanda: "I-206",
  projeto: "loja",
  titulo: "Busca",
  outros: 0,
  bloqueios: [],
  ...resto,
});

/** O HTML de uma coluna do board, pelo nome dela. */
const coluna = (html: string, nome: string): string =>
  html.split(/<div class="coluna(?: coluna-gate)?">/).find((c) => c.includes(`coluna-cabeca">${nome} <`)) ?? "";

test("sem nada em andamento: a frase do mês, nada aguarda, nada roda e as 11 colunas vazias sob as 5 etapas", () => {
  const html = inicio(dados(), agora, []);
  assert.match(html, /<h1>Início<\/h1>/);
  assert.doesNotMatch(html, /Registrar necessidade/);
  assert.match(html, /<p class="frase-mes">Outubro de 2026, todos os projetos:/);
  assert.match(html, /Aguarda você<\/h2><\/div>\s*<p class="muted vazio">Nada aguarda você agora\.<\/p>/);
  assert.match(html, /Rodando<\/h2><span class="muted">0<\/span>[\s\S]*Nenhuma sessão rodando\./);
  assert.match(html, /Board<\/h2><span class="muted">0 demandas em andamento<\/span>/);
  assert.deepEqual(
    [...html.matchAll(/<div class="etapa" style="grid-column: span (\d+)">(\w+)<\/div>/g)].map(
      (m) => `${String(m[2])}:${String(m[1])}`,
    ),
    ["Registrar:2", "Planejar:2", "Implementar:1", "Revisar:1", "Encerrar:5"],
  );
  assert.deepEqual(
    [
      ...html.matchAll(/<div class="coluna-cabeca">([^<]+) <span class="n">0<\/span>( <span class="tag tag-gate">)?/g),
    ].map((m) => `${String(m[1])}${m[2] ? " (gate)" : ""}`),
    [
      "Registro",
      "Aprovação da demanda (gate)",
      "Planejamento",
      "Aprovação do planejamento (gate)",
      "Desenvolvimento",
      "Revisão da rodada",
      "Encerramento da rodada",
      "Aprovação do PR (gate)",
      "Ajustes do PR",
      "Revisão da demanda",
      "Encerramento da demanda",
    ],
  );
  assert.equal(html.match(/coluna-vazia">vazia/g)?.length, 11);
  assert.equal(html.match(/class="coluna coluna-gate"/g)?.length, 3);
});

test("aguarda você: o contador, o título, o botão, o motivo e o rodapé de cada Pendência, na ordem que veio", () => {
  const html = inicio(
    dados({
      aguarda: [
        pendencia("gate_humano"),
        pendencia("gate_humano", { item: "I-206.R1", rodada: "I-206.R1" }),
        pendencia("item_bloqueado", { item: "I-206.T3", rodada: "I-206.R2", motivo: "serviço reiniciado" }),
        pendencia("dialogo_do_agente", { item: "I-206.T4", sessao: "s/1", motivo: "O agente pergunta: Qual ordem?" }),
        pendencia("revisao_parada", { motivo: "A revisão integral foi rejeitada" }),
        pendencia("acao_externa", { motivo: "Integrar o PR final #9 na plataforma" }),
        pendencia("despacho_parado", { item: "I-206.T5" }),
      ],
    }),
    agora,
    [],
  );
  assert.match(html, /<span class="contador">7<\/span><span class="muted">da mais antiga para a mais nova<\/span>/);
  const cartoes = html.split('<a class="decisao').slice(1);
  const rotulo = (c: string) => /decisao-motivo">([^<]+)<\/span><span class="([^"]+)">([^<]+)</.exec(c)?.slice(1);
  assert.deepEqual(cartoes.map(rotulo), [
    ["Gate", "btn btn-primario btn-pequeno", "Decidir →"],
    ["Gate", "btn btn-primario btn-pequeno", "Decidir →"],
    ["Bloqueado", "btn btn-pequeno", "Reabrir o ticket →"],
    ["Diálogo do agente", "btn btn-primario btn-pequeno", "Responder →"],
    ["Revisão parada", "btn btn-pequeno", "Ver a demanda →"],
    ["Ação externa", "btn btn-primario btn-pequeno", "Integrar o PR →"],
    ["Despacho parado", "btn btn-primario btn-pequeno", "Executar →"],
  ]);
  assert.deepEqual(
    cartoes.map((c) => /decisao-texto">([^<]*)</.exec(c)?.[1]),
    [
      "motivo de gate_humano",
      "motivo de gate_humano",
      "serviço reiniciado",
      "O agente pergunta: Qual ordem?",
      "A revisão integral foi rejeitada",
      "Integrar o PR final #9 na plataforma",
      "motivo de despacho_parado",
    ],
  );
  // Só o diálogo do agente se responde no chat; o resto se decide na página da demanda.
  assert.deepEqual(
    cartoes.map((c) => /^[^"]*" href="([^"]+)"/.exec(c)?.[1]),
    [...Array<string>(3).fill("/demandas/I-206"), "/sessions/s%2F1", ...Array<string>(3).fill("/demandas/I-206")],
  );
  assert.match(String(cartoes[2]), /^ superficie falha"/);
  assert.match(String(cartoes[4]), /^ superficie falha"/);
  assert.match(String(cartoes[0]), /^ superficie"/);
  assert.match(String(cartoes[0]), /<span class="id">I-206<\/span> Busca &#60;rápida&#62;/);
  assert.match(String(cartoes[1]), /<span class="id">I-206\.R1<\/span>/);
  // O rodapé cita o ticket quando o item é um; senão, só o projeto e há quanto tempo.
  assert.match(
    String(cartoes[2]),
    /<span class="tag">loja<\/span><span><span class="mono">I-206\.T3<\/span> · há 45\u00a0min</,
  );
  assert.match(String(cartoes[0]), /<span class="tag">loja<\/span><span>há 45\u00a0min<\/span>/);
});

test("os rótulos cobrem os seis tipos de Pendência, sem repetir título", () => {
  const rotulos = Object.values(ROTULO_DO_TIPO_DE_PENDENCIA);
  assert.equal(rotulos.length, 6);
  assert.equal(new Set(rotulos.map((r) => r.titulo)).size, 6);
});

test("rodando: a linha da sessão com o modo, o que o agente faz, o ticket, o modelo e há quanto tempo", () => {
  const html = inicio(
    dados({
      rodando: [
        sessao({ fazendo: "lendo src/<a>.ts", modelo: { provedor: "anthropic", nome: "claude-opus-4-5" } }),
        sessao({ sessao: "s2", modo: "interativo" }),
      ],
    }),
    agora,
    [],
  );
  assert.match(html, /Rodando<\/h2><span class="muted">2<\/span>/);
  const [primeira, segunda] = html.split('<a class="rodando-linha"').slice(1);
  assert.match(String(primeira), /^ href="\/sessions\/s1">/);
  assert.match(String(primeira), /pill-rodando">autônoma<\/span>\s*<span class="id">I-206<\/span>/);
  assert.match(String(primeira), /Busca <span class="muted">— lendo src\/&#60;a&#62;\.ts<\/span>/);
  assert.match(String(primeira), /<span class="mono">I-206\.T3<\/span> · implementação<\/span>/);
  assert.match(String(primeira), /title="anthropic \/ claude-opus-4-5"/);
  assert.match(String(primeira), /tempo muted">há menos\u00a0de\u00a01\u00a0min</);
  assert.match(String(segunda), /pill-rodando">interativa<\/span>/);
  assert.match(String(segunda), /— Implementação<\/span>/);
  assert.match(String(segunda), /title="padrão do pi"/);
});

const MOTIVOS_E_TEXTOS: [MotivoDeRecusaEmJson, string][] = [
  [{ tipo: "limite_de_paralelismo", em_uso: 4, limite: 4 }, "Limite de paralelismo cheio: 4 de 4 em uso"],
  [{ tipo: "dependencia_pendente", aguarda: ["I-1.T1", "I-2.R1"] }, "Aguarda I-1.T1, I-2.R1"],
  [{ tipo: "gate_aguardando", gate: "gate_pr" }, "Aguarda a aprovação do PR"],
  [{ tipo: "ocupado", por: "I-3.T2" }, "Ocupado por I-3.T2"],
  [{ tipo: "bloqueado", motivo: "Tentativas esgotadas" }, "Bloqueado: Tentativas esgotadas"],
  [{ tipo: "aguarda_acao_externa" }, "Aguarda o merge do PR na plataforma"],
  [{ tipo: "gate_aguardando", gate: "gate_demanda" }, "Aguarda a aprovação da demanda"],
  [{ tipo: "gate_aguardando", gate: "gate_planejamento" }, "Aguarda a aprovação do planejamento"],
  [{ tipo: "gate_aguardando", gate: "gate_revisao_rodada" }, "Aguarda a revisão da rodada"],
  [{ tipo: "gate_aguardando", gate: "gate_revisao_demanda" }, "Aguarda a revisão da demanda"],
];

test("o texto de cada motivo de recusa", () => {
  assert.deepEqual(
    MOTIVOS_E_TEXTOS.map(([motivo]) => textoDoMotivoDeRecusa(motivo)),
    MOTIVOS_E_TEXTOS.map(([, texto]) => texto),
  );
});

test("rodando: cada item parado mostra o ticket e o motivo, escapado, e leva à demanda", () => {
  const html = inicio(dados(), agora, [
    { item: "I-206.T5", motivo: { tipo: "limite_de_paralelismo", em_uso: 2, limite: 2 } },
    { item: "I-207.T1", motivo: { tipo: "bloqueado", motivo: "falhou <b>" } },
  ]);
  const [limite, bloqueado] = html.split('<a class="rodando-linha"').slice(1);
  assert.match(String(limite), /^ href="\/demandas\/I-206">/);
  assert.match(String(limite), /pill-neutro">parado<\/span>\s*<span class="id">I-206<\/span>/);
  assert.match(
    String(limite),
    /<span class="mono">I-206\.T5<\/span> — Limite de paralelismo cheio: 2 de 2 em uso<\/span>/,
  );
  assert.match(String(bloqueado), /href="\/demandas\/I-207"/);
  assert.match(String(bloqueado), /— Bloqueado: falhou &#60;b&#62;<\/span>/);
});

test("board: o cartão na coluna do estado, com o ticket em curso e as marcas de execução, espera e bloqueio", () => {
  const html = inicio(
    dados({
      quantidadeEmAndamento: 2,
      aguarda: [
        pendencia("item_bloqueado", { item: "I-206.T3", rodada: "I-206.R2" }),
        pendencia("gate_humano", { item: "I-206.R1", rodada: "I-206.R1" }),
      ],
      rodando: [sessao()],
      board: [
        cartao({
          ticket: { ref: "I-206.T3", etapa: "implementar", estado: "em_execucao", modo: "autonomo", pi_ativo: true },
          outros: 1,
        }),
        cartao({ coluna: "gate_pr", ref: "I-206.R1" }),
        cartao({
          coluna: "gate_demanda",
          ref: "I-207",
          demanda: "I-207",
          titulo: "Cache",
          ticket: { ref: "I-207.T1", etapa: "entender_e_desenhar", estado: "aberto" },
          bloqueios: ["I-206", "I-205"],
        }),
        cartao({ coluna: "revisar_demanda", ref: "I-209", demanda: "I-209" }),
      ],
    }),
    agora,
    [],
  );
  assert.match(html, /2 demandas em andamento/);
  const desenvolvimento = coluna(html, "Desenvolvimento");
  assert.match(desenvolvimento, /<span class="n">1<\/span>/);
  assert.match(desenvolvimento, /<a class="cartao rodando aguarda" href="\/demandas\/I-206">/);
  assert.match(desenvolvimento, /<span class="id">I-206\.R2<\/span><span class="tag">loja<\/span>/);
  assert.match(
    desenvolvimento,
    /<div class="cartao-ticket"><span class="mono">I-206\.T3<\/span> implementação · autônoma · sessão pi ativa \(\+1\)<\/div>/,
  );
  assert.match(
    desenvolvimento,
    /<span class="pill pill-rodando"><span>em execução · menos de 1\u00a0min<\/span><\/span><span class="pill pill-falha"><span>aguarda você · bloqueado<\/span>/,
  );
  const pr = coluna(html, "Aprovação do PR");
  assert.match(pr, /<a class="cartao aguarda"/);
  assert.match(pr, /<span class="pill pill-aguarda"><span>aguarda você · gate<\/span>/);
  assert.doesNotMatch(pr, /cartao-ticket/);
  const gate = coluna(html, "Aprovação da demanda");
  assert.match(gate, /<a class="cartao bloqueada" href="\/demandas\/I-207">/);
  assert.match(gate, /I-207\.T1<\/span> demanda · aberto<\/div>/);
  assert.match(
    gate,
    /<span class="pill pill-neutro"><span>bloqueada por <span class="mono">I-206<\/span>, <span class="mono">I-205<\/span><\/span>/,
  );
  // O endereço no título do cartão não quebra no hífen.
  assert.match(
    inicio(dados({ board: [cartao({ titulo: "Corrigir I-206.R1 & I-7" })] }), agora, []),
    /cartao-titulo">Corrigir <span class="endereco">I-206\.R1<\/span> &#38; <span class="endereco">I-7<\/span><\/div>/,
  );
  const revisao = coluna(html, "Revisão da demanda");
  assert.match(revisao, /<a class="cartao" href="\/demandas\/I-209">/);
  assert.doesNotMatch(revisao, /cartao-marcas/);
  assert.equal(html.match(/coluna-vazia/g)?.length, 7);
});
