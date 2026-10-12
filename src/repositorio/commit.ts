// Commit do ticket de desenvolvimento (F5 §4): `git add -A`, `git commit` com os hooks do repositório e o que mudou.
// Também o diff da issue inteira (F5 §8), que a revisão cruza com o desenho.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Issue, Ticket } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { raizDo } from "../persistencia/banco.ts";
import { type ArquivoCommit, type Commit, commitRegistrado, StatusArquivo } from "../persistencia/commits.ts";
import { ambienteSemCredenciais, executar, git, LIMITE_COMANDO_MS } from "../processo.ts";
import { caminhoDaWorktree, exigirGit, naFilaDoProjeto } from "./worktree.ts";

const COLUNAS = 72;
/** Caracteres do fim da saída do commit que vão para a mensagem de falha do ticket. */
const FIM_DA_SAIDA = 1500;

/**
 * A linha em até 72 colunas, quebrando entre palavras; palavra maior que isso (uma URL) fica inteira na sua linha.
 * ponytail: a quebra junta os espaços e perde o recuo da linha longa; Markdown com bloco de código longo sai quebrado.
 */
function quebrar(linha: string): string[] {
  if (linha.length <= COLUNAS) return [linha.trimEnd()];
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of linha.trim().split(/\s+/)) {
    if (atual && atual.length + 1 + palavra.length > COLUNAS) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = atual ? `${atual} ${palavra}` : palavra;
    }
  }
  return [...linhas, atual];
}

/** F5 §4: `<feat|fix>: <título> [I-<n>/T-<m>]` e, se houver, a descrição do ticket quebrada em 72 colunas. */
export function mensagemDoCommit(
  issue: Pick<Issue, "id" | "tipo">,
  ticket: Pick<Ticket, "id" | "titulo" | "descricao">,
): string {
  const tipo = issue.tipo === "funcionalidade" ? "feat" : "fix";
  const assunto = `${tipo}: ${ticket.titulo} [I-${String(issue.id)}/T-${String(ticket.id)}]`;
  const corpo = ticket.descricao.trim().split("\n").flatMap(quebrar).join("\n");
  return corpo ? `${assunto}\n\n${corpo}` : assunto;
}

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
 * Sem nada a commitar: se a HEAD é um commit que nenhum ticket registrou e que não está em branch remota, o erro diz
 * de quem ele é. Com a marca de outro ticket, é o commit dele cujo C7 falhou: executá-lo de novo o adota. Sem marca,
 * o agente commitou por conta própria (o P1 proíbe), e o erro diz como desfazer. A Fabriquinha não desfaz sozinha:
 * um merge da base feito pelo agente seria achatado, e o trabalho de outro ticket viraria deste.
 */
async function nadaACommitar(banco: DatabaseSync, worktree: string): Promise<ErroDeRegra> {
  const head = (await exigirGit(worktree, "rev-parse", "HEAD")).trim();
  // Na base, ou em qualquer branch remota, o commit não é do agente desta execução.
  const remoto = (await exigirGit(worktree, "for-each-ref", "--contains", "HEAD", "refs/remotes")) !== "";
  if (remoto || commitRegistrado(banco, head)) {
    return new ErroDeRegra(
      "o ticket de desenvolvimento não alterou nenhum arquivo",
      "reabra o ticket com uma instrução do que o agente deve mudar",
    );
  }
  const commit = `a HEAD da worktree é o commit ${head.slice(0, 12)}`;
  const deOutro = /\[I-\d+\/(T-\d+)\]/.exec(await exigirGit(worktree, "log", "-1", "--format=%s", "HEAD"))?.[1];
  if (deOutro) {
    return new ErroDeRegra(
      `o ticket de desenvolvimento não deixou alteração para commitar, e ${commit}, de ${deOutro}, que não foi registrado`,
      `execute ${deOutro} de novo: ele adota o próprio commit; depois, este ticket`,
    );
  }
  return new ErroDeRegra(
    `o ticket de desenvolvimento não deixou alteração para commitar, e ${commit}, ` +
      "que nenhum ticket registrou: o agente commitou por conta própria",
    `devolva o trabalho ao stage com git -C ${worktree} reset --soft HEAD~1 (repita até a HEAD ser um commit da ` +
      "Fabriquinha ou da base; num merge da base, refaça-o com git merge --no-commit) e execute o ticket de novo",
  );
}

/** `git commit` com os hooks, sem credenciais e com limite; `emendar` refaz a HEAD (`--amend`). */
async function commitar(worktree: string, mensagem: string, emendar: boolean, limiteMs: number): Promise<void> {
  const vazio = mkdtempSync(join(tmpdir(), "fabriquinha-commit-"));
  try {
    const r = await executar(
      "git",
      ["-C", worktree, "commit", "-q", ...(emendar ? ["--amend"] : []), "--cleanup=verbatim", "-m", mensagem],
      {
        env: { ...ambienteSemCredenciais(process.env, vazio), GIT_TERMINAL_PROMPT: "0" },
        limiteMs,
        ultimos: FIM_DA_SAIDA,
      },
    );
    if (r.codigo !== 0) {
      const motivo = r.limiteEstourado
        ? `passou de ${String(limiteMs / 60_000)} minutos`
        : `saiu com código ${String(r.codigo)}`;
      throw new ErroDeRegra(
        `o git commit ${motivo}, com os hooks do repositório: ${(r.saida + r.erro).trim().slice(-FIM_DA_SAIDA)}`,
        "corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks",
      );
    }
  } finally {
    rmSync(vazio, { recursive: true, force: true });
  }
}

