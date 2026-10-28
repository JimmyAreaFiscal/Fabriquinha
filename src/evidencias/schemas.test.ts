import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z, ZodError } from "zod";
import { type Agregado, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { type SchemaEvidencia, schemaDe, schemaDeEtapa, simbolosDe, type TipoSchemaEtapa } from "./schemas.ts";

/** O que `fabriquinha evidencia schema <tipo>` publica: o JSON Schema de `dados` e as regras de arquivo. */
const publicado = ({ dados, arquivos }: SchemaEvidencia) => ({
  dados: z.toJSONSchema(dados, { io: "input" }),
  arquivos,
});
const jsonSchemaDe = (tipo: TipoEvidencia) => publicado(schemaDe(tipo));
const jsonSchemaDeEtapa = (tipo: TipoSchemaEtapa) => publicado(schemaDeEtapa(tipo));

const caminhos = (erro: unknown) => (erro as ZodError).issues.map((i) => i.path.join("."));

/** Os caminhos dos campos recusados, ou `[]` se `dados` é válido para o tipo. */
const recusados = (tipo: TipoEvidencia, dados: unknown): string[] => {
  const r = schemaDe(tipo).dados.safeParse(dados);
  return r.success ? [] : caminhos(r.error);
};

const CRITERIO = { id: "CA-1", dado: "um usuário", quando: "entra", entao: "vê o painel" };

test("comportamento: descrição e passos para reproduzir; um vídeo ou texto pelo menos", () => {
  assert.deepEqual(recusados("comportamento", { descricao: "lento", comoReproduzir: ["abrir"] }), []);
  assert.deepEqual(recusados("comportamento", { comoReproduzir: [] }), ["descricao", "comoReproduzir"]);
  assert.deepEqual(recusados("comportamento", { descricao: " ", comoReproduzir: [" "] }), [
    "descricao",
    "comoReproduzir.0",
  ]);
  assert.deepEqual(recusados("comportamento", { descricao: "a".repeat(2001), comoReproduzir: ["x"] }), ["descricao"]);
  assert.deepEqual(schemaDe("comportamento").arquivos, { classes: ["video", "texto"], min: 1 });
});

test("criterios_aceite: critérios CA-n com dado, quando e então, sem id repetido; nenhum arquivo", () => {
  assert.deepEqual(recusados("criterios_aceite", { criterios: [CRITERIO, { ...CRITERIO, id: "CA-2" }] }), []);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [] }), ["criterios"]);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [{ ...CRITERIO, id: "ca-1", entao: "" }] }), [
    "criterios.0.id",
    "criterios.0.entao",
  ]);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [{ ...CRITERIO, quando: undefined }] }), [
    "criterios.0.quando",
  ]);
  assert.deepEqual(recusados("criterios_aceite", { criterios: [CRITERIO, CRITERIO] }), ["criterios"]);
  assert.deepEqual(schemaDe("criterios_aceite").arquivos, {
    classes: ["video", "imagem", "html", "texto"],
    min: 0,
    max: 0,
  });
});

test("o schema publicado traz o JSON Schema de dados (z.toJSONSchema) e as regras de arquivo", () => {
  const { dados, arquivos } = jsonSchemaDe("criterios_aceite");
  assert.deepEqual(arquivos, schemaDe("criterios_aceite").arquivos);
  assert.deepEqual(dados, z.toJSONSchema(schemaDe("criterios_aceite").dados, { io: "input" }));
  assert.deepEqual(dados.required, ["criterios"]);
  assert.equal(JSON.stringify(dados).includes(String.raw`"pattern":"^CA-\\d+$"`), true);
  assert.deepEqual(jsonSchemaDe("comportamento").dados.required, ["descricao", "comoReproduzir"]);
});

test("todo tipo do F3 §2 tem schema", () => {
  for (const tipo of TipoEvidencia.options) assert.ok(schemaDe(tipo).dados);
});

const RODADO = { comando: "npm test", codigoSaida: 0, estourou: false, duracaoMs: 12, log: "teste-1.log" };

