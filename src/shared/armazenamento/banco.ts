// Abertura do banco, unidade de trabalho, executor de migrações, sequência de IDs (F2 §2, §3.1, §3.2, §3.4, §3.7) e as
// instruções preparadas uma vez por conexão.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { ESQUEMA_V36, type Migracao, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes/migracoes.ts";

/** A raiz da Fabriquinha: `$FABRIQUINHA_ROOT`, padrão `~/fabriquinha` (F2 §2). */
export const raizPadrao = (env: NodeJS.ProcessEnv = process.env): string =>
  env.FABRIQUINHA_ROOT || join(homedir(), "fabriquinha");

/** As migrações de um domínio, cada uma com a versão do banco que ela entrega, para sempre (MELHORIAS §5.1.6). */
interface MigracoesDoDominio {
  dominio: string;
  migracoes: readonly { versao: number; migracao: Migracao }[];
}

/**
 * O histórico congelado (`MIGRACOES`) seguido das migrações dos domínios na ordem das versões. A versão é declarada, e
 * não a posição numa lista: a migração de um domínio não muda de número quando outro domínio registra a sua. Recusa
 * buraco, versão repetida e a que cai no histórico, porque o banco aplicaria uma migração no lugar de outra.
 */
function enfileirarDepoisDoHistorico(migracoesDosDominios: readonly MigracoesDoDominio[]): Migracao[] {
  const registradas = migracoesDosDominios
    .flatMap(({ dominio, migracoes }) => migracoes.map((registrada) => ({ dominio, ...registrada })))
    .sort((primeira, segunda) => primeira.versao - segunda.versao);
  registradas.forEach(({ dominio, versao }, posicao) => {
    const proxima = VERSAO_LINHA_DE_BASE + MIGRACOES.length + posicao + 1;
    if (versao !== proxima) {
      throw new ErroDeRegra(
        `a migração ${String(versao)} do domínio ${dominio} está fora da sequência: a próxima é a ${String(proxima)}`,
        "numere a migração nova com a versão seguinte à última registrada pelo histórico ou por qualquer domínio",
      );
    }
  });
  return [...MIGRACOES, ...registradas.map(({ migracao }) => migracao)];
}

/** Cria a raiz, abre o banco, aplica os PRAGMAs e as migrações pendentes: as do histórico e as dos domínios. */
export function abrir(raiz = raizPadrao(), migracoesDosDominios: readonly MigracoesDoDominio[] = []): DatabaseSync {
  const migracoes = enfileirarDepoisDoHistorico(migracoesDosDominios);
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
    migrar(banco, migracoes);
  } catch (error_) {
    banco.close();
    throw error_;
  }
  return banco;
}

/** A raiz do banco aberto: os arquivos de evidência, as worktrees e as execuções moram nela (F2 §2). */
export const raizDo = (banco: DatabaseSync): string =>
  dirname((banco.prepare("PRAGMA database_list").get() as { file: string }).file);

/**
 * Leva o banco à versão atual: banco vazio (versão 0) recebe a linha de base `ESQUEMA_V36`, banco de versão 1 a 35 é
 * rejeitado, e as `migracoes` (a primeira é a 37) ainda não aplicadas rodam em ordem, cada uma na sua transação.
 * A versão fica em `user_version`.
 */
/** @testes os testes aplicam migrações próprias para provar o mecanismo */
export function migrar(banco: DatabaseSync, migracoes: readonly Migracao[]): void {
  const inicial = versao(banco);
  const versaoAtual = VERSAO_LINHA_DE_BASE + migracoes.length;
  if (inicial > versaoAtual) {
    throw new ErroDeRegra(
      `o banco está na versão ${String(inicial)}, mais nova que a ${String(versaoAtual)} que esta Fabriquinha conhece`,
      "atualize a Fabriquinha antes de abrir este banco",
    );
  }
  if (inicial > 0 && inicial < VERSAO_LINHA_DE_BASE) {
    throw new ErroDeRegra(
      `o banco está na versão ${String(inicial)}, anterior à ${String(VERSAO_LINHA_DE_BASE)} que esta Fabriquinha exige`,
      `suba a Fabriquinha da versão anterior à linha de base (I-263) para o banco chegar à v${String(VERSAO_LINHA_DE_BASE)}, e depois esta`,
    );
  }
  if (inicial === versaoAtual) return; // em dia: nem pega o lock
  // As FKs ficam desligadas fora da transação (o PRAGMA não vale dentro dela), porque recriar uma tabela com DROP/RENAME
  // falha com FK ligada. Em troca, `foreign_key_check` confere antes do COMMIT.
  // A versão é relida dentro do lock: dois processos abrindo juntos não aplicam a mesma migração duas vezes.
  banco.exec("PRAGMA foreign_keys = OFF");
  try {
    let pendente = true;
    while (pendente) {
      pendente = escrever(banco, () => {
        const atual = versao(banco);
        if (atual === 0) {
          banco.exec(ESQUEMA_V36);
          concluirMigracao(banco, VERSAO_LINHA_DE_BASE);
          return true;
        }
        const migracao = migracoes[atual - VERSAO_LINHA_DE_BASE];
        if (migracao === undefined) return false;
        if (typeof migracao === "string") banco.exec(migracao);
        else migracao(banco);
        concluirMigracao(banco, atual + 1);
        return true;
      });
    }
  } finally {
    banco.exec("PRAGMA foreign_keys = ON");
  }
}

