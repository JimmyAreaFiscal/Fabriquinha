import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agregado } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { montarPR, LIMITE_DO_CORPO, tituloDoPR } from "./pr.ts";

const consumo = (custo: number, input: number) => ({
  chamadas: 1,
  tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0 },
  custo,
});

/** A I-7 com desenho (T-2), desenvolvimento (T-3) e revisão (T-4) concluídos, e o encerramento T-5 depois do pi. */
function encerrando(semMensagem = false): Agregado {
  let id = 0;
  const evidencia = (ticket: number, tipo: string, dados: object, ...anexos: string[]) => ({
    id: ++id,
    ticket,
    tipo,
    dados,
    arquivos: anexos.map((nome) => ({ nome })),
  });
  const rodado = { comando: "npm test", codigoSaida: 0, estourou: false, duracaoMs: 3200 };
  return {
    issue: { id: 7, tipo: "funcionalidade", titulo: "Busca por voz", descricao: "O cliente quer buscar falando.\n" },
    tickets: [
      { id: 1, etapa: "desenho", status: "falhou" },
      { id: 2, etapa: "desenho", status: "concluido" },
      { id: 3, etapa: "desenvolvimento", status: "concluido" },
      { id: 4, etapa: "revisao", status: "concluido" },
      { id: 5, etapa: "encerramento", status: "em_execucao" },
    ],
    evidencias: [
      evidencia(1, "desenho_solucao", { foraDeEscopo: ["de um desenho que falhou"] }, "velho.html"),
      evidencia(2, "desenho_solucao", { foraDeEscopo: ["busca por imagem"] }, "desenho.html"),
      evidencia(
        2,
        "relatorio_complexidade",
        {
          fluxos: [
            {
              nome: "Busca",
              situacao: "alterado",
              antes: { tempo: "O(n)", espaco: "O(1)" },
              depois: { tempo: "O(log n)", espaco: "O(n)" },
            },
          ],
        },
        "fluxos.html",
      ),
      evidencia(
        2,
        "relatorio_impactos_arquitetura",
        { impacto: "medio", riscos: [{ descricao: "cache desatualizado", mitigacao: "expira em 1 min" }] },
        "impactos.html",
      ),
      evidencia(3, "execucao_testes", { comandos: [rodado] }),
      evidencia(3, "relatorio_sonar", {
        arquivosAnalisados: ["a.ts", "b.ts"],
        issues: [
          { arquivo: "a.ts", linha: 3, regra: "ts:S1", severidade: "MAJOR", mensagem: "ruim" },
          { arquivo: "b.ts", regra: "ts:S2", severidade: "MINOR", mensagem: "feio" },
        ],
      }),
      evidencia(4, "arquivos_alterados", {
        arquivos: [
          { caminho: "src/busca.ts", status: "M", adicionadas: 3, removidas: 1, previsto: "src/**" },
          { caminho: "a|b.png", status: "A", adicionadas: null, removidas: null, previsto: null },
        ],
      }),
      evidencia(4, "matriz_fitness", {
        linhas: [
          { ...rodado, nome: "complexidade" },
          { ...rodado, nome: "camadas", codigoSaida: 1 },
        ],
      }),
      evidencia(4, "explicacao_fitness", {
        explicacoes: [
          { nome: "camadas", explicacao: "Domínio sem I/O." },
          { nome: "complexidade", explicacao: "Busca em O(log n)." },
        ],
      }),
      evidencia(
        4,
        "comprovacao_criterios",
        {
          criterios: [
            { id: "CA-1", atendido: true, comoVerificado: 'falei "tênis"', arquivos: ["ca-1.webm"] },
            { id: "CA-2", atendido: false, comoVerificado: "falei baixo", arquivos: ["ca-1.webm", "ca-2.png"] },
          ],
        },
        "ca-1.webm",
        "ca-2.png",
      ),
      ...(semMensagem
        ? []
        : [
            evidencia(5, "mensagem_pr", {
              titulo: "Buscar por voz",
              oQueMudou: "A busca aceita áudio.",
              decisoesNaoObvias: ["Usei o reconhecedor\ndo navegador."],
              naoFeito: ["sinônimos"],
              naoPrevistos: [{ caminho: "a|b.png", motivo: "ícone\nnovo" }],
              comoRevisar: ["Leia src/busca.ts.", "Rode a busca."],
              naoVerificado: [],
              reversao: "Reverter o merge.",
            }),
          ]),
      evidencia(5, "video_explicativo", { roteiro: "mostro" }, "video.webm"),
      evidencia(
        5,
        "relatorio_produtividade",
        {
          etapas: [
            {
              etapa: "desenho",
              ...consumo(0.5, 1500),
              execucoes: 2,
              reprovacoes: 1,
              modelos: [{ provedor: "anthropic", modelo: "claude", ...consumo(0.5, 1500) }],
            },
            { etapa: "revisao", ...consumo(0, 0), execucoes: 1, reprovacoes: 0, modelos: [] },
          ],
        },
        "relatorio.html",
      ),
    ],
  } as unknown as Agregado;
}

