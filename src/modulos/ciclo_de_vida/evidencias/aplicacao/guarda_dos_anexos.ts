// A guarda dos anexos de uma evidência (F3 §5, passos 4 e 6): origem, classe e limite de cada arquivo, e a guarda.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { guardarArquivos } from "../../../../shared/armazenamento/arquivos.ts";
import { type Classe, LIMITE, MIME_HTML, MIME_TEXTO, type RegraArquivos } from "../nucleo/schemas.ts";

/** Um anexo guardado por conteúdo (F2 §5.1); `nome` é o nome original, que o `dados` referencia. */
export interface ArquivoEvidencia {
  nome: string;
  sha256: string;
  mime: string;
  bytes: number;
}

const MiB = 1024 * 1024;
const mib = (bytes: number) => `${(bytes / MiB).toFixed(1)} MiB`;
const MAIOR = Math.max(...Object.values(LIMITE));

/** F3 §3.1: assinaturas dos formatos binários aceitos. */
const ASSINATURAS: readonly [(cabeca: Buffer) => boolean, Classe, string][] = [
  [(c) => c.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), "video", "video/webm"],
  [(c) => c.subarray(4, 8).toString("latin1") === "ftyp", "video", "video/mp4"],
  [(c) => c.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "imagem", "image/png"],
  [(c) => c.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), "imagem", "image/jpeg"],
];

