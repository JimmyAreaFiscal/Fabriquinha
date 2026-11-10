// `POST /api/agente/evidencias` contra o servidor de verdade: o anexo chega com o caminho declarado, os bytes e o SHA-256, e
// só o arquivo que está na worktree da rodada ou na saída da execução, com esse SHA-256, é guardado (CA-3).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  cenarioDaApiDoAgente,
  contagemDasTabelas,
  enderecoDoTicket,
  servirApiDoAgente,
  TICKETS_DA_API_DO_AGENTE as TICKETS,
  tokenDoTicket,
} from "../../../../apoio-testes/cenario_da_api_do_agente.ts";
import { ErroDaApiDoAgente, RespostaEvidenciaAdd } from "../../contrato/agente.ts";

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
  const enviar = (tipo: string, dados: unknown, caminho: string, enviado: string | Buffer, sha = sha256(enviado)) =>
    pedir("POST", "/api/agente/evidencias", {
      token: tokenDoTicket(alvo),
      corpo: {
        ticket: enderecoDoTicket(alvo),
        tipo,
        dados,
        anexos: [{ caminho, conteudo_base64: Buffer.from(enviado).toString("base64"), sha256: sha }],
      },
    });
  return { raiz, banco, pastaDaSaida, enviar, pedir };
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