test("execucao_testes e matriz_fitness: comandos rodados pelos coletores, com o log de cada um em texto", () => {
  assert.deepEqual(recusados("execucao_testes", { comandos: [RODADO, { ...RODADO, codigoSaida: null }] }), []);
  assert.deepEqual(recusados("execucao_testes", { comandos: [] }), ["comandos"]);
  assert.deepEqual(recusados("execucao_testes", { comandos: [{ ...RODADO, codigoSaida: 1.5, duracaoMs: -1 }] }), [
    "comandos.0.codigoSaida",
    "comandos.0.duracaoMs",
  ]);
  const linha = { nome: "camadas", descricao: "domínio sem I/O", ...RODADO };
  assert.deepEqual(schemaDe("matriz_fitness").dados.parse({ linhas: [linha] }), { linhas: [linha] });
  assert.deepEqual(recusados("matriz_fitness", { linhas: [] }), ["linhas"]);
  assert.deepEqual(recusados("matriz_fitness", { linhas: [{ ...linha, nome: "Camadas", estourou: undefined }] }), [
    "linhas.0.nome",
    "linhas.0.estourou",
  ]);
  for (const tipo of ["execucao_testes", "matriz_fitness"] as const) {
    assert.deepEqual(schemaDe(tipo).arquivos, { classes: ["texto"], min: 1 });
  }
});

const HTML_UNICO = { classes: ["html"], min: 1, max: 1 };
const PREVISTO = { caminho: "src/**/*.ts", acao: "alterar", motivo: "troca a consulta" };
const SOLUCAO = { resumo: "cache na busca", arquivosPrevistos: [PREVISTO] };

test("desenho_solucao: resumo, arquivos previstos com caminho relativo (glob) e fora de escopo; um HTML", () => {
  assert.deepEqual(schemaDe("desenho_solucao").dados.parse(SOLUCAO), { ...SOLUCAO, foraDeEscopo: [] });
  assert.deepEqual(recusados("desenho_solucao", { ...SOLUCAO, foraDeEscopo: ["pagamento"] }), []);
  assert.deepEqual(recusados("desenho_solucao", { ...SOLUCAO, arquivosPrevistos: [] }), ["arquivosPrevistos"]);
  assert.deepEqual(recusados("desenho_solucao", { arquivosPrevistos: [{ ...PREVISTO, acao: "editar", motivo: "" }] }), [
    "resumo",
    "arquivosPrevistos.0.acao",
    "arquivosPrevistos.0.motivo",
  ]);
  for (const caminho of ["/src/a.ts", "../fora.ts", "src/../../x", "a/..", "", "./src/a.ts", "src/./a.ts", "docs/"]) {
    assert.deepEqual(recusados("desenho_solucao", { ...SOLUCAO, arquivosPrevistos: [{ ...PREVISTO, caminho }] }), [
      "arquivosPrevistos.0.caminho",
    ]);
  }
  for (const caminho of ["src/a.ts", ".github/**", "src/**/x..y.ts", "docs/*.md", ".env"]) {
    assert.deepEqual(recusados("desenho_solucao", { ...SOLUCAO, arquivosPrevistos: [{ ...PREVISTO, caminho }] }), []);
  }
  assert.deepEqual(schemaDe("desenho_solucao").arquivos, HTML_UNICO);
  // A regra dos dotfiles do path.matchesGlob, que a descrição do campo ensina ao agente.
  assert.match(JSON.stringify(jsonSchemaDe("desenho_solucao").dados), /use o caminho explícito ou \.github\/\*\*/);
});

test("prototipo: descrição e como executar opcional; qualquer classe, com pelo menos um vídeo ou print", () => {
  assert.deepEqual(recusados("prototipo", { descricao: "tela nova" }), []);
  assert.deepEqual(recusados("prototipo", { descricao: "tela nova", comoExecutar: "npm run demo" }), []);
  assert.deepEqual(recusados("prototipo", { comoExecutar: "x".repeat(2001) }), ["descricao", "comoExecutar"]);
  assert.deepEqual(schemaDe("prototipo").arquivos, {
    classes: ["video", "imagem", "html", "texto"],
    min: 1,
    temClasse: { classes: ["video", "imagem"], mensagem: "protótipo precisa de pelo menos um vídeo ou print" },
  });
});

test("Big-O: a gramática do F3 com os exemplos válidos e recusados da spec", () => {
  const validos: Record<string, string[]> = {
    "O(1)": [],
    "O(log n)": ["n"],
    "O(n)": ["n"],
    "O(n log n)": ["n"],
    "O(n^2)": ["n"],
    "O(n + m)": ["n", "m"],
    "O(n*m)": ["n", "m"],
    "O(2^n)": ["n"],
    "O(n!)": ["n"],
    // Espaço não faz diferença; `log` aceita expoente; produto por justaposição e por `*` juntos.
    "O( n  log n )": ["n"],
    "O(log^2 n)": ["n"],
    "O(v + e log v * k)": ["v", "e", "k"],
    "O(itens_2)": ["itens_2"],
    "O(a234567890123456)": ["a234567890123456"],
  };
  for (const [expressao, simbolos] of Object.entries(validos)) {
    assert.deepEqual([...(simbolosDe(expressao) ?? ["recusado"])], simbolos, expressao);
  }
  const recusadas = [
    "O(N)",
    "O(n²)",
    "n log n",
    "O(2)",
    "O(n^2!)",
    "O(log)",
    "O(log log n)",
    "O()",
    "O(n+)",
    "O(n) + 1",
    "O(n",
    "",
    "O(a2345678901234567)",
  ];
  for (const expressao of recusadas) assert.equal(simbolosDe(expressao), undefined, expressao);
});