/** Grava a versão e recusa (desfazendo a transação) a migração que deixou referência órfã. */
function concluirMigracao(banco: DatabaseSync, versaoNova: number): void {
  banco.exec(`PRAGMA user_version = ${String(versaoNova)}`);
  const orfas = banco.prepare("PRAGMA foreign_key_check").all();
  if (orfas.length > 0) {
    throw new ErroDeRegra(
      `a migração ${String(versaoNova)} deixou ${String(orfas.length)} referência(s) órfã(s) no banco`,
      "restaure o banco do backup e relate o problema",
    );
  }
}

const versao = (banco: DatabaseSync): number =>
  (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

const emTransacao = (banco: DatabaseSync): boolean => banco.isTransaction; // fora do narrowing do TS
const profundidadePorConexao = new WeakMap<DatabaseSync, number>(); // escritas aninhadas em andamento; dá o nome do SAVEPOINT

/**
 * A unidade de trabalho (MELHORIAS §5.2): roda `trabalho` numa transação de escrita. `BEGIN IMMEDIATE` pega o lock no início, então duas escritas
 * nunca entram em deadlock ao promover o lock. Erro faz ROLLBACK e propaga o erro original.
 * Reentrante: dentro de uma transação aberta usa SAVEPOINT, e o erro desfaz só a parte interna. Assim um coordenador
 * envolve chamadas a vários domínios numa transação só: a unidade de trabalho de cada domínio vira parte da dele.
 * Nada aqui dentro pode esperar I/O externo (pi, git, testes): isso roda antes, fora da transação.
 */
export function escrever<T>(banco: DatabaseSync, trabalho: () => T): T {
  if (banco.isTransaction) {
    const profundidade = (profundidadePorConexao.get(banco) ?? 0) + 1;
    const ponto = `sp_${String(profundidade)}`;
    banco.exec(`SAVEPOINT ${ponto}`);
    profundidadePorConexao.set(banco, profundidade);
    try {
      const resultado = trabalho();
      banco.exec(`RELEASE ${ponto}`);
      return resultado;
    } catch (error_) {
      banco.exec(`ROLLBACK TO ${ponto}; RELEASE ${ponto}`);
      throw error_;
    } finally {
      profundidadePorConexao.set(banco, profundidade - 1);
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

/** Próximo ID da sequência. Só dentro de `escrever`: as escritas serializadas por `BEGIN IMMEDIATE` evitam corrida. */
export function novoId(banco: DatabaseSync, nomeDaSequencia: string): number {
  if (!banco.isTransaction)
    throw new Error(`novoId(${nomeDaSequencia}) chamado fora de transação; use dentro de escrever()`);
  const linha = banco
    .prepare(
      "INSERT INTO sequencia (nome, valor) VALUES (?, 1) ON CONFLICT (nome) DO UPDATE SET valor = valor + 1 RETURNING valor",
    )
    .get(nomeDaSequencia) as { valor: number };
  return linha.valor;
}

const instrucoesPorConexao = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/**
 * A instrução do `sql` nesta conexão, preparada uma vez só: a leitura em lote que se repete (a tela de Métricas lê o
 * mesmo SQL de cada mês e de cada demanda) não paga a compilação a cada chamada.
 */
export function instrucaoPreparada(banco: DatabaseSync, sql: string): StatementSync {
  const daConexao = instrucoesPorConexao.get(banco) ?? new Map<string, StatementSync>();
  instrucoesPorConexao.set(banco, daConexao);
  const instrucao = daConexao.get(sql) ?? banco.prepare(sql);
  daConexao.set(sql, instrucao);
  return instrucao;
}