/**
 * F5 §4, passos 1 a 3 e a leitura do passo 4: commita tudo o que o ticket mudou na worktree da issue e devolve o
 * commit para o F5 gravar na transação de C7. Nunca usa `--no-verify`: os hooks do repositório rodam, e o que reprova
 * faz o ticket falhar com a saída. Os hooks rodam código do agente (o pre-commit costuma chamar os testes), então o
 * commit roda sem credenciais, como os coletores (F5 §5.0), e com o limite de 30 minutos dos comandos do projeto.
 *
 * Retomada: se o commit saiu, mas a transação do C7 falhou, sobra um commit não publicado com a marca
 * `[I-<n>/T-<m>]` deste ticket, o órfão, e a próxima execução não teria o que commitar. Achar a marca é seguro: T-<m>
 * é global, e ticket concluído não executa de novo, logo um commit com a marca de um ticket em execução nunca foi
 * registrado.
 * - Órfão na HEAD: emenda (`--amend`, de novo com os hooks) com o que o agente mudou desde então. `--amend` e não
 *   `reset --soft`: um merge da base que o agente deixou para o nosso commit concluir continua merge.
 * - Órfão mais fundo (outro ticket commitou por cima) e nada novo: adota o órfão como está; hooks e gates já rodaram
 *   quando ele nasceu.
 * - Órfão mais fundo e alteração nova: commit normal.
 *   ponytail: os arquivos do órfão ficam sem ticket e perdem a atribuição no F6; reescrever a história para juntá-los
 *   desfaria commits de outros tickets.
 */
export async function commitarTicket(
  banco: DatabaseSync,
  projeto: string,
  issue: Pick<Issue, "id" | "tipo">,
  ticket: Pick<Ticket, "id" | "titulo" | "descricao">,
  limiteMs = LIMITE_COMANDO_MS,
): Promise<Commit> {
  const raiz = raizDo(banco);
  const worktree = caminhoDaWorktree(raiz, projeto, issue.id);
  const marca = `[I-${String(issue.id)}/T-${String(ticket.id)}]`;
  return naFilaDoProjeto(raiz, projeto, async () => {
    const head = (await exigirGit(worktree, "rev-parse", "HEAD")).trim();
    // O `--grep` olha a mensagem inteira: o commit registrado de outro ticket que cita a marca não é órfão.
    const comMarca = await exigirGit(
      worktree,
      "log",
      "-F",
      `--grep=${marca}`,
      "--format=%H",
      "HEAD",
      "--not",
      "--remotes",
    );
    const orfao = comMarca.split("\n").find((sha) => sha !== "" && !commitRegistrado(banco, sha)) ?? "";
    await exigirGit(worktree, "add", "-A");
    const nada = (await git(worktree, "diff", "--cached", "--quiet")).codigo === 0;
    let alvo = "HEAD";
    if (orfao !== "" && orfao !== head && nada) {
      alvo = orfao;
    } else {
      if (orfao === "" && nada) throw await nadaACommitar(banco, worktree);
      await commitar(worktree, mensagemDoCommit(issue, ticket), orfao === head, limiteMs);
    }
    // `-M` explícito: a renomeação é detectada mesmo com `diff.renames` desligado na configuração do Auditor. Num
    // merge, o diff é contra o primeiro pai, a branch da issue: sem isso o git mostra o diff combinado.
    const mudou = (formato: string) =>
      exigirGit(worktree, "show", "-z", "-M", "--diff-merges=first-parent", formato, "--format=", alvo);
    return {
      sha: (await exigirGit(worktree, "rev-parse", alvo)).trim(),
      // Lida de volta: um hook commit-msg pode tê-la mudado.
      mensagem: (await exigirGit(worktree, "show", "-s", "--format=%B", alvo)).trimEnd(),
      em: new Date().toISOString(),
      arquivos: arquivosDe(await mudou("--name-status"), await mudou("--numstat")),
    };
  });
}

/**
 * F5 §8: o que a issue commitou desde que saiu da base, de `merge-base(origin/<branchBase>, HEAD)` até a `HEAD` da
 * worktree. Sem `fetch`: vale a base que o repositório já conhece, e o merge-base não muda se ela andou depois.
 * Alteração não commitada não entra; na revisão, só o desenvolvimento commita.
 */
export async function diffDaIssue(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "branchBase">,
  issue: Id,
): Promise<{ base: string; head: string; arquivos: ArquivoCommit[] }> {
  const worktree = caminhoDaWorktree(raiz, projeto.nome, issue);
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const head = (await exigirGit(worktree, "rev-parse", "HEAD")).trim();
    const base = (await exigirGit(worktree, "merge-base", `refs/remotes/origin/${projeto.branchBase}`, head)).trim();
    // `-M` explícito, como no commit: a renomeação aparece mesmo com `diff.renames` desligado.
    const diff = (formato: string) => exigirGit(worktree, "diff", "-z", "-M", formato, base, head);
    return { base, head, arquivos: arquivosDe(await diff("--name-status"), await diff("--numstat")) };
  });
}
