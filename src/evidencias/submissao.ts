// Submissão de evidência pelo agente (F3 §5): valida tudo, guarda os arquivos e só então roda C17 numa transação.
import { closeSync, constants, fstatSync, openSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Agregado, type ArquivoEvidencia, type Ator, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "../dominio/erros.ts";
import { exigirRegistroDeEvidencia, registrarEvidencia } from "../dominio/evidencia.ts";
import { guardarArquivos } from "../persistencia/arquivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { type Classe, LIMITE, MIME_TEXTO, type RegraArquivos, schemaDe } from "./schemas.ts";

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
    ? { classe: "html", mime: "text/html; charset=utf-8" }
    : { classe: "texto", mime: MIME_TEXTO };
}

const dentro = (raiz: string, alvo: string) => relative(raiz, alvo).split(sep)[0] !== "..";

/**
 * Abre o anexo sem seguir link no último componente e confere a origem pelo caminho do próprio descritor
 * (F3 §3.2): link de pasta no meio do caminho é resolvido, e trocar o arquivo depois da abertura não muda o que se
 * lê. `O_NONBLOCK` evita esperar por um FIFO, que o `fstat` recusa em seguida.
 * ponytail: `/proc/self/fd` é do Linux; em outro sistema, `fcntl(F_GETPATH)` faria o mesmo.
 * ponytail: hard link passa. `ln /fora/segredo <worktree>/duro.txt` é aceito, porque o inode também está na
 * worktree; só um agente hostil, que já tem shell, faria isso. Se precisar, recusar `nlink > 1` ou rodar o agente
 * com outro usuário (F1 §8).
 */
function abrir(caminho: string, raizes: readonly string[], saida: string): number {
  let fd: number;
  try {
    fd = openSync(caminho, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
    if (!raizes.some((raiz) => dentro(raiz, alvo))) {
      throw new ErroDeRegra(
        `${caminho} está fora da worktree da issue e do diretório de saída`,
        `copie-o para $FABRIQUINHA_SAIDA (${saida})`,
      );
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

/**
 * Quantidade, nomes, origem, classe, limite e `temClasse` (F3 §3, §5 passos 4 a 6). A classe é conferida na cópia
 * privada que `guardarArquivos` faz, e não no arquivo do agente: o que fica guardado é o que foi validado.
 */
function guardarAnexos(
  banco: DatabaseSync,
  caminhos: readonly string[],
  tipo: TipoEvidencia,
  regra: RegraArquivos,
  origens: { worktree: string; saida: string },
): ArquivoEvidencia[] {
  if (caminhos.length < regra.min) {
    throw new ErroDeRegra(
      `${tipo} precisa de pelo menos ${String(regra.min)} arquivo(s), e veio ${String(caminhos.length)}`,
      "anexe com --arquivo <caminho>",
    );
  }
  if (regra.max !== undefined && caminhos.length > regra.max) {
    throw new ErroDeRegra(
      `${tipo} aceita no máximo ${String(regra.max)} arquivo(s), e vieram ${String(caminhos.length)}`,
      "submeta sem os excedentes",
    );
  }
  const nomes = caminhos.map((caminho) => basename(caminho));
  const longo = nomes.find((nome) => nome.length > 200);
  if (longo) throw new ErroDeRegra(`o nome ${longo} passa de 200 caracteres`, "renomeie o arquivo");
  const repetido = nomes.find((nome, i) => nomes.indexOf(nome) !== i);
  if (repetido) throw new ErroDeRegra(`dois anexos se chamam ${repetido}`, "renomeie um deles");

  const abertos: { fd: number; caminho: string; nome: string }[] = [];
  const classes: Classe[] = [];
  try {
    for (const caminho of caminhos) {
      abertos.push({
        fd: abrir(caminho, [origens.worktree, origens.saida], origens.saida),
        caminho,
        nome: basename(caminho),
      });
    }
    return guardarArquivos(
      banco,
      abertos,
      (copia, bytes, { caminho, nome }) => {
        const { classe, mime } = classificar(caminho, copia, bytes);
        if (!regra.classes.includes(classe)) {
          throw new ErroDeRegra(
            `${caminho} é ${classe}, e ${tipo} aceita só ${regra.classes.join(" ou ")}`,
            "anexe um arquivo de uma dessas classes",
          );
        }
        // 5: a regra do conjunto, depois de classificar o último e antes de guardar qualquer um.
        classes.push(classe);
        const exigida = regra.temClasse;
        if (exigida && classes.length === abertos.length && !classes.some((c) => exigida.classes.includes(c))) {
          throw new ErroDeRegra(exigida.mensagem, `anexe também um arquivo ${exigida.classes.join(" ou ")}`);
        }
        return { nome, mime };
      },
      MAIOR,
    );
  } finally {
    for (const { fd } of abertos) closeSync(fd);
  }
}

/**
 * `fabriquinha evidencia add` (F3 §5): o primeiro passo que falhar interrompe sem gravar nada no banco.
 * Erro de schema em `dados` sai como `ZodError`, com o caminho de cada campo a partir de `dados`; quem mostra ao
 * agente (F7) o formata com `z.prettifyError`, como faz com qualquer erro de schema.
 */
export function submeter(
  banco: DatabaseSync,
  ator: Ator,
  tipo: unknown,
  dados: unknown,
  caminhos: readonly string[],
): Agregado {
  // 1 e 2: escopo e catálogo, no estado atual; C17 confere de novo na transação.
  if (ator.tipo !== "agente") {
    throw new ErroDeEscopo("só o agente do ticket submete evidência", "a Fabriquinha registra as dela nos coletores");
  }
  const tipoValido = z.object({ tipo: TipoEvidencia }).parse({ tipo }).tipo;
  const antes = agregadoDoTicket(banco, ator.ticket);
  if (!antes) {
    throw new ErroDeEscopo(
      `o ticket T-${String(ator.ticket)} não existe`,
      "confira a execução em FABRIQUINHA_EXECUCAO",
    );
  }
  exigirRegistroDeEvidencia(antes, ator, ator.ticket, tipoValido);

  // 3
  const schema = schemaDe(tipoValido);
  const validos = z.object({ dados: schema.dados }).parse({ dados }).dados;

  // 4, 5 e 6: fora da transação (F2 §5.2); se a 7 falhar, sobra só arquivo sem referência. As regras cruzadas de
  // `dados` (5) já vieram no schema do passo 3. As origens partem da raiz real da Fabriquinha e nada abaixo dela é
  // resolvido: trocar a worktree ou a saída por um link não as leva para outro lugar.
  const raiz = realpathSync(raizDo(banco));
  const arquivos = guardarAnexos(banco, caminhos, tipoValido, schema.arquivos, {
    worktree: join(raiz, "worktrees", antes.issue.projeto, `I-${String(antes.issue.id)}`),
    saida: join(raiz, "execucoes", `E-${String(ator.execucao)}`, "saida"),
  });

  // 7
  return comIssue(banco, antes.issue.id, "registrarEvidencia", ator, (ag, ctx) =>
    registrarEvidencia(ag, { ticket: ator.ticket, tipo: tipoValido, dados: validos, arquivos }, ator, ctx),
  );
}
