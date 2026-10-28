// Commit do ticket (F5 §4): `git commit` com os hooks do repositório, sem credenciais, e o que ele mudou por arquivo.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroDeRegra, ErroDeReprovacao, ErroExterno } from "../dominio/erros.ts";
import { type ArquivoCommit, StatusArquivo } from "../persistencia/commits.ts";
import { ambienteSemCredenciais, executar } from "../processo.ts";

/** Caracteres do fim da saída do commit que vão para a mensagem de falha do ticket. */
const FIM_DA_SAIDA = 1500;

/**
 * Junta o `-z` de `--name-status` e o de `--numstat`, que listam os mesmos arquivos na mesma ordem. Nome:
 * `<status>\0<caminho>\0`, ou `R<similaridade>\0<anterior>\0<caminho>\0`. Números: `<+>\t<->\t<caminho>\0`, ou
 * `<+>\t<->\t\0<anterior>\0<caminho>\0` na renomeação, com `-` em arquivo binário. Se os caminhos das duas listas
 * não casarem, lança em vez de gravar os números de um arquivo no outro.
 */
export function arquivosDe(nomes: string, numeros: string): ArquivoCommit[] {
  const n = nomes.split("\0");
  const c = numeros.split("\0");
  const arquivos: ArquivoCommit[] = [];
  for (let i = 0, j = 0; n[i];) {
    const [status, um, dois] = n.slice(i, i + 3) as [string, string, string];
    const renomeado = status.startsWith("R");
    const caminho = renomeado ? dois : um;
    const contado = numerosDe(c, j);
    if (contado.caminho !== caminho) {
      throw new ErroDeRegra(
        `as listas de arquivos do commit não casam: ${caminho} no --name-status, ${String(contado.caminho)} no --numstat`,
        "confira a versão do git e execute o ticket de novo",
      );
    }
    i += renomeado ? 3 : 2;
    j += contado.registros;
    arquivos.push({
      caminho,
      ...(renomeado && { caminhoAnterior: um }),
      // Troca de tipo (arquivo por link simbólico) conta como modificação.
      status: StatusArquivo.parse(status === "T" ? "M" : status.charAt(0)),
      adicionadas: contado.adicionadas,
      removidas: contado.removidas,
    });
  }
  return arquivos;
}

/** O arquivo do `--numstat -z` que começa em `c[j]` e quantos registros ele ocupa (3 na renomeação). */
function numerosDe(c: readonly string[], j: number) {
  const [mais, menos, ...resto] = String(c[j]).split("\t") as [string, string, ...string[]];
  // O caminho pode ter tab: só os dois primeiros separam os números.
  const caminho = resto.join("\t");
  const numero = (texto: string) => (texto === "-" ? null : Number(texto));
  return {
    caminho: caminho === "" ? c[j + 2] : caminho,
    registros: caminho === "" ? 3 : 1,
    adicionadas: numero(mais),
    removidas: numero(menos),
  };
}

/**
 * `git commit` com os hooks, sem credenciais e com limite; `emendar` refaz a HEAD (`--amend`), e `semAlteracao`
 * aceita o commit vazio.
 */
export async function commitar(
  worktree: string,
  mensagem: string,
  { emendar, semAlteracao }: { emendar: boolean; semAlteracao: boolean },
  limiteMs: number,
): Promise<void> {
  const vazio = mkdtempSync(join(tmpdir(), "fabriquinha-commit-"));
  try {
    const r = await executar(
      "git",
      [
        "-C",
        worktree,
        "commit",
        "-q",
        ...(emendar ? ["--amend"] : []),
        ...(semAlteracao ? ["--allow-empty"] : []),
        "--cleanup=verbatim",
        "-m",
        mensagem,
      ],
      {
        env: { ...ambienteSemCredenciais(process.env, vazio), GIT_TERMINAL_PROMPT: "0" },
        limiteMs,
        ultimos: FIM_DA_SAIDA,
      },
    );
    if (r.codigo !== 0) {
      const saida = (r.saida + r.erro).trim().slice(-FIM_DA_SAIDA);
      // Hook travado é infraestrutura, não reprovação do código do agente.
      if (r.limiteEstourado) {
        throw new ErroExterno(
          `o git commit passou de ${String(limiteMs / 60_000)} minutos, com os hooks do repositório: ${saida}`,
          "corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks",
        );
      }
      throw new ErroDeReprovacao(
        `o git commit saiu com código ${String(r.codigo)}, com os hooks do repositório: ${saida}`,
        "corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks",
      );
    }
  } finally {
    rmSync(vazio, { recursive: true, force: true });
  }
}
