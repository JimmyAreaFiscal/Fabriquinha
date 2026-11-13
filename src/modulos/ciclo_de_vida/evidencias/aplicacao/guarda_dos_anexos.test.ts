import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { caminhoArquivo } from "../../../../shared/armazenamento/arquivos.ts";
import { schemaDoTipo } from "../nucleo/formatos.ts";
import type { TipoEvidencia } from "../../etapas/publico.ts";
import type { Ambiente } from "../../../ambiente/publico.ts";
import { type AnexoEnviado, guardarAnexos, guardarAnexosEnviados } from "./guarda_dos_anexos.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const MiB = 1024 * 1024;

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom")]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const HTML = "\ufeff \n<!DOCTYPE html><html><body>oi</body></html>";

interface Cenario {
  raiz: string;
  banco: DatabaseSync;
  worktree: string;
  saida: string;
  /** Cria o arquivo `nome` em `pasta` e devolve o caminho. */
  arquivo(pasta: string, nome: string, conteudo: string | Buffer, tamanho?: number): string;
}

/** O banco, a worktree do ticket e a saída da execução, de onde os anexos podem vir. */
function cenario(): Cenario {
  const { raiz, banco } = abrirBancoTemporario();
  const worktree = join(raiz, "worktrees", "loja", "I-1");
  const saida = join(raiz, "execucoes", "E-1", "saida");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(saida, { recursive: true });
  return {
    raiz,
    banco,
    worktree,
    saida,
    arquivo(pasta, nome, conteudo, tamanho) {
      const caminho = join(pasta, nome);
      writeFileSync(caminho, conteudo);
      // Arquivo esparso: os limites de tamanho são testados sem gravar centenas de MiB.
      if (tamanho !== undefined) truncateSync(caminho, tamanho);
      return caminho;
    },
  };
}

/** Os anexos de `tipo` guardados como a submissão da evidência os guarda, da worktree ou da saída. */
const submeter = (c: Cenario, tipo: TipoEvidencia, caminhos: readonly string[]) =>
  Promise.resolve().then(() =>
    guardarAnexos(c.banco, caminhos, tipo, schemaDoTipo(tipo).arquivos, {
      worktree: c.worktree,
      saida: c.saida,
      fora: "da worktree da demanda e do diretório de saída",
      copie: `$FABRIQUINHA_SAIDA (${c.saida})`,
    }),
  );

const sha = (conteudo: string | Buffer) => createHash("sha256").update(conteudo).digest("hex");

/** Recusa com a mensagem e sem guardar arquivo algum. */
async function recusa(c: Cenario, trabalho: () => Promise<unknown>, classe: typeof ErroDeRegra, msg: string) {
  await assert.rejects(trabalho, (e) => e instanceof classe && e.message === msg);
  const arquivos = join(c.raiz, "arquivos");
  assert.deepEqual(existsSync(arquivos) ? readdirSync(arquivos) : [], []);
}

test("guarda os anexos por conteúdo, com nome, classe e tamanho", async () => {
  const c = cenario();
  const video = c.arquivo(c.saida, "tela.webm", WEBM);
  const log = c.arquivo(c.worktree, "erro.log", "Error: timeout\n");
  assert.deepEqual(await submeter(c, "comportamento", [video, log]), [
    { nome: "tela.webm", mime: "video/webm", sha256: sha(WEBM), bytes: WEBM.length },
    { nome: "erro.log", mime: "text/plain; charset=utf-8", sha256: sha("Error: timeout\n"), bytes: 15 },
  ]);
  assert.deepEqual(readFileSync(caminhoArquivo(c.banco, sha(WEBM))), WEBM);
  c.banco.close();
});