/** O texto, se os bytes são UTF-8 válido; o BOM sai. */
function utf8(bytes: Buffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** `length` bytes de `fd` a partir do início, ou menos se o arquivo acabar antes. */
function ler(fd: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  return buffer.subarray(0, readSync(fd, buffer, 0, length, 0));
}

/** Classe pelos bytes iniciais e limite de tamanho (F3 §3.1), lidos da cópia privada em `fd`. */
function classificar(caminho: string, fd: number, bytes: number): { classe: Classe; mime: string } {
  const cabeca = ler(fd, 8);
  const binario = ASSINATURAS.find(([casa]) => casa(cabeca));
  if (binario) {
    const [, classe, mime] = binario;
    if (bytes > LIMITE[classe]) {
      throw new ErroDeRegra(
        `${caminho} tem ${mib(bytes)}, e ${classe} aceita até ${mib(LIMITE[classe])}`,
        "reduza o arquivo",
      );
    }
    return { classe, mime };
  }
  if (bytes > LIMITE.texto) {
    throw new ErroDeRegra(
      `${caminho} tem ${mib(bytes)} e não é vídeo WebM/MP4 nem imagem PNG/JPEG`,
      `texto e HTML aceitam até ${mib(LIMITE.texto)}`,
    );
  }
  const texto = utf8(ler(fd, bytes));
  if (texto === undefined || texto.includes("\0")) {
    throw new ErroDeRegra(
      `${caminho} não é vídeo WebM/MP4, imagem PNG/JPEG nem texto UTF-8 sem byte nulo`,
      "anexe um arquivo de um desses formatos",
    );
  }
  return /^\s*<(!doctype html|html)/i.test(texto)
    ? { classe: "html", mime: MIME_HTML }
    : { classe: "texto", mime: MIME_TEXTO };
}

/** De onde os anexos podem vir (F3 §3.2), e o que a recusa diz: `fora` completa "está fora", `copie` é o destino. */
export interface Origens {
  readonly worktree: string;
  readonly saida: string;
  readonly fora: string;
  readonly copie: string;
}

const dentro = (raiz: string, alvo: string) => relative(raiz, alvo).split(sep)[0] !== "..";

/** A origem sem links: o caminho do descritor vem resolvido, e `abrigarProcesso` deixa a saída como link para a pasta do Ambiente. */
function origemReal(raiz: string): string {
  try {
    return realpathSync(raiz);
  } catch {
    return raiz; // a origem ainda não existe (por exemplo, sem diretório de saída): vale o nome dado
  }
}

/**
 * Abre o anexo sem seguir link no último componente e confere a origem pelo caminho do próprio descritor
 * (F3 §3.2): link de pasta no meio do caminho é resolvido, e trocar o arquivo depois da abertura não muda o que se
 * lê. `O_NONBLOCK` evita esperar por um FIFO, que o `fstat` recusa em seguida.
 * ponytail: `/proc/self/fd` é do Linux; em outro sistema, `fcntl(F_GETPATH)` faria o mesmo.
 * ponytail: hard link passa. `ln /fora/segredo <worktree>/duro.txt` é aceito, porque o inode também está na
 * worktree; só um agente hostil, que já tem shell, faria isso. Se precisar, recusar `nlink > 1` ou rodar o agente
 * com outro usuário (F1 §8).
 * `caminho` é o que as mensagens mostram; `abrirEm` é onde o arquivo está no host, e só difere quando o agente declara
 * um caminho do Ambiente.
 */
function abrir(caminho: string, origens: Origens, abrirEm: string = caminho): number {
  let fd: number;
  try {
    fd = openSync(abrirEm, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error_) {
    const { code } = error_ as NodeJS.ErrnoException;
    if (code === "ELOOP") {
      throw new ErroDeRegra(`${caminho} é um link simbólico`, "anexe o próprio arquivo, não um link para ele");
    }
    if (code === "ENOENT") throw new ErroDeRegra(`${caminho} não existe`, "confira o caminho do arquivo");
    if (code === "EACCES")
      throw new ErroDeRegra(`sem permissão para ler ${caminho}`, "dê permissão de leitura ao arquivo");
    throw error_;
  }
  try {
    // O kernel dá o caminho do inode aberto, sem link algum. `realpath` aqui reabriria pelo nome e voltaria a
    // corrida. Se o arquivo foi trocado depois da abertura, vem com " (deleted)": é o último lugar dele, e o
    // conteúdo é o que estava lá.
    const alvo = readlinkSync(`/proc/self/fd/${String(fd)}`);
    if (![origens.worktree, origens.saida].some((raiz) => dentro(origemReal(raiz), alvo))) {
      throw new ErroDeRegra(`${caminho} está fora ${origens.fora}`, `copie-o para ${origens.copie}`);
    }
    const estado = fstatSync(fd);
    if (!estado.isFile()) throw new ErroDeRegra(`${caminho} não é um arquivo regular`, "anexe um arquivo comum");
    // Recusa cedo o que nenhuma classe aceita, sem copiar; o limite de cada classe é conferido na cópia.
    if (estado.size > MAIOR) {
      throw new ErroDeRegra(
        `${caminho} tem ${mib(estado.size)}, e nenhum anexo passa de ${mib(MAIOR)}`,
        "reduza o arquivo",
      );
    }
    return fd;
  } catch (error_) {
    closeSync(fd);
    throw error_;
  }
}

/** Um anexo a guardar: `caminho` é o que as mensagens mostram, `abrirEm` o do host e `sha256` o que o arquivo deve ter. */
interface AnexoAAbrir {
  readonly caminho: string;
  readonly abrirEm: string;
  readonly sha256?: string;
}

/** O SHA-256 dos `bytes` de `fd`, lido em blocos para não trazer um vídeo inteiro à memória. */
function sha256Do(fd: number, bytes: number): string {
  const hash = createHash("sha256");
  const bloco = Buffer.alloc(MiB);
  // `fd` é a cópia privada, com exatamente `bytes` bytes: a leitura nunca volta vazia antes do fim.
  for (let lidos = 0; lidos < bytes;) {
    const n = readSync(fd, bloco, 0, Math.min(MiB, bytes - lidos), lidos);
    hash.update(bloco.subarray(0, n));
    lidos += n;
  }
  return hash.digest("hex");
}

/**
 * Origem, classe e limite de cada arquivo, e a guarda; quantidade, nomes e regras cruzadas são do
 * `AvaliadorDeEvidencia`, que roda antes. A classe é conferida na cópia privada que `guardarArquivos` faz, e não no arquivo do
 * agente: o que fica guardado é o que foi validado.
 */
function guardarAbertos(
  banco: DatabaseSync,
  anexos: readonly AnexoAAbrir[],
  tipo: string,
  regra: RegraArquivos,
  origens: Origens,
): ArquivoEvidencia[] {
  const abertos: { fd: number; caminho: string; nome: string; sha256?: string }[] = [];
  const classes: Classe[] = [];
  try {
    for (const { caminho, abrirEm, sha256 } of anexos) {
      abertos.push({
        fd: abrir(caminho, origens, abrirEm),
        caminho,
        nome: basename(caminho),
        sha256,
      });
    }
    return guardarArquivos(
      banco,
      abertos,
      (copia, bytes, { caminho, nome, sha256 }) => {
        if (sha256 !== undefined && sha256Do(copia, bytes) !== sha256) {
          throw new ErroDeRegra(
            `${caminho} não tem o SHA-256 enviado`,
            "o arquivo mudou depois de lido; envie-o de novo",
          );
        }
        const { classe, mime } = classificar(caminho, copia, bytes);
        if (!regra.classes.includes(classe)) {
          throw new ErroDeRegra(
            `${caminho} é ${classe}, e ${tipo} aceita só ${regra.classes.join(" ou ")}`,
            "anexe um arquivo de uma dessas classes",
          );
        }
        classes.push(classe);
        return { nome, mime };
      },
      MAIOR,
      // A regra do conjunto, depois de classificar o último e antes de guardar qualquer um.
      () => {
        const exigida = regra.temClasse;
        if (exigida && !classes.some((c) => exigida.classes.includes(c))) {
          throw new ErroDeRegra(exigida.mensagem, `anexe também um arquivo ${exigida.classes.join(" ou ")}`);
        }
      },
    );
  } finally {
    for (const { fd } of abertos) closeSync(fd);
  }
}

/** Guarda os anexos que o host abre pelo caminho (o CLI externo e a aula gerada pelo core). */
export function guardarAnexos(
  banco: DatabaseSync,
  caminhos: readonly string[],
  tipo: string,
  regra: RegraArquivos,
  origens: Origens,
): ArquivoEvidencia[] {
  return guardarAbertos(
    banco,
    caminhos.map((caminho) => ({ caminho, abrirEm: caminho })),
    tipo,
    regra,
    origens,
  );
}

/** Um anexo do agente: o caminho no Ambiente dele e o SHA-256 dos bytes que ele enviou (a entrega já os conferiu). */
export interface AnexoEnviado {
  readonly caminho: string;
  readonly sha256: string;
}

/** O que a guarda usa do Ambiente do agente: o caminho, no Ambiente, de um caminho do host. */
interface CaminhosDoAmbiente {
  caminhoNoAmbiente(caminhoNoHost: string): string;
}

/** Os anexos enviados e o Ambiente em que os caminhos declarados valem. */
export interface AnexosEnviados {
  readonly anexos: readonly AnexoEnviado[];
  readonly ambiente: CaminhosDoAmbiente;
}

/**
 * O caminho no host de um caminho declarado no Ambiente: `caminhoNoAmbiente` só vai do host ao Ambiente, então a
 * inversão passa pelas raízes permitidas. Fora delas, sai `undefined`.
 */
function caminhoDoHost(declarado: string, origens: Origens, ambiente: CaminhosDoAmbiente): string | undefined {
  for (const raizNoHost of [origens.worktree, origens.saida]) {
    const raizNoAmbiente = ambiente.caminhoNoAmbiente(raizNoHost);
    if (dentro(raizNoAmbiente, declarado)) return join(raizNoHost, relative(raizNoAmbiente, declarado));
  }
  return undefined;
}

/**
 * Guarda os anexos que o agente enviou de dentro do Ambiente: inverte o caminho para o host, exige que esteja na worktree ou na saída e que o arquivo ali tenha o mesmo SHA-256, abrindo com
 * `O_NOFOLLOW` como `guardarAnexos`. Assim o agente só anexa o que está no seu Espaço, e o que fica guardado é o
 * arquivo do host.
 */
export function guardarAnexosEnviados(
  banco: DatabaseSync,
  { anexos, ambiente }: AnexosEnviados,
  tipo: string,
  regra: RegraArquivos,
  origens: Origens,
): ArquivoEvidencia[] {
  const aAbrir = anexos.map(({ caminho, sha256 }) => {
    if (!isAbsolute(caminho)) {
      throw new ErroDeRegra(`${caminho} não é um caminho absoluto`, "informe o caminho completo do arquivo");
    }
    // O `open` lança TypeError (500) para byte nulo.
    if (caminho.includes("\0")) {
      throw new ErroDeRegra(`${JSON.stringify(caminho)} tem byte nulo no caminho`, "informe o caminho real do arquivo");
    }
    const abrirEm = caminhoDoHost(caminho, origens, ambiente);
    if (abrirEm === undefined) {
      throw new ErroDeRegra(`${caminho} está fora ${origens.fora}`, `copie-o para ${origens.copie}`);
    }
    return { caminho, abrirEm, sha256 };
  });
  return guardarAbertos(banco, aAbrir, tipo, regra, origens);
}
