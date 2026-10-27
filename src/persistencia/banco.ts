// Abertura do banco, transações de escrita e sequência de IDs (F2 §2, §3.1, §3.2, §3.4, §3.7).
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { TipoId } from "../dominio/primitivos.ts";
import { MIGRACOES } from "./migracoes.ts";

/** A raiz da Fabriquinha: `$FABRIQUINHA_ROOT`, padrão `~/fabriquinha` (F2 §2). */
export const raizPadrao = (env: NodeJS.ProcessEnv = process.env): string =>
  env.FABRIQUINHA_ROOT || join(homedir(), "fabriquinha");

/** Cria a raiz, abre o banco, aplica os PRAGMAs e as migrações pendentes. */
export function abrir(raiz = raizPadrao()): DatabaseSync {
  // Evidências podem conter telas e dados sensíveis: diretório 0700, arquivos 0600.
  mkdirSync(raiz, { recursive: true, mode: 0o700 });
  chmodSync(raiz, 0o700);
  const arquivo = join(raiz, "fabriquinha.db");
  // O SQLite cria -wal e -shm com a permissão do banco; criá-lo antes garante 0600 nos três.
  writeFileSync(arquivo, "", { flag: "a", mode: 0o600 });
  chmodSync(arquivo, 0o600);

  const banco = new DatabaseSync(arquivo);
  try {
    // busy_timeout vem antes do WAL: trocar o journal pega lock, e dois processos podem abrir juntos.
    banco.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
    `);
    migrar(banco, MIGRACOES);
  } catch (error_) {
    banco.close();
    throw error_;
  }
  return banco;
}

/** A raiz do banco aberto: os arquivos de evidência, as worktrees e as execuções moram nela (F2 §2). */
export const raizDo = (banco: DatabaseSync): string =>
  dirname((banco.prepare("PRAGMA database_list").get() as { file: string }).file);

/** Aplica em ordem as migrações ainda não aplicadas, cada uma na sua transação; a versão fica em `user_version`. */
export function migrar(banco: DatabaseSync, migracoes: readonly string[]): void {
  const inicial = versao(banco);
  if (inicial > migracoes.length) {
    throw new ErroDeRegra(
      `o banco está na versão ${String(inicial)}, mais nova que a ${String(migracoes.length)} que esta Fabriquinha conhece`,
      "atualize a Fabriquinha antes de abrir este banco",
    );
  }
  if (inicial === migracoes.length) return; // em dia: nem pega o lock
  // As FKs ficam desligadas fora da transação (o PRAGMA não vale dentro dela), porque recriar uma tabela com DROP/RENAME
  // falha com FK ligada. Em troca, `foreign_key_check` confere antes do COMMIT.
  // A versão é relida dentro do lock: dois processos abrindo juntos não aplicam a mesma migração duas vezes.
  banco.exec("PRAGMA foreign_keys = OFF");
  try {
    let pendente = true;
    while (pendente) {
      pendente = escrever(banco, () => {
        const atual = versao(banco);
        const sql = migracoes[atual];
        if (sql === undefined) return false;
        banco.exec(sql);
        banco.exec(`PRAGMA user_version = ${String(atual + 1)}`);
        const orfas = banco.prepare("PRAGMA foreign_key_check").all();
        if (orfas.length > 0) {
          throw new ErroDeRegra(
            `a migração ${String(atual + 1)} deixou ${String(orfas.length)} referência(s) órfã(s) no banco`,
            "restaure o banco do backup e relate o problema",
          );
        }
        return true;
      });
    }
  } finally {
    banco.exec("PRAGMA foreign_keys = ON");
  }
}

const versao = (banco: DatabaseSync): number =>
  (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

const emTransacao = (banco: DatabaseSync): boolean => banco.isTransaction; // fora do narrowing do TS
let profundidade = 0; // escritas aninhadas em andamento; dá o nome único do SAVEPOINT

/**
 * Roda `trabalho` numa transação de escrita. `BEGIN IMMEDIATE` pega o lock no início, então duas escritas
 * nunca entram em deadlock ao promover o lock. Erro faz ROLLBACK e propaga o erro original.
 * Reentrante: dentro de uma transação aberta usa SAVEPOINT, e o erro desfaz só a parte interna.
 * Nada aqui dentro pode esperar I/O externo (pi, git, testes): isso roda antes, fora da transação.
 */
export function escrever<T>(banco: DatabaseSync, trabalho: () => T): T {
  if (banco.isTransaction) {
    const ponto = `sp_${String(++profundidade)}`;
    banco.exec(`SAVEPOINT ${ponto}`);
    try {
      const resultado = trabalho();
      banco.exec(`RELEASE ${ponto}`);
      return resultado;
    } catch (error_) {
      banco.exec(`ROLLBACK TO ${ponto}; RELEASE ${ponto}`);
      throw error_;
    } finally {
      profundidade--;
    }
  }
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = trabalho();
    banco.exec("COMMIT");
    return resultado;
  } catch (error_) {
    if (emTransacao(banco)) banco.exec("ROLLBACK"); // o COMMIT pode ter falhado com a transação ainda aberta
    throw error_;
  }
}

/** Próximo ID do tipo. Só dentro de `escrever`: as escritas serializadas por `BEGIN IMMEDIATE` evitam corrida. */
export function novoId(banco: DatabaseSync, tipo: TipoId): number {
  if (!banco.isTransaction) throw new Error(`novoId(${tipo}) chamado fora de transação; use dentro de escrever()`);
  const linha = banco
    .prepare(
      "INSERT INTO sequencia (nome, valor) VALUES (?, 1) ON CONFLICT (nome) DO UPDATE SET valor = valor + 1 RETURNING valor",
    )
    .get(tipo) as { valor: number };
  return linha.valor;
}