const COMPLEXIDADE = { tempo: "O(n log n)", espaco: "O(n)" };
const FLUXO = { nome: "Busca", gatilho: "GET /busca", situacao: "novo", depois: COMPLEXIDADE };
const VARIAVEIS = [{ simbolo: "n", significado: "itens no catálogo" }];

test("relatorio_complexidade: fluxos de nome único com Big-O; antes só no alterado; um HTML", () => {
  const alterado = { ...FLUXO, nome: "Cadastro", situacao: "alterado", antes: { tempo: "O(n^2)", espaco: "O(1)" } };
  assert.deepEqual(recusados("relatorio_complexidade", { variaveis: VARIAVEIS, fluxos: [FLUXO, alterado] }), []);
  // O HTML explica cada fluxo pelo mesmo nome do JSON.
  assert.deepEqual(recusados("relatorio_complexidade", { variaveis: VARIAVEIS, fluxos: [FLUXO, FLUXO] }), ["fluxos"]);
  // Sem fluxo executável (só estilo ou documentação).
  assert.deepEqual(recusados("relatorio_complexidade", { variaveis: [], fluxos: [] }), []);
  assert.deepEqual(
    recusados("relatorio_complexidade", { variaveis: VARIAVEIS, fluxos: [{ ...alterado, antes: undefined }] }),
    ["fluxos.0.antes"],
  );
  assert.deepEqual(
    recusados("relatorio_complexidade", { variaveis: VARIAVEIS, fluxos: [{ ...FLUXO, antes: COMPLEXIDADE }] }),
    ["fluxos.0.antes"],
  );
  assert.deepEqual(
    recusados("relatorio_complexidade", {
      variaveis: VARIAVEIS,
      fluxos: [{ ...FLUXO, situacao: "removido", nome: "a\nb", depois: { tempo: "O(N)", espaco: "n" } }],
    }),
    ["fluxos.0.nome", "fluxos.0.situacao", "fluxos.0.depois.tempo", "fluxos.0.depois.espaco"],
  );
  // Big-O fora da gramática não conta como uso: o agente vê os dois erros de uma vez.
  assert.deepEqual(
    recusados("relatorio_complexidade", {
      variaveis: VARIAVEIS,
      fluxos: [{ ...FLUXO, depois: { tempo: "O(N)", espaco: "n" } }],
    }),
    ["fluxos.0.depois.tempo", "fluxos.0.depois.espaco", "variaveis.0.simbolo"],
  );
  assert.deepEqual(recusados("relatorio_complexidade", { fluxos: [{ ...FLUXO, depois: undefined }] }), [
    "variaveis",
    "fluxos.0.depois",
  ]);
  assert.deepEqual(schemaDe("relatorio_complexidade").arquivos, HTML_UNICO);
});

test("relatorio_complexidade: todo símbolo usado está declarado e todo declarado é usado", () => {
  const k = { simbolo: "k", significado: "filtros" };
  assert.deepEqual(
    recusados("relatorio_complexidade", {
      variaveis: VARIAVEIS,
      fluxos: [{ ...FLUXO, situacao: "alterado", antes: { tempo: "O(k)", espaco: "O(1)" } }],
    }),
    ["fluxos.0.antes.tempo"],
  );
  assert.deepEqual(recusados("relatorio_complexidade", { variaveis: [...VARIAVEIS, k], fluxos: [FLUXO] }), [
    "variaveis.1.simbolo",
  ]);
  const r = schemaDe("relatorio_complexidade").dados.safeParse({
    variaveis: [k],
    fluxos: [{ ...FLUXO, depois: { tempo: "O(k * n)", espaco: "O(1)" } }],
  });
  assert.equal(
    r.success ? "" : z.prettifyError(r.error),
    "✖ n não está declarado em variaveis\n  → at fluxos[0].depois.tempo",
  );
  for (const simbolo of ["N", "log", "a".repeat(17), "1n"]) {
    assert.deepEqual(
      recusados("relatorio_complexidade", { variaveis: [{ ...VARIAVEIS[0], simbolo }], fluxos: [] }).slice(0, 1),
      ["variaveis.0.simbolo"],
      simbolo,
    );
  }
  assert.deepEqual(recusados("relatorio_complexidade", { variaveis: [...VARIAVEIS, ...VARIAVEIS], fluxos: [FLUXO] }), [
    "variaveis",
  ]);
});