test("origem: só da worktree ou da saída, pelo caminho real do descritor; link simbólico para fora é rejeitado", async () => {
  const c = cenario();
  const fora = c.arquivo(c.raiz, "segredo.txt", "senha");
  const foraDaSaida = "fora da worktree da demanda e do diretório de saída";
  const solucao = `(copie-o para $FABRIQUINHA_SAIDA (${c.saida}))`;

  // Link no último componente nunca é seguido, aponte para fora ou para dentro.
  symlinkSync(fora, join(c.worktree, "atalho.txt"));
  symlinkSync(c.arquivo(c.saida, "real.txt", "passo"), join(c.worktree, "link.txt"));
  for (const link of ["atalho.txt", "link.txt"]) {
    await recusa(
      c,
      () => submeter(c, "comportamento", [join(c.worktree, link)]),
      ErroDeRegra,
      `${join(c.worktree, link)} é um link simbólico (anexe o próprio arquivo, não um link para ele)`,
    );
  }
  // Link de pasta no meio do caminho é resolvido: vale o lugar real do arquivo.
  symlinkSync(c.raiz, join(c.worktree, "pasta"));
  const viaPasta = join(c.worktree, "pasta", "segredo.txt");
  await recusa(
    c,
    () => submeter(c, "comportamento", [viaPasta]),
    ErroDeRegra,
    `${viaPasta} está ${foraDaSaida} ${solucao}`,
  );
  const subindo = join(c.worktree, "..", "..", "..", "segredo.txt");
  await assert.rejects(() => submeter(c, "comportamento", [subindo]), /fora da worktree/);
  await recusa(
    c,
    () => submeter(c, "comportamento", [join(c.worktree, "nao-existe.txt")]),
    ErroDeRegra,
    `${join(c.worktree, "nao-existe.txt")} não existe (confira o caminho do arquivo)`,
  );
  mkdirSync(join(c.worktree, "src"));
  const fifo = join(c.worktree, "fifo");
  execFileSync("mkfifo", [fifo]);
  for (const especial of [join(c.worktree, "src"), fifo]) {
    await recusa(
      c,
      () => submeter(c, "comportamento", [especial]),
      ErroDeRegra,
      `${especial} não é um arquivo regular (anexe um arquivo comum)`,
    );
  }

  const semLeitura = c.arquivo(c.worktree, "trancado.txt", "x");
  chmodSync(semLeitura, 0o000);
  await recusa(
    c,
    () => submeter(c, "comportamento", [semLeitura]),
    ErroDeRegra,
    `sem permissão para ler ${semLeitura} (dê permissão de leitura ao arquivo)`,
  );
  // Outros erros de abertura sobem como vieram.
  await assert.rejects(() => submeter(c, "comportamento", [join(semLeitura, "x")]), {
    code: "ENOTDIR",
  });
  const grande = c.arquivo(c.worktree, "grande.bin", "", 500 * 1024 * 1024 + 1);
  await recusa(
    c,
    () => submeter(c, "comportamento", [grande]),
    ErroDeRegra,
    `${grande} tem 500.0 MiB, e nenhum anexo passa de 500.0 MiB (reduza o arquivo)`,
  );

  symlinkSync(c.saida, join(c.worktree, "saida"));
  const viaSaida = join(c.worktree, "saida", "real.txt");
  assert.deepEqual(
    (await submeter(c, "comportamento", [viaSaida])).map((a) => a.nome),
    ["real.txt"],
  );
  // A saída como link para outra pasta, como o `abrigarProcesso` deixa: o que está nessa pasta vale, o resto não.
  rmSync(c.saida, { recursive: true });
  const pastaDoAmbiente = join(c.raiz, "ambientes", "a", "saida");
  mkdirSync(pastaDoAmbiente, { recursive: true });
  symlinkSync(pastaDoAmbiente, c.saida);
  const viaLinkDaSaida = c.arquivo(c.saida, "estresse.log", "tudo certo\n");
  assert.deepEqual(
    (await submeter(c, "comportamento", [viaLinkDaSaida])).map((a) => a.nome),
    ["estresse.log"],
  );
  assert.deepEqual(
    (await submeter(c, "comportamento", [join(pastaDoAmbiente, "estresse.log")])).map((a) => a.nome),
    ["estresse.log"],
  );
  // Fora das duas origens continua recusado, inclusive pela pasta-irmã do link.
  await assert.rejects(
    () => submeter(c, "comportamento", [fora]),
    (e) => e instanceof ErroDeRegra && e.message === `${fora} está ${foraDaSaida} ${solucao}`,
  );
  symlinkSync(fora, join(pastaDoAmbiente, "atalho.txt"));
  const viaAtalho = join(c.saida, "atalho.txt");
  await assert.rejects(
    () => submeter(c, "comportamento", [viaAtalho]),
    (e) => e instanceof ErroDeRegra && e.message.startsWith(`${viaAtalho} é um link simbólico`),
  );
  rmSync(c.saida);
  // Sem o diretório de saída, a worktree continua valendo.
  const daWorktree = c.arquivo(c.worktree, "passo.txt", "passo 2");
  assert.equal((await submeter(c, "comportamento", [daWorktree])).length, 1);
  c.banco.close();
});