const COMPLETO = `<!-- fabriquinha I-7/T-5 -->

## Por quê

**Funcionalidade:** Busca por voz

O cliente quer buscar falando.

## O que mudou

A busca aceita áudio.

## Decisões não óbvias

- Usei o reconhecedor
  do navegador.

## Fora do escopo

- busca por imagem
- sinônimos

## Arquivos alterados × desenho

| Arquivo | Status | Linhas | Desenho |
| --- | --- | --- | --- |
| \`src/busca.ts\` | M | +3 −1 | \`src/**\` |
| \`a\\|b.png\` | A | binário | não previsto: ícone novo |

## Como revisar

1. Leia src/busca.ts.
2. Rode a busca.

## Evidências

**Testes**

- \`npm test\`: passou em 3s

**SonarQube**: 2 issues em 2 arquivos analisados: \`a.ts\`, \`b.ts\`.

- \`a.ts:3\` ts:S1 (MAJOR): ruim
- \`b.ts\` ts:S2 (MINOR): feio

**Fitness functions**

- **complexidade**: passou. Busca em O(log n).
- **camadas**: reprovou (código 1). Domínio sem I/O.

**Critérios de aceite**

- **CA-1** atendido ✓: falei "tênis" (I-7 · comprovacao_criterios · ca-1.webm)
- **CA-2** não atendido ✗: falei baixo (I-7 · comprovacao_criterios · ca-1.webm; I-7 · comprovacao_criterios · ca-2.png)

**Complexidade**

- **Busca** (alterado): tempo O(n) → O(log n), espaço O(1) → O(n)

**Na Fabriquinha**

- I-7 · desenho_solucao · desenho.html
- I-7 · relatorio_complexidade · fluxos.html
- I-7 · relatorio_impactos_arquitetura · impactos.html
- I-7 · video_explicativo · video.webm
- I-7 · relatorio_produtividade · relatorio.html

## Não verificado

Nada.

## Riscos e reversão

**Impacto na arquitetura:** medio

- **Risco:** cache desatualizado **Mitigação:** expira em 1 min

**Reversão:** Reverter o merge.

## Autoria e custo

Produzido por agentes pi na Fabriquinha.

| Etapa | Modelos | Execuções | Tokens | Custo | Reprovações |
| --- | --- | --- | --- | --- | --- |
| desenho | anthropic/claude | 2 | 1.500 | US$ 0,5000 | 1 |
| revisao | — | 1 | 0 | US$ 0,0000 | 0 |
`;

test("título do PR: <feat|fix>: <titulo> [I-n]", () => {
  assert.equal(tituloDoPR({ id: 7, tipo: "funcionalidade" }, "Buscar por voz"), "feat: Buscar por voz [I-7]");
  assert.equal(tituloDoPR({ id: 8, tipo: "problema" }, "Corrigir a busca"), "fix: Corrigir a busca [I-8]");
});

