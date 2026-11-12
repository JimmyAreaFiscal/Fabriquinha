// `POST /api/agente/anexos` e `POST /api/agente/evidencias` contra o servidor de verdade: o anexo chega em corpo binário com o
// caminho declarado e o SHA-256, a evidência o cita, e só o arquivo que está na worktree da rodada ou na saída da execução, com
// esse SHA-256, é guardado (CA-3).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  cenarioDaApiDoAgente,
  contagemDasTabelas,
  enderecoDoTicket,
  servirApiDoAgente,
  TICKETS_DA_API_DO_AGENTE as TICKETS,
  tokenDoTicket,
} from "../../../../apoio-testes/cenario_da_api_do_agente.ts";
import { ErroDaApiDoAgente, RespostaEvidenciaAdd } from "../../contrato/agente/agente.ts";

const ESTRESSE = {
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "npm test", resultado: "passou", observado: "ok" }],
};
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(16)]);

const sha256 = (conteudo: string | Buffer): string => createHash("sha256").update(conteudo).digest("hex");

/** O cenário e o `enviar` de um anexo ao ticket `alvo`: o caminho declarado, os bytes (`enviado`) e o SHA-256 (o dos bytes, se não vier). */
async function cenario(alvo: typeof TICKETS.estresse | typeof TICKETS.video) {
  const { raiz, banco } = cenarioDaApiDoAgente();
  const pedir = await servirApiDoAgente(banco);
  const pastaDaSaida = join(raiz, "execucoes", `E-e-${enderecoDoTicket(alvo).replace(".", "-")}`, "saida");
  mkdirSync(pastaDaSaida, { recursive: true });
  const token = tokenDoTicket(alvo);
  const enviarBytes = (caminho: string, enviado: string | Buffer | Readable, sha: string) =>
    pedir("POST", `/api/agente/anexos?${new URLSearchParams({ caminho, sha256: sha }).toString()}`, {
      token,
      bytes: enviado instanceof Readable ? enviado : Readable.from([Buffer.from(enviado)]),
    });
  const citar = (tipo: string, dados: unknown, anexos: { caminho: string; sha256: string }[]) =>
    pedir("POST", "/api/agente/evidencias", {
      token,
      corpo: { ticket: enderecoDoTicket(alvo), tipo, dados, anexos },
    });
  /** O que o cliente empacotado faz: manda os bytes do anexo e cita o caminho e o SHA-256; a primeira recusa é a resposta. */
  const enviar = async (
    tipo: string,
    dados: unknown,
    caminho: string,
    enviado: string | Buffer,
    sha = sha256(enviado),
  ) => {
    const upload = await enviarBytes(caminho, enviado, sha);
    return upload.status === 200 ? citar(tipo, dados, [{ caminho, sha256: sha }]) : upload;
  };
  return { raiz, banco, pastaDaSaida, enviar, enviarBytes, citar, pedir };
}

test("CA-3: o anexo da saída é aceito e guardado com o nome e o tipo do arquivo", async () => {
  const { banco, pastaDaSaida, enviar } = await cenario(TICKETS.estresse);
  const log = join(pastaDaSaida, "estresse.log");
  writeFileSync(log, "tudo certo\n");
  const resposta = await enviar("testes_estresse", ESTRESSE, log, "tudo certo\n");
  assert.equal(resposta.status, 200);
  assert.deepEqual(RespostaEvidenciaAdd.parse(resposta.json), {
    ticket: "I-206.T5",
    tipo: "testes_estresse",
    veredito: "atende",
  });
  assert.deepEqual(
    banco
      .prepare("SELECT caminho, mime FROM arquivo_evidencia")
      .all()
      .map((a) => ({ ...a })),
    [{ caminho: "estresse.log", mime: "text/plain; charset=utf-8" }],
  );
  banco.close();
});

test("CA-3: o anexo da worktree da rodada do ticket é aceito", async () => {
  const { raiz, banco, enviar } = await cenario(TICKETS.video);
  const video = join(raiz, "worktrees", "loja", "I-206", "rodadas", "1", "demo.mp4");
  writeFileSync(video, MP4);
  const resposta = await enviar("video_demonstracao", { roteiro: "r" }, video, MP4);
  assert.equal(resposta.status, 200);
  assert.equal(RespostaEvidenciaAdd.parse(resposta.json).tipo, "video_demonstracao");
  assert.deepEqual(
    banco
      .prepare("SELECT caminho FROM arquivo_evidencia")
      .all()
      .map((a) => a.caminho),
    ["demo.mp4"],
  );
  banco.close();
});

test("CA-3: arquivo fora da worktree e da saída, link simbólico e arquivo trocado depois de lido são recusados sem gravar", async () => {
  const { raiz, banco, pastaDaSaida, enviar } = await cenario(TICKETS.estresse);
  const antes = contagemDasTabelas(banco);
  const recusado = async (caminho: string, enviado: string, mensagem: string) => {
    const resposta = await enviar("testes_estresse", ESTRESSE, caminho, enviado);
    assert.equal(resposta.status, 409);
    assert.equal(ErroDaApiDoAgente.parse(resposta.json).mensagem, mensagem);
    assert.deepEqual(contagemDasTabelas(banco), antes);
  };

  const fora = join(raiz, "fora.log");
  writeFileSync(fora, "x");
  await recusado(
    fora,
    "x",
    `${fora} está fora da worktree do ticket e do diretório de saída (copie-o para $FABRIQUINHA_SAIDA (${pastaDaSaida}))`,
  );

  const atalho = join(pastaDaSaida, "atalho.log");
  symlinkSync(fora, atalho);
  await recusado(atalho, "x", `${atalho} é um link simbólico (anexe o próprio arquivo, não um link para ele)`);

  // O agente leu "lido" e mandou o SHA-256 dele; o arquivo no host já é outro.
  const trocado = join(pastaDaSaida, "trocado.log");
  writeFileSync(trocado, "trocado\n");
  await recusado(
    trocado,
    "lido\n",
    `${trocado} não tem o SHA-256 enviado (o arquivo mudou depois de lido; envie-o de novo)`,
  );
  banco.close();
});