/**
 * Faz `vezes` submissões de `worktree/x.txt` enquanto um `/bin/sh` roda `script` sem parar, mexendo nele, e conta o
 * desfecho de cada uma: o que `guardado` diz do anexo guardado, ou a mensagem do erro.
 */
async function corrida(
  c: Cenario,
  script: string,
  vezes: number,
  guardado: (anexo: { conteudo: string; mime: string }) => string,
): Promise<Map<string, number>> {
  const fds = readdirSync("/proc/self/fd").length;
  const trocador = spawn("/bin/sh", ["-c", `while :; do ${script}; done`], { cwd: c.worktree, stdio: "ignore" });
  const fim = once(trocador, "close");
  await once(trocador, "spawn");
  const desfechos = new Map<string, number>();
  try {
    for (let i = 0; i < vezes; i++) {
      let desfecho: string;
      try {
        const [anexo] = await submeter(c, "comportamento", [join(c.worktree, "x.txt")]);
        assert.ok(anexo);
        desfecho = guardado({
          conteudo: readFileSync(caminhoArquivo(c.banco, anexo.sha256), "utf8"),
          mime: anexo.mime,
        });
      } catch (error_) {
        desfecho = String(error_);
      }
      desfechos.set(desfecho, (desfechos.get(desfecho) ?? 0) + 1);
    }
  } finally {
    trocador.kill();
    await fim;
  }
  assert.equal(trocador.signalCode, "SIGTERM", "o sh que mexe no arquivo rodou até o fim da corrida");
  assert.equal(readdirSync("/proc/self/fd").length, fds, "nenhum descritor fica aberto");
  return desfechos;
}

const TEXTO = "text/plain; charset=utf-8";

test("regressão TOCTOU: trocar o anexo por um link para fora durante a submissão nunca guarda o conteúdo de fora", async () => {
  const c = cenario();
  const segredo = c.arquivo(c.raiz, "segredo.txt", "SEGREDO\n");
  c.arquivo(c.worktree, "regular", "inocente\n");
  c.arquivo(c.worktree, "x.txt", "inocente\n");
  const linkRejeitado = `ErroDeRegra: ${join(c.worktree, "x.txt")} é um link simbólico (anexe o próprio arquivo, não um link para ele)`;
  // Troca x.txt, atomicamente, entre um arquivo regular e um link para fora.
  const desfechos = await corrida(
    c,
    `cp regular r.tmp; mv -f r.tmp x.txt; ln -sf '${segredo}' l.tmp; mv -fT l.tmp x.txt`,
    3000,
    ({ conteudo, mime }) => `${mime} ${conteudo}`,
  );
  // Os dois desfechos aparecem, então a troca aconteceu durante a corrida; nenhum outro aparece.
  assert.deepEqual([...desfechos.keys()].sort(), [linkRejeitado, `${TEXTO} inocente\n`].sort());
  c.banco.close();
});

test("regressão TOCTOU: reescrever o anexo no mesmo inode durante a submissão não guarda o que não foi validado", async () => {
  const c = cenario();
  c.arquivo(c.worktree, "x.txt", "inocente\n");
  const htmlRejeitado = `ErroDeRegra: ${join(c.worktree, "x.txt")} é html, e comportamento aceita só video ou texto (anexe um arquivo de uma dessas classes)`;
  // Mesmo tamanho, mesmo inode: alterna entre um texto e um HTML, que comportamento não aceita.
  const desfechos = await corrida(
    c,
    `printf 'inocente\\n' 1<> x.txt; printf '<html>!!!' 1<> x.txt`,
    1000,
    ({ conteudo, mime }) => (/^\s*<html/i.test(conteudo) ? `HTML guardado como ${mime}` : mime),
  );
  // Leitura no meio de uma escrita pode misturar os dois; o que importa é que o guardado é o que foi classificado.
  assert.deepEqual([...desfechos.keys()].sort(), [htmlRejeitado, TEXTO].sort());
  c.banco.close();
});