test("corpo do PR: as 10 seções do F3 §4.6, na ordem e com os títulos, das evidências aprovadas da issue", () => {
  const { titulo, completo, publicado, condensado } = montarPR(encerrando(), 5, LIMITE_DO_CORPO.github);
  assert.equal(titulo, "feat: Buscar por voz [I-7]");
  assert.equal(completo, COMPLETO);
  assert.equal(publicado, completo);
  assert.equal(condensado, false);
});

test("condensação do F3 §4.7: seção 5, depois 7, depois 10, parando assim que cabe; as do agente nunca", () => {
  const ag = encerrando();
  const secao = (corpo: string, titulo: string) => corpo.split(`## ${titulo}\n\n`)[1]?.split("\n\n## ")[0];
  const doAgente = ["O que mudou", "Decisões não óbvias", "Como revisar", "Não verificado"];

  const cabe = montarPR(ag, 5, COMPLETO.length);
  assert.deepEqual([cabe.publicado, cabe.condensado], [COMPLETO, false]);

  const um = montarPR(ag, 5, COMPLETO.length - 1);
  assert.equal(um.completo, COMPLETO, "o completo nunca é condensado");
  assert.equal(um.condensado, true);
  assert.equal(
    secao(um.publicado, "Arquivos alterados × desenho"),
    "1 previsto, 1 não previsto.\n\n- `a|b.png`: ícone\n  novo",
  );
  assert.equal(secao(um.publicado, "Evidências"), secao(COMPLETO, "Evidências"));

  const dois = montarPR(ag, 5, um.publicado.length - 1).publicado;
  assert.equal(
    secao(dois, "Evidências"),
    "- Testes 1/1 ✓\n- SonarQube 2 issues em 2 arquivos\n- Fitness 1/2 ✗\n- Critérios 1/2\n- Complexidade: 1 fluxo",
  );
  assert.equal(secao(dois, "Autoria e custo"), secao(COMPLETO, "Autoria e custo"));

  const tres = montarPR(ag, 5, dois.length - 1).publicado;
  assert.equal(
    secao(tres, "Autoria e custo")?.trimEnd(),
    "Produzido por agentes pi na Fabriquinha: 3 execuções, 1.500 tokens, US$ 0,5000, 1 reprovação.",
  );
  for (const corpo of [um.publicado, dois, tres]) {
    for (const titulo of doAgente) assert.equal(secao(corpo, titulo), secao(COMPLETO, titulo), titulo);
  }

  // Ainda não coube: corta o fim do corpo já condensado, com o aviso.
  const fim = "\n\n… corpo completo em I-7, evidência pr_aberto\n";
  const cortado = montarPR(ag, 5, tres.length - 1);
  assert.equal(cortado.condensado, true);
  assert.equal(cortado.publicado.length, tres.length - 1);
  assert.equal(cortado.publicado, tres.slice(0, tres.length - 1 - fim.length) + fim);
  assert.ok(montarPR(ag, 5, 300).publicado.startsWith("<!-- fabriquinha I-7/T-5 -->\n\n## Por quê"));
});

test("o corte não deixa meio caractere no fim", () => {
  const ag = encerrando();
  const fim = "\n\n… corpo completo em I-7, evidência pr_aberto\n";
  // O 😀 ocupa as posições 18 e 19 do título; cortar em 19 o deixaria pela metade.
  const comEmoji = { ...ag, issue: { ...ag.issue, titulo: "Busca 😀" } } as Agregado;
  const antes = "<!-- fabriquinha I-7/T-5 -->\n\n## Por quê\n\n**Funcionalidade:** Busca ";
  const { publicado } = montarPR(comEmoji, 5, antes.length + 1 + fim.length);
  assert.equal(publicado, antes + fim);
});

test("corpo do PR sem uma evidência da issue: ErroDeRegra com o que falta", () => {
  assert.throws(
    () => montarPR(encerrando(true), 5, LIMITE_DO_CORPO.github),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message ===
        "o PR da I-7 não pode ser montado: falta a evidência mensagem_pr da etapa encerramento " +
          "(o PR sai das evidências do desenho aprovado, do último desenvolvimento, da última revisão e do encerramento)",
  );
});