const IMPACTOS = {
  impacto: "medio",
  novasDependencias: [{ nome: "lru-cache", motivo: "cache da busca" }],
  novosAcoplamentos: [{ de: "busca", para: "cache", motivo: "lê antes do banco" }],
  riscos: [{ descricao: "cache velho", mitigacao: "expira em 5 min" }],
};

test("relatorio_impactos_arquitetura: impacto, dependências, acoplamentos e riscos; um HTML", () => {
  assert.deepEqual(recusados("relatorio_impactos_arquitetura", IMPACTOS), []);
  const vazio = { impacto: "baixo", novasDependencias: [], novosAcoplamentos: [], riscos: [] };
  assert.deepEqual(recusados("relatorio_impactos_arquitetura", vazio), []);
  assert.deepEqual(
    recusados("relatorio_impactos_arquitetura", {
      impacto: "médio",
      novasDependencias: [{ nome: "x" }],
      novosAcoplamentos: [{ de: "a", para: " ", motivo: "m" }],
    }),
    ["impacto", "novasDependencias.0.motivo", "novosAcoplamentos.0.para", "riscos"],
  );
  assert.deepEqual(schemaDe("relatorio_impactos_arquitetura").arquivos, HTML_UNICO);
});

test("o schema publicado dos tipos do desenho: o que o agente precisa saber, incluindo a gramática Big-O", () => {
  assert.deepEqual(jsonSchemaDe("desenho_solucao").dados.required, ["resumo", "arquivosPrevistos"]);
  assert.deepEqual(jsonSchemaDe("prototipo").arquivos, schemaDe("prototipo").arquivos);
  assert.match(JSON.stringify(jsonSchemaDe("relatorio_complexidade").dados), /Gramática: bigO = /);
  assert.deepEqual(jsonSchemaDe("relatorio_impactos_arquitetura").dados.required, [
    "impacto",
    "novasDependencias",
    "novosAcoplamentos",
    "riscos",
  ]);
});

const SHA = "a".repeat(40);
const ALTERADO = { caminho: "src/busca.ts", status: "M", adicionadas: 3, removidas: 1, previsto: "src/**/*.ts" };

test("arquivos_alterados: base e head, cada arquivo com status, linhas e o padrão previsto que casou; nenhum anexo", () => {
  const dados = { base: SHA, head: "b".repeat(64), arquivos: [ALTERADO], previstosNaoTocados: ["docs/**"] };
  assert.deepEqual(recusados("arquivos_alterados", dados), []);
  // Arquivo binário não tem contagem de linhas (F5 §7); arquivo fora do desenho tem previsto null.
  const binario = { ...ALTERADO, caminho: "logo.png", status: "A", adicionadas: null, removidas: null, previsto: null };
  assert.deepEqual(recusados("arquivos_alterados", { ...dados, arquivos: [ALTERADO, binario] }), []);
  assert.deepEqual(
    recusados("arquivos_alterados", {
      base: "abc",
      head: SHA,
      arquivos: [{ ...ALTERADO, status: "C", adicionadas: -1 }],
    }),
    ["base", "arquivos.0.status", "arquivos.0.adicionadas", "previstosNaoTocados"],
  );
  assert.deepEqual(schemaDe("arquivos_alterados").arquivos.max, 0);
});

test("explicacao_fitness: uma explicação de até 1.000 caracteres por fitness function, pelo nome; nenhum anexo", () => {
  const explicacao = { nome: "complexidade", explicacao: "a busca ficou O(1)" };
  assert.deepEqual(recusados("explicacao_fitness", { explicacoes: [explicacao] }), []);
  assert.deepEqual(
    recusados("explicacao_fitness", {
      explicacoes: [
        { nome: "Complexidade", explicacao: " " },
        { ...explicacao, explicacao: "a".repeat(1001) },
      ],
    }),
    ["explicacoes.0.nome", "explicacoes.0.explicacao", "explicacoes.1.explicacao"],
  );
  assert.deepEqual(schemaDe("explicacao_fitness").arquivos.max, 0);
});