test("classe pelos bytes iniciais, não pela extensão, e o limite de cada classe", async () => {
  const c = cenario();
  const tentar = (nome: string, conteudo: string | Buffer, tamanho?: number) => () =>
    submeter(c, "comportamento", [c.arquivo(c.saida, nome, conteudo, tamanho)]);
  const caminho = (nome: string) => join(c.saida, nome);

  await recusa(
    c,
    tentar("foto.txt", PNG),
    ErroDeRegra,
    `${caminho("foto.txt")} é imagem, e comportamento aceita só video ou texto (anexe um arquivo de uma dessas classes)`,
  );
  await assert.rejects(tentar("foto.webm", JPEG), /é imagem, e comportamento aceita só video ou texto/);
  await assert.rejects(tentar("pagina.txt", HTML), /pagina\.txt é html, e comportamento/);
  const naoAceito =
    "não é vídeo WebM/MP4, imagem PNG/JPEG nem texto UTF-8 sem byte nulo (anexe um arquivo de um desses formatos)";
  await recusa(
    c,
    tentar("binario.log", Buffer.from([0x00, 0x01, 0x02])),
    ErroDeRegra,
    `${caminho("binario.log")} ${naoAceito}`,
  );
  await recusa(
    c,
    tentar("latin1.txt", Buffer.from([0x61, 0xc3, 0x28])),
    ErroDeRegra,
    `${caminho("latin1.txt")} ${naoAceito}`,
  );
  await recusa(
    c,
    tentar("grande.webm", WEBM, 500 * MiB + 1),
    ErroDeRegra,
    `${caminho("grande.webm")} tem 500.0 MiB, e nenhum anexo passa de 500.0 MiB (reduza o arquivo)`,
  );
  await assert.rejects(
    tentar("grande.png", PNG, 20 * MiB + 1),
    /grande\.png tem 20\.0 MiB, e imagem aceita até 20\.0 MiB/,
  );
  await recusa(
    c,
    tentar("grande.txt", "a", 5 * MiB + 1),
    ErroDeRegra,
    `${caminho("grande.txt")} tem 5.0 MiB e não é vídeo WebM/MP4 nem imagem PNG/JPEG (texto e HTML aceitam até 5.0 MiB)`,
  );

  const nos = [
    c.arquivo(c.saida, "filme.mp4", MP4),
    c.arquivo(c.saida, "no-limite.txt", "a".repeat(5 * MiB)),
    c.arquivo(c.saida, "vazio.txt", ""),
  ];
  assert.deepEqual(
    (await submeter(c, "comportamento", nos)).map((a) => [a.nome, a.mime, a.bytes]),
    [
      ["filme.mp4", "video/mp4", MP4.length],
      ["no-limite.txt", "text/plain; charset=utf-8", 5 * MiB],
      ["vazio.txt", "text/plain; charset=utf-8", 0],
    ],
  );
  c.banco.close();
});

test("prototipo precisa de pelo menos um vídeo ou print entre os anexos", async () => {
  const c = cenario();
  const pagina = c.arquivo(c.saida, "pagina.html", HTML);
  await recusa(
    c,
    () => submeter(c, "prototipo", [pagina]),
    ErroDeRegra,
    "protótipo precisa de pelo menos um vídeo ou print (anexe também um arquivo video ou imagem)",
  );
  assert.equal((await submeter(c, "prototipo", [pagina, c.arquivo(c.saida, "tela.png", PNG)])).length, 2);
  c.banco.close();
});

/** Um Ambiente onde a raiz do host aparece como `/espaco`, como num container com a raiz montada. */
const ambienteMontadoEmEspaco = (c: Cenario) =>
  ({ caminhoNoAmbiente: (caminhoNoHost: string) => caminhoNoHost.replace(c.raiz, "/espaco") }) as unknown as Ambiente;

/** O anexo que o cliente do agente enviaria para o arquivo do host `caminhoNoHost`, com o caminho no Ambiente. */
const enviado = (
  c: Cenario,
  caminhoNoHost: string,
  conteudo: string | Buffer,
  sha256 = sha(conteudo),
): AnexoEnviado => ({
  caminho: caminhoNoHost.replace(c.raiz, "/espaco"),
  sha256,
});

const submeterEnviados = (c: Cenario, anexos: AnexoEnviado[]) =>
  Promise.resolve().then(() =>
    guardarAnexosEnviados(
      c.banco,
      { anexos, ambiente: ambienteMontadoEmEspaco(c) },
      "comportamento",
      schemaDoTipo("comportamento").arquivos,
      {
        worktree: c.worktree,
        saida: c.saida,
        fora: "da worktree do ticket e do diretório de saída",
        copie: `$FABRIQUINHA_SAIDA (${c.saida})`,
      },
    ),
  );

