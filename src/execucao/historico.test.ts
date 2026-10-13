// Histórico como contexto (F4 §6.8): o Markdown gerado do JSONL da sessão do pi e o anexo a outra sessão, contra um
// banco real.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AUDITOR } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { anexarHistorico, exportarHistorico, noHistorico } from "./historico.ts";
import { infoDaSessao } from "./sessoes.ts";

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-historico-")));
after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const ORIGEM = "00000000-0000-4000-8000-00000000000a";
const DESTINO = "00000000-0000-4000-8000-00000000000b";
const CONSULTA = "00000000-0000-4000-8000-00000000000c";
const T0 = "2026-10-11T10:00:00.000Z";
const T1 = "2026-10-11T11:00:00.000Z";

const banco = abrir(raiz);
registrarProjeto(banco, {
  nome: "loja",
  repo: raiz,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  testes: ["npm test"],
  sonar: { projectKey: "loja" },
  fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  modelos: {},
});
registrarIssue(banco, { projeto: "loja" }, AUDITOR);
registrarIssue(banco, { projeto: "loja" }, AUDITOR);
banco.exec(`UPDATE issue SET titulo = 'Busca lenta', tipo = 'problema' WHERE id = 2;
  INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em) VALUES
    (1, 1, 'interativo', '${ORIGEM}', 'sucesso', '${T0}', '${T1}'),
    (2, 1, 'interativo', '${ORIGEM}', 'em_andamento', '${T1}', NULL),
    (3, 2, 'interativo', '${DESTINO}', 'sucesso', '${T0}', '${T1}'),
    (4, 1, 'consulta', '${CONSULTA}', 'sucesso', '${T1}', '${T1}');`);
// Os prompts gravados: o da primeira execução é da Fabriquinha; o da retomada interativa é a mensagem do Auditor.
for (const [e, prompt] of [
  [1, "Vamos registrar."],
  [2, "Obrigado."],
] as const) {
  mkdirSync(join(raiz, "execucoes", `E-${String(e)}`), { recursive: true });
  writeFileSync(join(raiz, "execucoes", `E-${String(e)}`, "prompt.md"), prompt);
}

const longo = "x".repeat(2500);
const mensagem = (message: object) => ({ type: "message", id: "a", parentId: null, timestamp: T0, message });
const entradas = [
  { type: "session", version: 3, id: ORIGEM, timestamp: T0, cwd: raiz },
  { type: "model_change", id: "m", parentId: null, timestamp: T0, provider: "anthropic", modelId: "c" },
  mensagem({ role: "user", content: "Vamos registrar.", timestamp: 1 }),
  mensagem({
    role: "assistant",
    provider: "anthropic",
    model: "claude",
    content: [
      { type: "thinking", thinking: "pensando" },
      { type: "text", text: "Vou ler." },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "LEIAME" } },
    ],
  }),
  mensagem({ role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: longo }] }),
  mensagem({ role: "assistant", provider: "openai", model: "gpt", content: [{ type: "toolCall", name: "bash" }] }),
  mensagem({
    role: "toolResult",
    toolName: "bash",
    isError: true,
    content: [
      { type: "text", text: "erro com ``` dentro" },
      { type: "image", data: "", mimeType: "image/png" },
    ],
  }),
  mensagem({ role: "custom", customType: "x", content: "de extensão", display: true }),
  mensagem({ role: "user", content: [{ type: "text", text: "Obrigado." }] }),
];
mkdirSync(join(raiz, "sessoes"));
writeFileSync(
  join(raiz, "sessoes", `2026-10-11T10-00-00-000Z_${ORIGEM}.jsonl`),
  entradas.map((e) => JSON.stringify(e)).join("\n") + "\n",
);

const ESPERADO = `# Histórico da sessão T-1 (I-1, registro)

- Projeto: loja
- Issue: I-1 — (sem título)
- Ticket: T-1 — Registrar a necessidade
- Etapa: registro
- Modelo: anthropic/claude, openai/gpt
- Início: ${T0}
- Fim: em andamento

## Fabriquinha

Vamos registrar.

## Agente

Vou ler.

**Chamada de \`read\`**

\`\`\`json
{
  "path": "LEIAME"
}
\`\`\`

**Resultado de \`read\`**

\`\`\`
${"x".repeat(2000)}
… (cortado em 2000 de 2500 caracteres)
\`\`\`

## Agente

**Chamada de \`bash\`**

\`\`\`json
{}
\`\`\`

**Resultado de \`bash\` (erro)**

\`\`\`\`
erro com \`\`\` dentro
\`\`\`\`

## Auditor

Obrigado.
`;

test("exportar: cabeçalho, prompt da Fabriquinha e mensagens na íntegra, chamadas com argumentos e resultados cortados em 2.000", () => {
  assert.equal(exportarHistorico(banco, ORIGEM), ESPERADO);
});

test("exportar: sessão sem conversa gravada só tem o cabeçalho; sessão desconhecida é erro", () => {
  assert.equal(
    exportarHistorico(banco, DESTINO),
    `# Histórico da sessão T-2 (I-2, registro)

- Projeto: loja
- Issue: I-2 — Busca lenta
- Ticket: T-2 — Registrar a necessidade
- Etapa: registro
- Modelo: —
- Início: ${T0}
- Fim: ${T1}
`,
  );
  assert.throws(
    () => exportarHistorico(banco, "nada"),
    (e) => e instanceof ErroDeRegra && e.message === "a sessão nada não existe (confira o endereço do chat)",
  );
});

test("anexar: um arquivo por sessão na saída da execução atual do destino, a consulta com o id dela, e uma linha por anexo", async () => {
  const saida = join(raiz, "execucoes", "E-3", "saida");
  const mensagemFinal = await anexarHistorico(banco, DESTINO, [ORIGEM, CONSULTA, DESTINO], "Compare as três.");
  const daConsulta = join(saida, `historico-T-1-consulta-${CONSULTA}.md`);
  assert.equal(
    mensagemFinal,
    [
      "Compare as três.",
      `Histórico da sessão T-1 (I-1, registro) em \`${join(saida, "historico-T-1.md")}\`; leia antes de responder.`,
      `Histórico da sessão T-1 (I-1, registro) em \`${daConsulta}\`; leia antes de responder.`,
      `Histórico da sessão T-2 (I-2, registro) em \`${join(saida, "historico-T-2.md")}\`; leia antes de responder.`,
    ].join("\n"),
  );
  assert.equal(
    readFileSync(join(saida, "historico-T-1.md"), "utf8"),
    ESPERADO,
    "a consulta não sobrescreve a principal",
  );
  assert.equal(readFileSync(daConsulta, "utf8"), exportarHistorico(banco, CONSULTA));
});

test("noHistorico: a sessão ganha o título da issue, o resultado da última execução e o custo", async () => {
  banco.exec(`INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
    VALUES (3, 'anthropic', 'claude', 1, 1, 1, 0, 0, 0.5)`);
  const [linha] = noHistorico(banco, [await infoDaSessao(banco, DESTINO)]);
  assert.deepEqual([linha?.titulo, linha?.resultado, linha?.custo], ["Busca lenta", "concluida", 0.5]);
});