test("comprovacao_criterios: cada critério atendido ou não, como foi verificado e os anexos citados; vídeo ou print", () => {
  const criterio = { id: "CA-1", atendido: true, comoVerificado: "busquei mil itens", arquivos: ["busca.webm"] };
  assert.deepEqual(recusados("comprovacao_criterios", { criterios: [criterio] }), []);
  assert.deepEqual(
    recusados("comprovacao_criterios", {
      criterios: [{ id: "1", atendido: "sim", comoVerificado: "", arquivos: [] }],
    }),
    ["criterios.0.id", "criterios.0.atendido", "criterios.0.comoVerificado", "criterios.0.arquivos"],
  );
  assert.deepEqual(schemaDe("comprovacao_criterios").arquivos, { classes: ["video", "imagem"], min: 1 });
});

test("comprovacao_criterios, regras cruzadas: os critérios de aceite, e cada anexo citado presente", () => {
  const schema = schemaDe("comprovacao_criterios");
  const ag = {
    evidencias: [{ ticket: 1, tipo: "criterios_aceite", dados: { criterios: [{ id: "CA-1" }] } }],
  } as unknown as Agregado;
  const cruzar = (criterios: object[], anexos: string[]) => () =>
    schema.cruzar?.(schema.dados.parse({ criterios }), { ag, ticket: 3, anexos });
  const criterio = { id: "CA-1", atendido: true, comoVerificado: "busquei", arquivos: ["busca.webm"] };
  cruzar([criterio], ["busca.webm"])();
  assert.throws(
    cruzar([criterio], ["outro.webm"]),
    new ErroDeRegra(
      "comprovacao_criterios cita busca.webm, que não está entre os anexos",
      "anexe cada arquivo citado com --arquivo <caminho>, com o mesmo nome",
    ),
  );
  assert.throws(
    cruzar([{ ...criterio, id: "CA-2" }], ["busca.webm"]),
    new ErroDeRegra(
      "comprovacao_criterios comprova [CA-2], e os critérios de aceite do registro são [CA-1]",
      "submeta exatamente uma comprovação por critério de aceite",
    ),
  );
});

const MENSAGEM = {
  titulo: "Responder a busca pelo cache",
  oQueMudou: "a busca lê do cache",
  decisoesNaoObvias: [],
  naoFeito: [],
  naoPrevistos: [{ caminho: "metrica.ts", motivo: "mede o cache" }],
  comoRevisar: ["comece por busca.ts"],
  naoVerificado: [],
};

test("mensagem_pr: só as partes do PR que exigem julgamento, com os limites do F3 §4.5; nenhum anexo", () => {
  assert.deepEqual(recusados("mensagem_pr", MENSAGEM), []);
  assert.deepEqual(recusados("mensagem_pr", { ...MENSAGEM, reversao: "reverter o merge" }), []);
  assert.deepEqual(
    recusados("mensagem_pr", {
      titulo: "a".repeat(73),
      oQueMudou: "a".repeat(3001),
      decisoesNaoObvias: [" "],
      naoFeito: ["a".repeat(1001)],
      naoPrevistos: [{ caminho: "x.ts", motivo: "" }],
      comoRevisar: [],
      naoVerificado: undefined,
      reversao: " ",
    }),
    [
      "titulo",
      "oQueMudou",
      "decisoesNaoObvias.0",
      "naoFeito.0",
      "naoPrevistos.0.motivo",
      "comoRevisar",
      "naoVerificado",
      "reversao",
    ],
  );
  assert.deepEqual(recusados("mensagem_pr", { ...MENSAGEM, titulo: "duas\nlinhas" }), ["titulo"]);
  assert.deepEqual(recusados("mensagem_pr", { ...MENSAGEM, titulo: "duas\rlinhas" }), ["titulo"]);
  assert.deepEqual(schemaDe("mensagem_pr").arquivos.max, 0);
});

/** Uma issue com o desenho T-2 (impacto `impacto`) e a revisão T-5 concluídos; `naoPrevistos`: os de previsto null. */
function encerrando(impacto: string, naoPrevistos: string[], revisaoConcluida = true): Agregado {
  const ticket = (id: number, etapa: string, status: string) => ({ id, etapa, status });
  const evidencia = (ticket: number, tipo: string, dados: object) => ({ ticket, tipo, dados });
  return {
    tickets: [
      ticket(2, "desenho", "concluido"),
      ticket(5, "revisao", revisaoConcluida ? "concluido" : "falhou"),
      ticket(6, "encerramento", "em_execucao"),
    ],
    evidencias: [
      evidencia(2, "relatorio_impactos_arquitetura", { impacto }),
      evidencia(5, "arquivos_alterados", {
        arquivos: [
          { caminho: "busca.ts", previsto: "busca.ts" },
          ...naoPrevistos.map((caminho) => ({ caminho, previsto: null })),
        ],
      }),
    ],
  } as unknown as Agregado;
}