test("texto do agente não esconde nem imita seção, e o código dele sai como ele escreveu", () => {
  const ag = encerrando();
  const mensagem = ag.evidencias.find((e) => e.tipo === "mensagem_pr");
  assert.ok(mensagem);
  Object.assign(mensagem.dados, {
    // HTML aberto e títulos falsos, fora de código.
    oQueMudou:
      "Mudou.\n<!-- esconde o resto\n<details>\n<pre>\n## Evidências\n   ### falso\nEvidências\n---\nTítulo\n===",
    // O texto típico: blocos sh e yaml com #, --- e <!--, e código inline com <!--, tudo como foi escrito.
    decisoesNaoObvias: [
      "Instale assim:\n```sh\n# instala\nnpm i\n<!-- nada\n```\nE use `<!--` no HTML, ``a`<b``, ou a<b.",
      // Código inline que o CommonMark não reconhece: crases de tamanhos diferentes e crase escapada.
      "Veja `<details>`` aqui.",
      "Veja \\`<details>` aqui.",
      "Configure:\n~~~yaml\n---\nchave: 1\n~~~",
    ],
    // ```a`b não abre bloco (info string com crase); cerca de crases não fecha com tis nem com menos crases.
    naoFeito: ["```a`b\n## Evidências", "````\na\n~~~\n```\n# dentro\n`````\n# fora"],
    // Cerca de tis que o agente esqueceu aberta.
    comoRevisar: ["Rode:\n~~~~\n# sem fim"],
    naoVerificado: ["Recuado:\n\n    # comentário de shell"],
    // HTML numa célula de tabela.
    naoPrevistos: [{ caminho: "a|b.png", motivo: "<details> aberto a\\|b, c\\\\|d e f|g" }],
  });
  const { completo } = montarPR(ag, 5, LIMITE_DO_CORPO.github);
  const secao = (corpo: string, titulo: string) => corpo.split(`## ${titulo}\n\n`)[1]?.split("\n\n## ")[0];

  assert.equal(
    secao(completo, "O que mudou"),
    "Mudou.\n&lt;!-- esconde o resto\n&lt;details>\n&lt;pre>\n\\## Evidências\n   \\### falso\nEvidências\n" +
      "\\---\nTítulo\n\\===",
  );
  assert.equal(
    secao(completo, "Decisões não óbvias"),
    "- Instale assim:\n  ```sh\n  # instala\n  npm i\n  <!-- nada\n  ```\n" +
      "  E use `&lt;!--` no HTML, ``a`&lt;b``, ou a&lt;b.\n" +
      "- Veja `&lt;details>`` aqui.\n" +
      "- Veja \\`&lt;details>` aqui.\n" +
      "- Configure:\n  ~~~yaml\n  ---\n  chave: 1\n  ~~~",
  );
  assert.equal(
    secao(completo, "Fora do escopo"),
    "- busca por imagem\n- ```a`b\n  \\## Evidências\n- ````\n  a\n  ~~~\n  ```\n  # dentro\n  `````\n  \\# fora",
  );
  assert.equal(secao(completo, "Como revisar"), "1. Rode:\n   ~~~~\n   # sem fim\n   ~~~~");
  assert.equal(secao(completo, "Não verificado"), "- Recuado:\n  \n      # comentário de shell");
  assert.match(
    String(secao(completo, "Arquivos alterados × desenho")),
    /\| `a\\\|b\.png` \| A \| binário \| não previsto: &lt;details> aberto a\\\|b, c\\\\\\\|d e f\\\|g \|$/,
  );
  // As seções geradas continuam lá, na ordem, como sem o texto do agente.
  for (const titulo of ["Por quê", "Evidências", "Riscos e reversão", "Autoria e custo"]) {
    assert.equal(secao(completo, titulo), secao(COMPLETO, titulo), titulo);
  }
  assert.deepEqual(
    completo.split("\n\n## ").map((s) => s.split("\n")[0]),
    COMPLETO.split("\n\n## ").map((s) => s.split("\n")[0]),
  );
});