test("sem dados a evidência é recusada com a orientação do CLI", async () => {
  const { banco, pedir } = await cenario(TICKETS.estresse);
  const resposta = await pedir("POST", "/api/agente/evidencias", {
    token: tokenDoTicket(TICKETS.estresse),
    corpo: { ticket: "I-206.T5", tipo: "testes_estresse" },
  });
  assert.deepEqual(
    [resposta.status, resposta.json],
    [409, { mensagem: "falta --dados (passe --dados <arquivo.json|->)", codigo_de_saida: 1 }],
  );
  banco.close();
});

test("o upload recusa bytes que não têm o SHA-256 declarado, e a evidência não cita anexo que não foi enviado", async () => {
  const { banco, pastaDaSaida, enviarBytes, citar } = await cenario(TICKETS.estresse);
  const antes = contagemDasTabelas(banco);
  const log = join(pastaDaSaida, "estresse.log");
  writeFileSync(log, "tudo certo\n");

  const adulterado = await enviarBytes(log, "tudo certo\n", sha256("outro"));
  assert.equal(adulterado.status, 409);
  assert.equal(
    ErroDaApiDoAgente.parse(adulterado.json).mensagem,
    `os bytes enviados de ${log} não têm o SHA-256 declarado (envie o arquivo de novo)`,
  );
  const semUpload = await citar("testes_estresse", ESTRESSE, [{ caminho: log, sha256: sha256("tudo certo\n") }]);
  assert.equal(semUpload.status, 409);
  assert.equal(
    ErroDaApiDoAgente.parse(semUpload.json).mensagem,
    `${log} não foi enviado com esse SHA-256 (envie o arquivo antes da evidência)`,
  );
  assert.equal((await enviarBytes(log, "x", "nao-e-sha")).status, 422);
  assert.deepEqual(contagemDasTabelas(banco), antes);
  banco.close();
});

test("o upload sem token é recusado", async () => {
  const { banco, pastaDaSaida, pedir } = await cenario(TICKETS.estresse);
  const consulta = new URLSearchParams({ caminho: join(pastaDaSaida, "a.log"), sha256: sha256("a") }).toString();
  assert.equal((await pedir("POST", `/api/agente/anexos?${consulta}`, { bytes: Readable.from(["a"]) })).status, 401);
  banco.close();
});

test("dois anexos enviados são citados na mesma evidência", async () => {
  const { banco, pastaDaSaida, enviarBytes, citar } = await cenario(TICKETS.estresse);
  const log = join(pastaDaSaida, "estresse.log");
  const erro = join(pastaDaSaida, "erro.log");
  writeFileSync(log, "tudo certo\n");
  writeFileSync(erro, "nada\n");
  for (const [caminho, conteudo] of [
    [log, "tudo certo\n"],
    [erro, "nada\n"],
  ] as const) {
    assert.equal((await enviarBytes(caminho, conteudo, sha256(conteudo))).status, 200);
  }
  const anexos = [
    { caminho: log, sha256: sha256("tudo certo\n") },
    { caminho: erro, sha256: sha256("nada\n") },
  ];
  assert.equal((await citar("testes_estresse", ESTRESSE, anexos)).status, 200);
  assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM arquivo_evidencia").get()?.n, 2);
  // O anexo foi consumido: citá-lo de novo exige reenviar.
  assert.equal((await citar("testes_estresse", ESTRESSE, anexos)).status, 409);
  banco.close();
});

test("caminho declarado com byte nulo é erro de regra (409), e não falha do servidor (500)", async () => {
  const { banco, pastaDaSaida, enviar } = await cenario(TICKETS.estresse);
  const resposta = await enviar("testes_estresse", ESTRESSE, `${pastaDaSaida}/estresse\0.log`, "x");
  assert.equal(resposta.status, 409);
  assert.match(ErroDaApiDoAgente.parse(resposta.json).mensagem, /tem byte nulo no caminho/);
  banco.close();
});

test("anexo acima do maior limite (500 MiB) é recusado sem montar o corpo em memória", async () => {
  const { banco, pastaDaSaida, enviarBytes } = await cenario(TICKETS.estresse);
  const MiB = 1024 * 1024;
  const enormes = Readable.from(
    (function* () {
      for (let i = 0; i < 501; i++) yield Buffer.alloc(MiB);
    })(),
  );
  const resposta = await enviarBytes(join(pastaDaSaida, "enorme.mp4"), enormes, sha256("x"));
  assert.equal(resposta.status, 409);
  assert.match(ErroDaApiDoAgente.parse(resposta.json).mensagem, /passa de 500 MiB \(reduza o arquivo\)$/);
  banco.close();
});
