// Coletores de testes e fitness functions (F3 §6): rodam os comandos do projeto na worktree e registram a evidência.
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Agregado, ArquivoEvidencia, Ator } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { exigirRegistroDeEvidencia, registrarEvidencia } from "../dominio/evidencia.ts";
import type { Id } from "../dominio/primitivos.ts";
import { guardarArquivos } from "../persistencia/arquivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { projeto } from "../persistencia/projetos.ts";
import { ambienteSemCredenciais, executarNoShell, LIMITE_COMANDO_MS } from "../processo.ts";
import { caminhoDaWorktree } from "../repositorio/worktree.ts";
import { LIMITE, MIME_TEXTO, schemaDe } from "./schemas.ts";

const FABRIQUINHA: Ator = { tipo: "fabriquinha" };

type Coletado = "execucao_testes" | "matriz_fitness";

/** Guarda os logs por conteúdo (F2 §5.1), cada um passando por um arquivo em `pasta`: `guardarArquivos` lê de um fd. */
function guardarLogs(
  banco: DatabaseSync,
  pasta: string,
  logs: readonly { nome: string; texto: string }[],
): ArquivoEvidencia[] {
  const abertos: { fd: number; nome: string }[] = [];
  try {
    for (const { nome, texto } of logs) {
      writeFileSync(join(pasta, nome), texto, { mode: 0o600 });
      abertos.push({ fd: openSync(join(pasta, nome), "r"), nome });
    }
    return guardarArquivos(banco, abertos, (_copia, _bytes, { nome }) => ({ nome, mime: MIME_TEXTO }), LIMITE.texto);
  } finally {
    for (const { fd } of abertos) closeSync(fd);
  }
}

/**
 * Roda os comandos, todos, mesmo depois de uma falha, fora de transação (F2 §3.2), e registra `tipo` em `ticket`
 * via C17, aprovada quando cada código de saída é 0. Comando não encontrado sai com 127 e reprova como qualquer outro.
 * As pré-condições de C17 e a worktree são conferidas antes, para não gastar até 30 minutos por comando à toa.
 * Os comandos rodam código do agente, então rodam sem credenciais (F5 §5.0).
 */
async function coletar(banco: DatabaseSync, ticket: Id, tipo: Coletado, limiteMs: number): Promise<Agregado> {
  const antes = agregadoDoTicket(banco, ticket);
  // A FK de issue.projeto garante o projeto de um ticket que existe.
  const proj = antes && projeto(banco, antes.issue.projeto);
  if (!antes || !proj) throw new ErroDeRegra(`o ticket T-${String(ticket)} não existe`, "confira o número do ticket");
  exigirRegistroDeEvidencia(antes, FABRIQUINHA, ticket, tipo);
  const worktree = caminhoDaWorktree(raizDo(banco), proj.nome, antes.issue.id);
  if (!statSync(worktree, { throwIfNoEntry: false })?.isDirectory()) {
    throw new ErroDeRegra(
      `a worktree da I-${String(antes.issue.id)} não existe em ${worktree}`,
      "execute o ticket de novo: a execução cria a worktree antes da coleta",
    );
  }
  const itens =
    tipo === "execucao_testes"
      ? proj.testes.map((comando, i) => ({ comando, log: `teste-${String(i + 1)}.log` }))
      : proj.fitness.map((f) => ({ ...f, log: `${f.nome}.log` }));

  const pasta = mkdtempSync(join(tmpdir(), "fabriquinha-coleta-"));
  try {
    const vazio = join(pasta, "vazio");
    mkdirSync(vazio);
    const env = ambienteSemCredenciais(process.env, vazio);
    const linhas = [];
    const logs = [];
    for (const item of itens) {
      const r = await executarNoShell(item.comando, worktree, { env, limiteMs, limiteLog: LIMITE.texto });
      linhas.push({ ...item, codigoSaida: r.codigo, estourou: r.estourou, duracaoMs: r.duracaoMs });
      logs.push({ nome: item.log, texto: r.log });
    }
    const dados = schemaDe(tipo).dados.parse(tipo === "execucao_testes" ? { comandos: linhas } : { linhas });
    const aprovada = linhas.every((l) => l.codigoSaida === 0);
    const arquivos = guardarLogs(banco, pasta, logs);

    return comIssue(banco, antes.issue.id, "registrarEvidencia", FABRIQUINHA, (ag, ctx) =>
      registrarEvidencia(ag, { ticket, tipo, aprovada, dados, arquivos }, FABRIQUINHA, ctx),
    );
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** F3 §6, coletor de testes: cada comando de `projeto.testes` vira uma linha de `execucao_testes`. */
export const coletarTestes = (banco: DatabaseSync, ticket: Id, limiteMs = LIMITE_COMANDO_MS): Promise<Agregado> =>
  coletar(banco, ticket, "execucao_testes", limiteMs);

/** F3 §6, coletor de fitness: cada `projeto.fitness[]` vira uma linha de `matriz_fitness`. */
export const coletarFitness = (banco: DatabaseSync, ticket: Id, limiteMs = LIMITE_COMANDO_MS): Promise<Agregado> =>
  coletar(banco, ticket, "matriz_fitness", limiteMs);
