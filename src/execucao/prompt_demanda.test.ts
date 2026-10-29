import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { EtapaTicket } from "../dominio/primitivos.ts";
import { montarPromptDemanda } from "./prompt_demanda.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const NOVAS = EtapaTicket.options.filter((e) => e !== "demanda");

const ag = {
  demanda: { id: "I-206", titulo: "Busca", tipo: "problema", descricao: "A busca demora.", fase: "execucao" },
  tickets: [],
  decisoes: [],
  evidencias: [
    {
      demanda_id: "I-206",
      tipo: "criterios_aceite",
      em: AGORA,
      dados: {
        criterios: [
          { id: "CA-1", dado: "a", quando: "b", entao: "c" },
          { id: "CA-2", dado: "d", quando: "e", entao: "f" },
        ],
      },
    },
  ],
  rodadas: [{ demanda_id: "I-206", rodada_id: 2, titulo: "Índice", fase: "desenvolvimento", e2e: false, branch: "x" }],
  dependencias_rodada: [],
  criterios_citados: [{ demanda_id: "I-206", rodada_id: 2, criterio_id: "CA-2" }],
  dependencias_ticket: [{ demanda_id: "I-206", ticket_id: 3, depende_ticket_id: 1 }],
  caminhos_ticket: [{ demanda_id: "I-206", ticket_id: 3, caminho: "src/a.ts" }],
} as unknown as AgregadoDemanda;

const ticket = (etapa: string, campos: Partial<TicketDemanda> = {}) =>
  ({
    demanda_id: "I-206",
    ticket_id: 3,
    rodada_id: 2,
    titulo: "Fazer",
    descricao: "Detalhe.",
    etapa,
    ...campos,
  }) as TicketDemanda;
const base = { ag, projeto: { nome: "loja", branch_base: "main" }, worktree: "/w", saida: "/s", anexos: [] };
const montar = (
  etapa: string,
  campos: Partial<TicketDemanda> = {},
  retomada?: Parameters<typeof montarPromptDemanda>[0]["retomada"],
) => montarPromptDemanda({ ...base, ticket: ticket(etapa, campos), retomada });

test("as oito etapas montam com contexto da demanda, da rodada, do ticket e o modo próprio (CA-1)", () => {
  for (const etapa of NOVAS) {
    const p = montar(etapa);
    for (const trecho of [
      "I-206, Busca",
      "I-206.R2, Índice",
      "I-206.T3, Fazer",
      readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8").split("\n", 1)[0] ?? "",
    ])
      assert.ok(p.includes(trecho), `${etapa}: ${trecho}`);
  }
  const p = montar("implementar");
  assert.ok(p.includes("**CA-2**") && p.includes("I-206.T1") && p.includes("`src/a.ts`"));
  assert.match(montar("planejar", { rodada_id: undefined }), /não tem rodada/);
});

test("implementar e resolver_conflito não fazem commit nem PR (CA-2)", () => {
  for (const etapa of ["implementar", "resolver_conflito"])
    assert.match(montar(etapa), /não faz commit nem PR por conta própria/);
});

test("planejar é interativa e permite perguntar ao Auditor (CA-11)", () => {
  assert.match(montar("planejar"), /interativa.*perguntar a ele antes de submeter o plano/s);
});

test("devolução e reabertura trazem o motivo (CA-7)", () => {
  assert.match(
    montar("implementar", {}, { tipo: "devolucao", motivo: "testes falharam" }),
    /## Devolução[\s\S]*Motivo: testes falharam/,
  );
  assert.match(
    montar("implementar", {}, { tipo: "reabertura", motivo: "faltou X" }),
    /## Reabertura[\s\S]*Motivo: faltou X/,
  );
  assert.ok(!montar("implementar").includes("Motivo:"));
});

test("seção de evidências e skills vêm do catálogo", () => {
  const p = montar("revisar_rodada");
  assert.ok(
    p.includes("`explicacao_fitness`") &&
      p.includes("A Fabriquinha produz") &&
      p.includes("artefato-comprovacao-criterios"),
  );
  assert.ok(montar("encerrar_rodada").includes("`video_demonstracao` (opcional)"));
  const vazia = montar("sessao_em_aberto");
  assert.ok(vazia.includes("não tem evidência do agente") && vazia.includes("não produz evidência"));
  assert.match(vazia, /ticket corretivo da rodada I-206\.R2[^]*antes de concluir/);
  assert.ok(!vazia.includes("descartadas"));
});

