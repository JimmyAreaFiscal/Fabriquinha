import assert from "node:assert/strict";
import { test } from "node:test";
import { z, ZodError } from "zod";
import type { TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { jsonSchemaDe, schemaDe, simbolosDe } from "./schemas.ts";

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

test("jsonSchemaDe publica o JSON Schema de dados (z.toJSONSchema) e as regras de arquivo", () => {
  const { dados, arquivos } = jsonSchemaDe("criterios_aceite");
  assert.deepEqual(arquivos, schemaDe("criterios_aceite").arquivos);
  assert.deepEqual(dados, z.toJSONSchema(schemaDe("criterios_aceite").dados, { io: "input" }));
  assert.deepEqual(dados.required, ["criterios"]);
  assert.equal(JSON.stringify(dados).includes(String.raw`"pattern":"^CA-\\d+$"`), true);
  assert.deepEqual(jsonSchemaDe("comportamento").dados.required, ["descricao", "comoReproduzir"]);
});

test("tipo ainda sem schema é recusado com os tipos aceitos", () => {
  assert.throws(
    () => schemaDe("pr_aberto"),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message.startsWith(
        "a Fabriquinha ainda não valida evidências do tipo pr_aberto (os tipos aceitos hoje são comportamento, " +
          "criterios_aceite, desenho_solucao, prototipo, relatorio_complexidade, relatorio_impactos_arquitetura, ",
      ),
  );
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

test("jsonSchemaDe dos tipos do desenho: o que o agente precisa saber, incluindo a gramática Big-O", () => {
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
