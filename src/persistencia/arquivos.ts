// Arquivos de evidência guardados por conteúdo (F2 §5): `arquivos/<2 primeiros hex>/<sha256>`, imutáveis.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import { raizDo } from "./banco.ts";

const BLOCO = 1 << 20;

/** Caminho no disco do arquivo com esse hash. Só aceita um SHA-256: nenhum caminho de fora vira caminho daqui. */
export function caminhoArquivo(banco: DatabaseSync, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ErroDeRegra(`${sha256} não é um SHA-256`, "use o sha256 gravado em evidencia_arquivo");
  }
  return join(raizDo(banco), "arquivos", sha256.slice(0, 2), sha256);
}

/**
 * O anexo com esse hash, se alguma evidência o registrou (F7 §4.3): o nome original e o mime da primeira que o
 * registrou. Só um hash registrado vira caminho de arquivo servido.
 */
export function arquivoRegistrado(
  banco: DatabaseSync,
  sha256: string,
): { nome: string; mime: string; bytes: number } | undefined {
  const linha = banco
    .prepare("SELECT nome, mime, bytes FROM evidencia_arquivo WHERE sha256 = ? ORDER BY rowid LIMIT 1")
    .get(sha256);
  return linha && { nome: String(linha.nome), mime: String(linha.mime), bytes: Number(linha.bytes) };
}

function sincronizarDiretorio(diretorio: string): void {
  const fd = openSync(diretorio, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Liga o temporário ao nome final pelo hash; se o hash já existe, o guardado fica intocado (deduplicação). */
function ligar(banco: DatabaseSync, pasta: string, temporario: string, sha256: string): void {
  const destino = caminhoArquivo(banco, sha256);
  mkdirSync(dirname(destino), { recursive: true, mode: 0o700 });
  try {
    linkSync(temporario, destino);
  } catch (error_) {
    if ((error_ as NodeJS.ErrnoException).code !== "EEXIST") throw error_;
  }
  sincronizarDiretorio(dirname(destino));
  sincronizarDiretorio(pasta);
}

/**
 * Guarda os arquivos abertos em `origens[].fd` (F2 §5.1), cada um com até `teto` bytes. Cada um é lido uma vez só,
 * do início, para um temporário privado
 * em `arquivos/` (0600), calculando o SHA-256 na mesma passada; `conferir` valida esse temporário, que ninguém mais
 * altera, e devolve o que quiser anexar ao resultado. Depois de conferir todos, `antesDeGuardar` confere o conjunto.
 * Só quando tudo passa os temporários são ligados aos nomes finais: o que fica guardado é exatamente o que foi
 * conferido, e uma recusa não guarda nada.
 * `link` é atômico como o `rename` e, ao contrário dele, não sobrescreve: se o hash já existe, o guardado fica
 * intocado e a cópia é descartada (deduplicação). O temporário fica em `arquivos/` porque a subpasta depende do hash,
 * que só se conhece no fim; é o mesmo sistema de arquivos, o que basta para o `link`.
 * ponytail: cópia síncrona em blocos de 1 MiB. Quem chama é o CLI do agente, um processo por submissão, e o serviço
 * nos coletores (F3 §6), com logs de até 5 MiB, que bloqueiam o laço de eventos dele só durante a cópia. Se um anexo
 * grande passar a ser copiado pelo serviço, trocar por cópia assíncrona.
 * ponytail: sem coleta de lixo. Sobram um arquivo sem referência quando a transação depois desta cópia falha (F2
 * §5.2) e um `.tmp-*` em `arquivos/` quando o processo morre no meio da cópia; ambos são inofensivos. Se o disco
 * pesar, uma varredura que apague hashes sem referência e `.tmp-*` antigos resolve.
 */
export function guardarArquivos<O extends { readonly fd: number }, T extends object>(
  banco: DatabaseSync,
  origens: readonly O[],
  conferir: (copia: number, bytes: number, origem: O) => T,
  teto: number,
  antesDeGuardar?: () => void,
): (T & { sha256: string; bytes: number })[] {
  const pasta = join(raizDo(banco), "arquivos");
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const temporarios: string[] = [];
  try {
    const copias = origens.map((origem) => {
      const temporario = join(pasta, `.tmp-${randomUUID()}`);
      temporarios.push(temporario);
      const copia = openSync(temporario, "wx+", 0o600);
      try {
        const hash = createHash("sha256");
        const bloco = Buffer.alloc(BLOCO);
        let bytes = 0;
        // Lê no máximo `teto + 1` bytes: um arquivo que não para de crescer é recusado sem encher o disco.
        const ler = () => readSync(origem.fd, bloco, 0, Math.min(BLOCO, teto + 1 - bytes), bytes);
        for (let lidos = ler(); lidos > 0; lidos = ler()) {
          hash.update(bloco.subarray(0, lidos));
          for (let escritos = 0; escritos < lidos;) escritos += writeSync(copia, bloco, escritos, lidos - escritos);
          bytes += lidos;
          if (bytes > teto) {
            throw new ErroDeRegra(
              `um anexo passou de ${String(teto)} bytes durante a cópia`,
              "anexe um arquivo menor, que não esteja sendo escrito",
            );
          }
        }
        fsyncSync(copia);
        return { temporario, ...conferir(copia, bytes, origem), sha256: hash.digest("hex"), bytes };
      } finally {
        closeSync(copia);
      }
    });
    antesDeGuardar?.();
    return copias.map(({ temporario, ...guardado }) => {
      ligar(banco, pasta, temporario, guardado.sha256);
      return guardado as T & { sha256: string; bytes: number };
    });
  } finally {
    for (const temporario of temporarios) rmSync(temporario, { force: true });
  }
}

/** Guarda o conteúdo já em memória (o anexo de um Usuário Simulado, F8 §2) do mesmo jeito: por hash, sem sobrescrever. */
export function guardarBytes(banco: DatabaseSync, conteudo: Buffer): { sha256: string; bytes: number } {
  const pasta = join(raizDo(banco), "arquivos");
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const temporario = join(pasta, `.tmp-${randomUUID()}`);
  try {
    const copia = openSync(temporario, "wx", 0o600);
    try {
      for (let escritos = 0; escritos < conteudo.length;) escritos += writeSync(copia, conteudo, escritos);
      fsyncSync(copia);
    } finally {
      closeSync(copia);
    }
    const sha256 = createHash("sha256").update(conteudo).digest("hex");
    ligar(banco, pasta, temporario, sha256);
    return { sha256, bytes: conteudo.length };
  } finally {
    rmSync(temporario, { force: true });
  }
}