test("ticket 3 da I-206 na rodada 2 só usa os endereços públicos (CA-10)", () => {
  for (const etapa of NOVAS) {
    const md = readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8");
    for (const texto of [montar(etapa), md]) {
      assert.doesNotMatch(texto, /\bT-\d|(?<![.\w])R\d/);
      assert.doesNotMatch(texto, /fabriquinha (ticket|issue|rodada)/);
    }
    assert.ok(montar(etapa).includes("I-206.T3"));
  }
});

test("etapa sem modo de trabalhar recusa nomeando a etapa (CA-9)", () => {
  assert.throws(
    () => montar("demanda"),
    (e: Error) => e.constructor === Error && e.message.includes("demanda"),
  );
});

test("sem critérios, citações, título, descrição, dependências nem caminhos, cada seção diz que está vazia", () => {
  const vazio = {
    ...ag,
    demanda: { ...ag.demanda, descricao: "" },
    evidencias: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
  };
  const p = montarPromptDemanda({
    ...base,
    ag: vazio,
    ticket: ticket("implementar", { titulo: undefined, descricao: undefined }),
  });
  assert.ok(p.includes("sem título") && p.includes("(vazio)") && p.includes("(nenhum)") && p.includes("(nenhuma)"));
});

test("as revisões pedem revisao decidir do próprio ticket como último passo (CA-1)", () => {
  const rodada = montar("revisar_rodada");
  assert.match(rodada, /fabriquinha revisao decidir I-206\.T3 aprovar/);
  assert.match(rodada, /fabriquinha revisao decidir I-206\.T3 reprovar --motivo <texto> --correcoes/);
  const demanda = montar("revisar_demanda");
  assert.match(demanda, /fabriquinha revisao decidir I-206\.T3 aprovar/);
  assert.match(demanda, /fabriquinha revisao decidir I-206\.T3 reprovar --motivo <texto> --plano/);
  assert.ok(!demanda.includes("--correcoes") && !rodada.includes("--plano"));
});

