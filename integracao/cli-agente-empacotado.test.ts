// O arquivo empacotado do cliente do agente (pacote-pi/bin/fabriquinha, gerado por `npm run empacotar-cli-agente`) roda
// sozinho: copiado para uma pasta vazia, sem node_modules nem o fonte do core, fala com o serviço só por
// FABRIQUINHA_API e FABRIQUINHA_TOKEN. `npm run integracao` o empacota antes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  copyFileSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
// O servidor é importado antes do cenário: o `after` dele fecha o servidor e o banco antes de o do cenário apagar a raiz.
import { servir } from "../apoio-testes/servidor_web_de_teste.ts";
import {
  cenarioDaApiDoAgente,
  enderecoDoTicket,
  TICKETS_DA_API_DO_AGENTE,
  tokenDoTicket,
} from "../apoio-testes/cenario_da_api_do_agente.ts";
import { HarnessPi } from "../src/modulos/harness/pi/harness_pi.ts";

const pastaVazia = mkdtempSync(join(tmpdir(), "fabriquinha-cliente-empacotado-"));
after(() => {
  rmSync(pastaVazia, { recursive: true, force: true });
});

const arquivoEmpacotado = join(pastaVazia, "fabriquinha");
copyFileSync(join(import.meta.dirname, "../pacote-pi/bin/fabriquinha"), arquivoEmpacotado);

function rodarEmpacotado(env: NodeJS.ProcessEnv, args: string[]) {
  return new Promise<{ codigo: number; out: string; err: string }>((resolver) => {
    // O ambiente é só o que o teste dá: nada do ambiente deste processo vaza para o cliente.
    const filho = execFile(
      process.execPath,
      [arquivoEmpacotado, ...args],
      { env, cwd: pastaVazia },
      (erro, out, err) => {
        resolver({ codigo: erro === null ? 0 : Number(erro.code), out, err });
      },
    );
    filho.stdin?.end();
  });
}

const FOTO_PROJETO_VER =
  '{"nome":"loja","raiz_git":"/repos/loja","branch_base":"main","hospedagem":"github","chave_sonarqube":"k","etapas":[],"verificacoes":{"preparacao":[],"fitness":[],"linguagens":[],"e2e":[],"globs":[]}}\n';

const tokenDoAgente = tokenDoTicket(TICKETS_DA_API_DO_AGENTE.revisao);

test("a pasta do arquivo empacotado tem só ele: sem node_modules e sem o fonte", () => {
  assert.deepEqual(readdirSync(pastaVazia), ["fabriquinha"]);
});

test("projeto ver, com o serviço no ar: sai 0 e o stdout é a foto; o token não aparece na saída", async () => {
  const { banco } = cenarioDaApiDoAgente();
  const { porta } = await servir(banco);
  const saida = await rodarEmpacotado(
    { FABRIQUINHA_API: `127.0.0.1:${String(porta)}`, FABRIQUINHA_TOKEN: tokenDoAgente },
    ["projeto", "ver"],
  );
  assert.deepEqual(saida, { codigo: 0, out: FOTO_PROJETO_VER, err: "" });
});

test(
  "evidencia add de um vídeo de 450 MiB, acima do teto de string do V8, é aceito: o anexo vai em fluxo, sem base64",
  { timeout: 120_000 },
  async () => {
    const { raiz, banco } = cenarioDaApiDoAgente();
    const { porta } = await servir(banco);
    // Arquivo esparso de 450 MiB com cabeçalho MP4: ocupa quase nada em disco e passa de 384 MiB.
    const video = join(raiz, "worktrees", "loja", "I-206", "rodadas", "1", "demo.mp4");
    const arquivo = openSync(video, "w");
    writeSync(arquivo, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42")]));
    closeSync(arquivo);
    truncateSync(video, 450 * 1024 * 1024);
    const dados = join(pastaVazia, "dados.json");
    writeFileSync(dados, '{"roteiro":"r"}');
    const alvo = TICKETS_DA_API_DO_AGENTE.video;
    const saida = await rodarEmpacotado(
      { FABRIQUINHA_API: `127.0.0.1:${String(porta)}`, FABRIQUINHA_TOKEN: tokenDoTicket(alvo) },
      ["evidencia", "add", enderecoDoTicket(alvo), "video_demonstracao", "--dados", dados, "--arquivo", video],
    );
    assert.deepEqual(saida, {
      codigo: 0,
      out: '{"ticket":"I-206.T7","tipo":"video_demonstracao"}\n',
      err: "",
    });
    assert.deepEqual(
      banco
        .prepare("SELECT caminho, bytes FROM arquivo_evidencia")
        .all()
        .map((a) => ({ ...a })),
      [{ caminho: "demo.mp4", bytes: 450 * 1024 * 1024 }],
    );
  },
);

test("serviço parado: sai ≠ 0 e o stderr diz que a Fabriquinha está fora, sem o token", async () => {
  const ocioso = createServer().listen(0, "127.0.0.1");
  await once(ocioso, "listening");
  const porta = (ocioso.address() as { port: number }).port;
  ocioso.close();
  await once(ocioso, "close");
  const saida = await rodarEmpacotado(
    { FABRIQUINHA_API: `127.0.0.1:${String(porta)}`, FABRIQUINHA_TOKEN: tokenDoAgente },
    ["projeto", "ver"],
  );
  assert.notEqual(saida.codigo, 0);
  assert.equal(saida.out, "");
  assert.match(saida.err, /a Fabriquinha está fora/);
  assert.ok(!saida.err.includes(tokenDoAgente));
});

test("o ambiente que o harness dá ao agente do ticket não traz FABRIQUINHA_ROOT nem FABRIQUINHA_EXECUCAO", () => {
  const { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: execucao } = process.env;
  Object.assign(process.env, { FABRIQUINHA_ROOT: "/raiz", FABRIQUINHA_EXECUCAO: "exec-1" });
  try {
    const ambiente = new HarnessPi().variaveisDeAmbiente("/raiz", pastaVazia, "ticket");
    assert.equal(ambiente.FABRIQUINHA_ROOT, undefined);
    assert.equal(ambiente.FABRIQUINHA_EXECUCAO, undefined);
    assert.ok(ambiente.PATH?.split(":").some((p) => p.endsWith("pacote-pi/bin")));
  } finally {
    if (raiz === undefined) delete process.env.FABRIQUINHA_ROOT;
    else process.env.FABRIQUINHA_ROOT = raiz;
    if (execucao === undefined) delete process.env.FABRIQUINHA_EXECUCAO;
    else process.env.FABRIQUINHA_EXECUCAO = execucao;
  }
});
