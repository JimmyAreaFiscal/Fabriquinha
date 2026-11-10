import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { mensagem } from "./comando.ts";
import { principal } from "./principal.ts";

const pasta = mkdtempSync(join(tmpdir(), "fabriquinha-cli-agente-"));
after(() => {
  rmSync(pasta, { recursive: true, force: true });
});

interface Pedido {
  metodo: string;
  caminho: string;
  corpo: unknown;
}

/** Roda o cliente com um `fetch` que anota os pedidos e responde `resposta`. */
interface Opcoes {
  resposta?: object;
  status?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}

async function rodar(args: string[], { resposta = { ok: true }, status = 200, stdin = "", env = {} }: Opcoes = {}) {
  const pedidos: Pedido[] = [];
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env: { FABRIQUINHA_API: "127.0.0.1:1", FABRIQUINHA_TOKEN: "t", ...env },
    stdin: Readable.from([stdin]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    fetch: ((url: string, init: RequestInit) => {
      pedidos.push({
        metodo: String(init.method),
        caminho: url.replace("http://127.0.0.1:1", ""),
        corpo: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve(Response.json(resposta, { status }));
    }) as unknown as typeof fetch,
  });
  return { codigo, out, err, pedidos };
}

test("projeto ver, demanda ver e ticket ver pedem o endpoint e imprimem a resposta numa linha", async () => {
  assert.deepEqual(await rodar(["projeto", "ver"]), {
    codigo: 0,
    out: '{"ok":true}\n',
    err: "",
    pedidos: [{ metodo: "GET", caminho: "/api/agente/projeto", corpo: undefined }],
  });
  assert.equal((await rodar(["demanda", "ver", "I-206"])).pedidos[0]?.caminho, "/api/agente/demandas/I-206");
  assert.equal((await rodar(["ticket", "ver", "I-206.T9"])).pedidos[0]?.caminho, "/api/agente/tickets/I-206.T9");
});

test("ticket criar manda a rodada e o título (ou só a rodada)", async () => {
  assert.deepEqual((await rodar(["ticket", "criar", "I-206.R2", "--titulo", "Corrigir"])).pedidos, [
    { metodo: "POST", caminho: "/api/agente/tickets", corpo: { rodada: "I-206.R2", titulo: "Corrigir" } },
  ]);
  assert.deepEqual((await rodar(["ticket", "criar", "I-206.R2"])).pedidos[0]?.corpo, { rodada: "I-206.R2" });
});

test("revisao decidir lê --correcoes do argumento e --plano do stdin e os manda já lidos", async () => {
  const { pedidos } = await rodar(
    [
      "revisao",
      "decidir",
      "I-206.T9",
      "reprovar",
      "--motivo",
      "falta",
      "--correcoes",
      '[{"titulo":"a"}]',
      "--plano",
      "-",
    ],
    { stdin: '{"p":1}' },
  );
  assert.deepEqual(pedidos, [
    {
      metodo: "POST",
      caminho: "/api/agente/revisoes",
      corpo: {
        ticket: "I-206.T9",
        veredito: "reprovar",
        motivo: "falta",
        correcoes: [{ titulo: "a" }],
        plano: { p: 1 },
      },
    },
  ]);
  assert.deepEqual((await rodar(["revisao", "decidir", "I-206.T9", "aprovar"])).pedidos[0]?.corpo, {
    ticket: "I-206.T9",
    veredito: "aprovar",
  });
});

test("revisao decidir com JSON malformado cita a opção e não chama a API", async () => {
  const saida = await rodar(["revisao", "decidir", "I-206.T9", "reprovar", "--correcoes", "{"]);
  assert.equal(saida.codigo, 1);
  assert.match(saida.err, /^--correcoes não é um JSON válido: .* \(passe --correcoes <json\|->\)\n$/);
  assert.deepEqual(saida.pedidos, []);
});

test("evidencia schema pede o schema do tipo", async () => {
  assert.equal(
    (await rodar(["evidencia", "schema", "plano"])).pedidos[0]?.caminho,
    "/api/agente/evidencias/plano/schema",
  );
});

test("evidencia add manda os dados lidos do arquivo e cada anexo com o caminho absoluto, os bytes e o SHA-256", async () => {
  const dados = join(pasta, "dados.json");
  writeFileSync(dados, '{"aplicavel":false}');
  const log = join(pasta, "estresse.log");
  writeFileSync(log, "tudo certo\n");
  const { codigo, pedidos } = await rodar([
    "evidencia",
    "add",
    "I-206.T5",
    "testes_estresse",
    "--dados",
    dados,
    "--arquivo",
    log,
  ]);
  assert.equal(codigo, 0);
  assert.deepEqual(pedidos, [
    {
      metodo: "POST",
      caminho: "/api/agente/evidencias",
      corpo: {
        ticket: "I-206.T5",
        tipo: "testes_estresse",
        dados: { aplicavel: false },
        anexos: [
          {
            caminho: log,
            conteudo_base64: Buffer.from("tudo certo\n").toString("base64"),
            sha256: createHash("sha256").update("tudo certo\n").digest("hex"),
          },
        ],
      },
    },
  ]);
});

test("evidencia add sem --dados deixa a recusa ao serviço, e com --dados - lê o stdin", async () => {
  assert.deepEqual((await rodar(["evidencia", "add", "I-206.T5", "plano"])).pedidos[0]?.corpo, {
    ticket: "I-206.T5",
    tipo: "plano",
    anexos: [],
  });
  assert.deepEqual(
    (await rodar(["evidencia", "add", "I-206.T5", "plano", "--dados", "-"], { stdin: '{"a":1}' })).pedidos[0]?.corpo,
    { ticket: "I-206.T5", tipo: "plano", dados: { a: 1 }, anexos: [] },
  );
});

test("evidencia add com anexo ilegível ou dados malformados é erro de uma linha, sem chamar a API", async () => {
  const ausente = join(pasta, "ausente.log");
  const sem = await rodar(["evidencia", "add", "I-206.T5", "plano", "--arquivo", ausente]);
  assert.equal(sem.codigo, 1);
  assert.match(sem.err, new RegExp(`^não consegui ler ${ausente}: .* \\(confira o caminho do arquivo\\)\\n$`));
  const ruim = join(pasta, "ruim.json");
  writeFileSync(ruim, "{");
  const malformado = await rodar(["evidencia", "add", "I-206.T5", "plano", "--dados", ruim]);
  assert.equal(malformado.codigo, 1);
  assert.match(malformado.err, /^.*ruim\.json não é um JSON válido: .* \(corrija o arquivo de dados\)\n$/);
  assert.deepEqual([...sem.pedidos, ...malformado.pedidos], []);
});

test("a recusa da API sai no stderr com a mensagem do serviço e o código de saída do corpo", async () => {
  const recusa = { mensagem: "o agente só lê o próprio ticket (leia I-206.T9)", codigo_de_saida: 1 };
  assert.deepEqual(await rodar(["ticket", "ver", "I-206.T3"], { resposta: recusa, status: 403 }), {
    codigo: 1,
    out: "",
    err: "o agente só lê o próprio ticket (leia I-206.T9)\n",
    pedidos: [{ metodo: "GET", caminho: "/api/agente/tickets/I-206.T3", corpo: undefined }],
  });
  assert.equal(
    (await rodar(["projeto", "ver"], { resposta: { ...recusa, codigo_de_saida: 2 }, status: 400 })).codigo,
    2,
  );
});

test("falha fora do contrato (o stdout não escreve) sai com código 1 e a mensagem", async () => {
  let err = "";
  const codigo = await principal(["projeto", "ver"], {
    env: { FABRIQUINHA_API: "127.0.0.1:1", FABRIQUINHA_TOKEN: "t" },
    stdin: Readable.from([""]),
    stdout: {
      write: () => {
        throw new Error("pipe fechado");
      },
    },
    stderr: { write: (t: string) => (err += t) },
    fetch: () => Promise.resolve(Response.json({})),
  });
  assert.deepEqual([codigo, err], [1, "pipe fechado\n"]);
});

test("serviço parado: stderr diz que a Fabriquinha está fora e o código é 1", async () => {
  let err = "";
  const codigo = await principal(["projeto", "ver"], {
    env: { FABRIQUINHA_API: "127.0.0.1:1", FABRIQUINHA_TOKEN: "t" },
    stdin: Readable.from([""]),
    stdout: { write: () => undefined },
    stderr: { write: (t: string) => (err += t) },
    fetch: () => Promise.reject(new TypeError("fetch failed")),
  });
  assert.equal(codigo, 1);
  assert.match(err, /^a Fabriquinha está fora/);
});

const AJUDA_DE_TICKET =
  "Uso:\n\nAgente de uma execução da demanda (tickets e rodadas pelo endereço, como I-206.T3 e I-206.R2):\n  fabriquinha ticket ver I-<n>.T<m>\n  fabriquinha ticket criar I-<n>.R<m> --titulo <texto>\n\n";

test("uso inválido (comando, argumento ou opção) dá código 2 e a ajuda do grupo", async () => {
  for (const [args, motivo] of [
    [["ticket", "ver"], "falta I-<n>.T<m>"],
    [["ticket", "ver", "a", "b"], "argumento a mais: b"],
    [["ticket", "criar", "I-1.R1", "--nada"], "Unknown option '--nada'"],
    [["ticket", "nada"], "comando desconhecido: ticket nada"],
  ] as const) {
    const saida = await rodar([...args]);
    assert.equal(saida.codigo, 2, args.join(" "));
    assert.equal(saida.out, "");
    assert.ok(saida.err.startsWith(motivo), `${args.join(" ")}: ${saida.err}`);
    assert.ok(saida.err.includes(`\n\n${AJUDA_DE_TICKET}`), `${args.join(" ")}: ${saida.err}`);
    assert.deepEqual(saida.pedidos, []);
  }
  const semComando = await rodar([]);
  assert.equal(semComando.codigo, 2);
  assert.match(semComando.err, /^falta o comando\n\nUso:\n\nAgente de uma execução/);
});

test("--help e -h mostram os sete comandos do agente (ou só os do grupo) e saem com 0", async () => {
  const todos = await rodar(["--help"]);
  assert.equal(todos.codigo, 0);
  assert.equal(todos.out.match(/^ {2}fabriquinha /gm)?.length, 7);
  assert.equal((await rodar(["ticket", "-h"])).out.match(/^ {2}fabriquinha /gm)?.length, 2);
});

test("mensagem dá o texto do Error ou de qualquer outra coisa lançada", () => {
  assert.equal(mensagem(new Error("falhou")), "falhou");
  assert.equal(mensagem("solto"), "solto");
});