test("cada etapa recebe o que só ela lê: o desenho no planejar, o diff e a matriz no revisar_rodada, os não previstos e o impacto no encerrar_rodada", () => {
  const evidencia = (tipo: string, dados: object, ticket_id?: number) => ({
    demanda_id: "I-206",
    tipo,
    em: AGORA,
    dados,
    ticket_id,
  });
  const desenho = {
    resumo: "Índice invertido.",
    arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "o índice" }],
  };
  const linha = { descricao: "camadas", comando: "npm run fitness", duracaoMs: 1 };
  const comEvidencias = {
    ...ag,
    tickets: [
      { ticket_id: 4, rodada_id: 2, etapa: "revisar_rodada", status: "concluido" },
      { ticket_id: 5, rodada_id: 2, etapa: "revisar_rodada", status: "concluido" },
      { ticket_id: 6, rodada_id: 9, etapa: "revisar_rodada", status: "concluido" },
    ],
    evidencias: [
      evidencia("desenho_solucao", { ...desenho, foraDeEscopo: ["o ranking"] }),
      evidencia(
        "matriz_fitness",
        {
          linhas: [
            { ...linha, nome: "camadas", codigoSaida: 1, estourou: false, log: "camadas.log" },
            { ...linha, nome: "ciclos", codigoSaida: null, estourou: true, log: "ciclos.log" },
          ],
        },
        3,
      ),
      evidencia(
        "arquivos_alterados",
        {
          arquivos: [
            { caminho: "src/b.ts", previsto: null },
            { caminho: "src/a.ts", previsto: "src/a.ts" },
          ],
        },
        4,
      ),
      evidencia(
        "arquivos_alterados",
        {
          arquivos: [
            { caminho: "src/a.ts", status: "M", adicionadas: 2, removidas: 1, previsto: "src/**" },
            { caminho: "logo.png", status: "A", adicionadas: null, removidas: null, previsto: null },
          ],
          previstosNaoTocados: ["src/c.ts"],
        },
        3,
      ),
    ],
  } as unknown as AgregadoDemanda;
  const anexo = (nome: string, tipo: string, ticket_id?: number) => ({
    nome,
    tipo,
    ticket_id,
    caminho: `/raiz/arquivos/${nome}`,
    mime: "text/plain",
    bytes: 1,
    sha256: "0",
  });
  const anexos = [
    anexo("d.html", "desenho_solucao"),
    anexo("camadas.log", "matriz_fitness", 3),
    anexo("outro.log", "matriz_fitness", 8),
  ];
  const montarCom = (agregado: AgregadoDemanda, etapa: string, rodada_id = 2) =>
    montarPromptDemanda({ ...base, ag: agregado, anexos, ticket: ticket(etapa, { rodada_id }) });

  const planejar = montarCom(comEvidencias, "planejar");
  for (const trecho of [
    "## Desenho aprovado",
    "Índice invertido.",
    "- `src/a.ts` (criar): o índice",
    "- o ranking",
    "- `d.html`: `/raiz/arquivos/d.html`",
  ])
    assert.ok(planejar.includes(trecho), trecho);
  assert.ok(!planejar.includes("## Matriz de fitness functions"));
  const semForaDeEscopo = {
    ...comEvidencias,
    evidencias: [evidencia("desenho_solucao", { ...desenho, foraDeEscopo: [] })],
  };
  assert.match(montarCom(semForaDeEscopo as unknown as AgregadoDemanda, "planejar"), /Fora de escopo:\n\n\(nada\)/);
  assert.match(montar("planejar"), /## Desenho aprovado\n\n\(vazio\)/);

  const revisar = montarCom(comEvidencias, "revisar_rodada");
  assert.match(revisar, /- \*\*camadas\*\* \(camadas\): `npm run fitness` saiu com código 1; log `camadas\.log`/);
  assert.match(revisar, /- \*\*ciclos\*\* \(camadas\): `npm run fitness` estourou o tempo; log `ciclos\.log`/);
  assert.ok(revisar.includes("- `camadas.log`: `/raiz/arquivos/camadas.log`") && !revisar.includes("outro.log"));
  assert.match(revisar, /- `src\/a\.ts` \(M, \+2 −1\): src\/\*\*\n- `logo\.png` \(A, binário\): não previsto/);
  assert.match(revisar, /não tocou:\n\n- `src\/c\.ts`/);
  assert.match(montar("revisar_rodada"), /execução:\n\n\(nenhuma\)[\s\S]*você lê:\n\n\(nenhum\)/);
  assert.match(
    montar("revisar_rodada"),
    /casou:\n\n\(nenhum\)\n\nCaminhos do plano que a rodada não tocou:\n\n\(nenhum\)/,
  );

  // A última revisão concluída da rodada (T5) não tem arquivos_alterados: não sobra nada a explicar.
  assert.match(
    montarCom(comEvidencias, "encerrar_rodada"),
    /## Arquivos não previstos[\s\S]*mensagem do PR:\n\n\(nenhum\)/,
  );
  const soT4 = { ...comEvidencias, tickets: comEvidencias.tickets.filter((t) => t.ticket_id === 4) };
  assert.match(montarCom(soT4, "encerrar_rodada"), /mensagem do PR:\n\n- `src\/b\.ts`\n/);
  assert.match(montar("encerrar_rodada"), /mensagem do PR:\n\n\(nenhum\)/);

  // O impacto vem do relatório da própria demanda: só o que não é baixo exige reversão.
  const comImpacto = (impacto: string) =>
    ({ ...ag, evidencias: [evidencia("relatorio_impactos_arquitetura", { impacto })] }) as unknown as AgregadoDemanda;
  assert.match(
    montarCom(comImpacto("medio"), "encerrar_rodada"),
    /## Impacto na arquitetura\n\nmedio: escreva em `reversao` da mensagem do PR como desfazer a mudança\./,
  );
  assert.match(montarCom(comImpacto("baixo"), "encerrar_rodada"), /baixo: `reversao` é opcional/);
  assert.match(montar("encerrar_rodada"), /a demanda não tem relatório de impactos: `reversao` é opcional/);
});