test("enviados: anexo da worktree e da saída, pelo caminho do Ambiente, são guardados pelo arquivo do host", async () => {
  const c = cenario();
  const daSaida = c.arquivo(c.saida, "estresse.log", "tudo certo\n");
  const daWorktree = c.arquivo(c.worktree, "erro.log", "Error: timeout\n");
  assert.deepEqual(
    await submeterEnviados(c, [enviado(c, daSaida, "tudo certo\n"), enviado(c, daWorktree, "Error: timeout\n")]),
    [
      { nome: "estresse.log", mime: TEXTO, sha256: sha("tudo certo\n"), bytes: 11 },
      { nome: "erro.log", mime: TEXTO, sha256: sha("Error: timeout\n"), bytes: 15 },
    ],
  );
  assert.equal(readFileSync(caminhoArquivo(c.banco, sha("tudo certo\n")), "utf8"), "tudo certo\n");
  c.banco.close();
});

test("enviados: fora da worktree e da saída, em caminho relativo ou com .., é recusado sem guardar", async () => {
  const c = cenario();
  const fora = c.arquivo(c.raiz, "segredo.txt", "senha");
  const mensagemFora = (caminho: string) =>
    `${caminho} está fora da worktree do ticket e do diretório de saída (copie-o para $FABRIQUINHA_SAIDA (${c.saida}))`;
  for (const anexo of [enviado(c, fora, "senha"), { ...enviado(c, fora, "senha"), caminho: "/etc/passwd" }]) {
    await recusa(c, () => submeterEnviados(c, [anexo]), ErroDeRegra, mensagemFora(anexo.caminho));
  }
  const subindo = { ...enviado(c, fora, "senha"), caminho: `${enviado(c, c.worktree, "").caminho}/../segredo.txt` };
  await recusa(c, () => submeterEnviados(c, [subindo]), ErroDeRegra, mensagemFora(subindo.caminho));
  await recusa(
    c,
    () => submeterEnviados(c, [{ ...enviado(c, fora, "senha"), caminho: "segredo.txt" }]),
    ErroDeRegra,
    "segredo.txt não é um caminho absoluto (informe o caminho completo do arquivo)",
  );
  c.banco.close();
});

test("enviados: link simbólico no último componente é recusado, aponte para fora ou para dentro", async () => {
  const c = cenario();
  const fora = c.arquivo(c.raiz, "segredo.txt", "senha");
  symlinkSync(fora, join(c.worktree, "atalho.txt"));
  const atalho = enviado(c, join(c.worktree, "atalho.txt"), "senha");
  await recusa(
    c,
    () => submeterEnviados(c, [atalho]),
    ErroDeRegra,
    `${atalho.caminho} é um link simbólico (anexe o próprio arquivo, não um link para ele)`,
  );
  c.banco.close();
});

test("enviados: arquivo trocado entre a leitura e o envio é recusado sem guardar", async () => {
  const c = cenario();
  const caminho = c.arquivo(c.worktree, "x.txt", "lido\n");
  const lido = enviado(c, caminho, "lido\n");
  writeFileSync(caminho, "trocado\n");
  await recusa(
    c,
    () => submeterEnviados(c, [lido]),
    ErroDeRegra,
    `${lido.caminho} não tem o SHA-256 enviado (o arquivo mudou depois de lido; envie-o de novo)`,
  );
  c.banco.close();
});

test("enviados: caminho com byte nulo é recusado como erro de regra, e não como falha do open", async () => {
  const c = cenario();
  const comNulo = { ...enviado(c, c.arquivo(c.worktree, "x.txt", "x"), "x"), caminho: "/espaco/x.txt\0.log" };
  await recusa(
    c,
    () => submeterEnviados(c, [comNulo]),
    ErroDeRegra,
    '"/espaco/x.txt\\u0000.log" tem byte nulo no caminho (informe o caminho real do arquivo)',
  );
  c.banco.close();
});

test("enviados: o SHA-256 do arquivo grande é conferido em blocos", async () => {
  const c = cenario();
  const grande = Buffer.alloc(MiB + 5, "a");
  const caminho = c.arquivo(c.worktree, "grande.log", grande);
  const [guardado] = await submeterEnviados(c, [enviado(c, caminho, grande)]);
  assert.equal(guardado?.sha256, sha(grande));
  c.banco.close();
});