test("mensagem_pr, regras cruzadas: naoPrevistos são os da última revisão; reversao obrigatória com impacto ≠ baixo", () => {
  const cruzar = (ag: Agregado, dados: object) => () =>
    schemaDe("mensagem_pr").cruzar?.(schemaDe("mensagem_pr").dados.parse(dados), { ag, ticket: 6, anexos: [] });
  const recusa = (ag: Agregado, dados: object, msg: string) => {
    assert.throws(cruzar(ag, dados), (e) => e instanceof ErroDeRegra && e.message === msg);
  };

  cruzar(encerrando("baixo", ["metrica.ts"]), MENSAGEM)();
  const naoPrevistos =
    "(submeta em naoPrevistos exatamente um item por arquivo com previsto null no arquivos_alterados, com o motivo)";
  recusa(
    encerrando("baixo", ["metrica.ts", "x.ts"]),
    MENSAGEM,
    `mensagem_pr explica os não previstos [metrica.ts], e a última revisão concluída tem [metrica.ts, x.ts] ${naoPrevistos}`,
  );
  recusa(
    encerrando("baixo", []),
    MENSAGEM,
    `mensagem_pr explica os não previstos [metrica.ts], e a última revisão concluída tem [] ${naoPrevistos}`,
  );
  // A revisão que conta é a concluída: sem ela, não há arquivo não previsto a explicar.
  cruzar(encerrando("baixo", ["x.ts"], false), { ...MENSAGEM, naoPrevistos: [] })();

  recusa(
    encerrando("medio", ["metrica.ts"]),
    MENSAGEM,
    "mensagem_pr não tem reversao, e o impacto do desenho aprovado é medio (descreva em reversao como desfazer a mudança)",
  );
  cruzar(encerrando("alto", ["metrica.ts"]), { ...MENSAGEM, reversao: "reverter o merge" })();
});

test("video_demonstracao: o roteiro e exatamente um vídeo", () => {
  assert.deepEqual(recusados("video_demonstracao", { roteiro: "mostro a busca" }), []);
  assert.deepEqual(recusados("video_demonstracao", { roteiro: "a".repeat(2001) }), ["roteiro"]);
  assert.deepEqual(schemaDe("video_demonstracao").arquivos, { classes: ["video"], min: 1, max: 1 });
});

test("aula_codigo: trechos na ordem de leitura, de até 60 linhas, com o porquê; o HTML a Fabriquinha gera", () => {
  const trecho = {
    arquivo: "src/busca.ts",
    inicio: 10,
    fim: 20,
    oQueFaz: "lê do cache",
    porQue: "a busca repete",
    decisaoDoDesenho: "cache na busca",
  };
  assert.deepEqual(recusados("aula_codigo", { trechos: [trecho] }), []);
  assert.deepEqual(recusados("aula_codigo", { trechos: [{ ...trecho, alternativaDescartada: "índice" }] }), []);
  assert.deepEqual(recusados("aula_codigo", { trechos: [] }), ["trechos"]);
  assert.deepEqual(recusados("aula_codigo", { trechos: [{ ...trecho, fim: 9 }] }), ["trechos.0.fim"]);
  assert.deepEqual(recusados("aula_codigo", { trechos: [{ ...trecho, fim: 69 }] }), []);
  assert.deepEqual(recusados("aula_codigo", { trechos: [{ ...trecho, fim: 70 }] }), ["trechos.0.fim"]);
  assert.deepEqual(recusados("aula_codigo", { trechos: [{ ...trecho, porQue: " " }] }), ["trechos.0.porQue"]);
  assert.deepEqual(schemaDe("aula_codigo").arquivos, { classes: ["html"], min: 1, max: 1 });
});

test("pr_aberto e relatorio_produtividade: produzidos pela Fabriquinha, com o corpo em texto e o HTML anexados", () => {
  const pr = {
    hospedagem: "github",
    id: "12",
    url: "https://github.com/o/r/pull/12",
    branch: "fabriquinha/I-1",
    base: "main",
    head: SHA,
    condensado: false,
  };
  assert.deepEqual(recusados("pr_aberto", pr), []);
  assert.deepEqual(recusados("pr_aberto", { ...pr, hospedagem: "gitlab", url: "pull/12", head: "abc" }), [
    "hospedagem",
    "url",
    "head",
  ]);
  assert.deepEqual(schemaDe("pr_aberto").arquivos, { classes: ["texto"], min: 1, max: 1 });
  assert.deepEqual(recusados("relatorio_produtividade", {}), []);
  assert.deepEqual(schemaDe("relatorio_produtividade").arquivos, HTML_UNICO);
});

