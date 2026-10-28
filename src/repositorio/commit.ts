// Commit do ticket de desenvolvimento (F5 §4): `git add -A`, `git commit` com os hooks do repositório e o que mudou.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Issue, Ticket } from "../dominio/agregado.ts";
import { ErroDeRegra, ErroDeReprovacao, ErroExterno } from "../dominio/erros.ts";
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
 * Sem nada a commitar e a HEAD num commit que nenhum ticket registrou e que não está em branch remota: o agente
 * commitou por conta própria (o P1 proíbe), e o erro diz como desfazer. A Fabriquinha não desfaz sozinha: um merge da
 * base feito pelo agente seria achatado.
 */
function agenteCommitou(worktree: string, head: string): ErroDeRegra {
  return new ErroDeRegra(
    "o ticket de desenvolvimento não deixou alteração para commitar, e a HEAD da worktree é o commit " +
      `${head.slice(0, 12)}, que nenhum ticket registrou: o agente commitou por conta própria`,
    `devolva o trabalho ao stage com git -C ${worktree} reset --soft HEAD~1 (repita até a HEAD ser um commit da ` +
      "Fabriquinha ou da base; num merge da base, refaça-o com git merge --no-commit) e execute o ticket de novo",
  );
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

/**
 * F5 §4, passos 1 a 3 e a leitura do passo 4: commita tudo o que o ticket mudou na worktree da issue e devolve o
 * commit para o F5 gravar na transação de C7. Nunca usa `--no-verify`: os hooks do repositório rodam, e o que reprova
 * faz o ticket falhar com a saída. Os hooks rodam código do agente (o pre-commit costuma chamar os testes), então o
 * commit roda sem credenciais, como os coletores (F5 §5.0), e com o limite de 30 minutos dos comandos do projeto.
 *
 * Sem alteração, o commit sai vazio: o trabalho do ticket já estava na branch, e o C7 continua exigindo o commit do
 * ticket. A revisão cruza o diff da issue inteira com o desenho.
 *
 * Retomada: se o commit saiu, mas a transação do C7 falhou, a HEAD é um commit não publicado e não registrado com a
 * marca `[I-<n>/T-<m>]` deste ticket, o órfão. Ele é emendado (`--amend`, de novo com os hooks) com o que o agente
 * mudou desde então. `--amend` e não `reset --soft`: um merge da base que o agente deixou para o nosso commit concluir
 * continua merge. Nenhum outro ticket commita por cima do órfão: o C5 só executa um ticket de desenvolvimento depois
 * dos anteriores concluídos.
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
    // Na base, em qualquer branch remota ou registrado por um ticket, o commit não é do agente desta execução.
    const conhecido =
      commitRegistrado(banco, head) ||
      (await exigirGit(worktree, "for-each-ref", "--contains", "HEAD", "refs/remotes")) !== "";
    // A mensagem inteira: o commit registrado de outro ticket que cita a marca no corpo já saiu como conhecido.
    const orfao = !conhecido && (await exigirGit(worktree, "show", "-s", "--format=%B", "HEAD")).includes(marca);
    await exigirGit(worktree, "add", "-A");
    const semAlteracao = (await git(worktree, "diff", "--cached", "--quiet")).codigo === 0;
    if (semAlteracao && !conhecido && !orfao) throw agenteCommitou(worktree, head);
    await commitar(worktree, mensagemDoCommit(issue, ticket), { emendar: orfao, semAlteracao }, limiteMs);
    // `-M` explícito: a renomeação é detectada mesmo com `diff.renames` desligado na configuração do Auditor. Num
    // merge, o diff é contra o primeiro pai, a branch da issue: sem isso o git mostra o diff combinado.
    const mudou = (formato: string) =>
      exigirGit(worktree, "show", "-z", "-M", "--diff-merges=first-parent", formato, "--format=", "HEAD");
    return {
      sha: (await exigirGit(worktree, "rev-parse", "HEAD")).trim(),
      // Lida de volta: um hook commit-msg pode tê-la mudado.
      mensagem: (await exigirGit(worktree, "show", "-s", "--format=%B", "HEAD")).trimEnd(),
      em: new Date().toISOString(),
      arquivos: arquivosDe(await mudou("--name-status"), await mudou("--numstat")),
    };
  });
}