const recusadosEtapa = (tipo: TipoSchemaEtapa, dados: unknown): string[] => {
  const r = schemaDeEtapa(tipo).dados.safeParse(dados);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

const RODADA = { demanda_id: "I-1", titulo: "Rodada", e2e: false, criterios: ["CA-1"], depende: [] };
const PLANO = {
  demanda_id: "I-1",
  criterios: ["CA-1"],
  rodadas: [
    { ...RODADA, rodada_id: 1 },
    { ...RODADA, rodada_id: 2, depende: [{ demanda_id: "I-1", rodada_id: 1 }] },
  ],
  tickets: [1, 2].map((n) => ({ demanda_id: "I-1", ticket_id: n, rodada_id: n, titulo: "T", descricao: "d" })),
};

test("plano: o Plano do domínio, sem anexos (CA-1 a CA-3)", () => {
  const r = schemaDeEtapa("plano").dados.safeParse(PLANO);
  assert.equal(r.success, true);
  assert.equal(r.data.demanda_id, "I-1");
  assert.deepEqual(schemaDeEtapa("plano").arquivos.max, 0);
  assert.equal("aprovada" in schemaDeEtapa("plano"), false);

  const rodadas = (i: number, mudanca: object) => PLANO.rodadas.map((r, n) => (n === i ? { ...r, ...mudanca } : r));
  assert.deepEqual(recusadosEtapa("plano", { ...PLANO, rodadas: rodadas(0, { criterios: ["CA-9"] }) }), [
    ": a rodada 1 cita o CA-9, que a demanda não tem",
  ]);
  const ciclo = rodadas(0, { depende: [{ demanda_id: "I-1", rodada_id: 2 }] });
  assert.deepEqual(recusadosEtapa("plano", { ...PLANO, rodadas: ciclo }), [
    ": as rodadas 1 → 2 formam um ciclo de dependência",
  ]);
});

const CENARIO = { nome: "Carga", objetivo: "aguenta", comando: "npm run carga", resultado: "passou", observado: "ok" };
const ACHADO = { descricao: "falha", severidade: "baixa", recomendacao: "corrigir" };
const aprovada = (tipo: TipoSchemaEtapa, dados: unknown) =>
  schemaDeEtapa(tipo).aprovada?.(schemaDeEtapa(tipo).dados.parse(dados));

test("testes_estresse: aprovada = nenhum cenário quebrou; não se aplica exige justificativa (CA-4, CA-5)", () => {
  const com = (resultado: string) => ({ aplicavel: true, cenarios: [{ ...CENARIO, resultado }] });
  assert.equal(aprovada("testes_estresse", com("passou")), true);
  assert.equal(aprovada("testes_estresse", com("quebrou")), false);
  assert.deepEqual(
    recusadosEtapa("testes_estresse", com("talvez")).map((m) => m.split(":")[0]),
    ["cenarios.0.resultado"],
  );
  assert.deepEqual(recusadosEtapa("testes_estresse", { aplicavel: false, cenarios: [] }), [
    "justificativa: aplicavel é false: justifique por que não se aplica",
  ]);
  assert.deepEqual(recusadosEtapa("testes_estresse", { aplicavel: false, justificativa: "x", cenarios: [] }), []);
  assert.deepEqual(recusadosEtapa("testes_estresse", { aplicavel: false, justificativa: "x", cenarios: [CENARIO] }), [
    "cenarios: aplicavel é false: cenarios deve ficar vazia",
  ]);
  assert.deepEqual(recusadosEtapa("testes_estresse", { aplicavel: true, cenarios: [] }), [
    "cenarios: aplicavel é true: informe pelo menos um item em cenarios",
  ]);
});

test("analise_seguranca: aprovada = nenhum achado alto ou crítico (CA-6 a CA-8)", () => {
  const com = (...severidades: string[]) => ({
    aplicavel: true,
    ameacas: [{ descricao: "a", mitigacao: "m" }],
    achados: severidades.map((severidade) => ({ ...ACHADO, severidade })),
  });
  assert.equal(aprovada("analise_seguranca", com()), true);
  assert.equal(aprovada("analise_seguranca", com("baixa", "media")), true);
  assert.equal(aprovada("analise_seguranca", com("baixa", "alta")), false);
  assert.equal(aprovada("analise_seguranca", com("critica")), false);
  assert.deepEqual(
    recusadosEtapa("analise_seguranca", com("grave")).map((m) => m.split(":")[0]),
    ["achados.0.severidade"],
  );
  assert.deepEqual(recusadosEtapa("analise_seguranca", { aplicavel: false, ameacas: [], achados: [] }), [
    "justificativa: aplicavel é false: justifique por que não se aplica",
  ]);
  assert.deepEqual(
    recusadosEtapa("analise_seguranca", { aplicavel: false, justificativa: "x", ameacas: [], achados: [ACHADO] }),
    ["achados: aplicavel é false: achados deve ficar vazia"],
  );
  assert.deepEqual(recusadosEtapa("analise_seguranca", { ...com(), ameacas: [] }), [
    "ameacas: aplicavel é true: informe pelo menos um item em ameacas",
  ]);
});

test("o schema publicado da etapa traz o JSON Schema de dados e as regras de arquivo", () => {
  for (const tipo of ["plano", "testes_estresse", "analise_seguranca"] as const) {
    const { dados, arquivos } = jsonSchemaDeEtapa(tipo);
    assert.deepEqual(arquivos, schemaDeEtapa(tipo).arquivos);
    assert.deepEqual(dados, z.toJSONSchema(schemaDeEtapa(tipo).dados, { io: "input" }));
  }
  assert.deepEqual(jsonSchemaDeEtapa("testes_estresse").dados.required, ["aplicavel", "cenarios"]);
});

test("os exemplos json de cada skill passam pelo schema do tipo (CA-9)", () => {
  const skills = {
    plano: "plano",
    testes_estresse: "testes-estresse",
    analise_seguranca: "analise-seguranca",
  } as const;
  for (const [tipo, pasta] of Object.entries(skills)) {
    const texto = readFileSync(new URL(`../../pacote-pi/skills/artefato-${pasta}/SKILL.md`, import.meta.url), "utf8");
    const exemplos = [...texto.matchAll(/```json\n([\s\S]*?)\n```/g)];
    assert.ok(exemplos.length > 0, pasta);
    for (const [, json] of exemplos)
      assert.deepEqual(recusadosEtapa(tipo as TipoSchemaEtapa, JSON.parse(json ?? "")), []);
  }
});

const LINHA = {
  provedor: "anthropic",
  modelo: "m",
  tokens_entrada: 1,
  tokens_saida: 2,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
};
const mensagens = (dados: unknown) => {
  const r = schemaDeEtapa("custos_realizados").dados.safeParse(dados);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

test("custos_realizados: CA-8, campo faltante nomeado com como corrigir", () => {
  for (const [campo, como] of [
    ["ferramenta", "ferramenta externa"],
    ["sessao", "id da sessão no harness"],
  ] as const) {
    const sessao = { ferramenta: "claude", sessao: "s1", linhas: [LINHA], [campo]: undefined };
    const [m] = mensagens({ sessoes: [sessao] });
    assert.match(m ?? "", new RegExp(`^sessoes.0.${campo}: ${campo} é obrigatório: .*${como}`));
  }
  assert.match(mensagens({})[0] ?? "", /sessoes é obrigatório/);
  assert.match(mensagens({ sessoes: [{ ferramenta: "c", sessao: "s", linhas: [] }] })[0] ?? "", /linhas é obrigatório/);
});

test("custos_realizados: CA-9, tokens negativos, ausentes ou fracionados nomeiam o campo", () => {
  const com = (linha: object) => mensagens({ sessoes: [{ ferramenta: "c", sessao: "s", linhas: [linha] }] });
  assert.match(com({ ...LINHA, tokens_entrada: -1 })[0] ?? "", /tokens_entrada não pode ser negativo/);
  assert.match(com({ ...LINHA, tokens_saida: 1.5 })[0] ?? "", /tokens_saida deve ser inteiro/);
  assert.match(com({ ...LINHA, tokens_cache_leitura: undefined })[0] ?? "", /tokens_cache_leitura é obrigatório/);
  assert.match(com({ ...LINHA, custo: -1 })[0] ?? "", /custo não pode ser negativo/);
});

test("custos_realizados: CA-10, custo ausente fica null e nunca 0; sessão repetida é recusada", () => {
  const { dados } = schemaDeEtapa("custos_realizados");
  const sessao = { ferramenta: "c", sessao: "s", linhas: [LINHA, { ...LINHA, custo: 0.5 }] };
  const ok = dados.parse({ sessoes: [sessao] }) as { sessoes: { linhas: { custo: number | null }[] }[] };
  assert.deepEqual(
    ok.sessoes[0]?.linhas.map((l) => l.custo),
    [null, 0.5],
  );
  assert.match(mensagens({ sessoes: [sessao, sessao] })[0] ?? "", /sessão repetida/);
  assert.deepEqual(schemaDeEtapa("custos_realizados").arquivos.max, 0);
  assert.equal(Object.keys(jsonSchemaDeEtapa("custos_realizados").dados.properties ?? {}).join(), "sessoes");
});
