// Verificações por comando de um ticket da demanda (testes por linguagem, E2E e fitness), sem banco: rodam na worktree,
// sem credenciais, e classificam cada falha como reprovação técnica ou falha de infraestrutura. Quem chama grava.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import type { Projeto } from "../../nucleo/projeto.ts";
import { ambienteSemCredenciais, executarNoShell, LIMITE_COMANDO_MS, type Resultado } from "../../infra/processo.ts";
import { LIMITE } from "../../nucleo/schemas.ts";
import { classificarSaidaDeComando } from "../../nucleo/verificacao.ts";
import type { CausaDeInfraestrutura } from "../../nucleo/tentativa.ts";

/** A reprovação técnica volta ao agente; a de infraestrutura leva a causa que a política da Tentativa lê. */
export type Falha =
  | { classe: "tecnica"; motivo: string; comando?: string }
  | { classe: "infraestrutura"; causa: CausaDeInfraestrutura; motivo: string; comando?: string };

export interface Verificacao {
  tipo: "execucao_testes" | "matriz_fitness" | "relatorio_sonar";
  /** `true` sem falhas; `false` se todas são técnicas; `undefined` se há infraestrutura. */
  aprovada: boolean | undefined;
  falhas: Falha[];
  dados: Record<string, unknown>;
  logs: { nome: string; texto: string }[];
}

/** @testes tipo que o teste usa para montar a entrada */
export interface EntradaComandos {
  projeto: Projeto;
  e2e: boolean;
  worktree: string;
  /** Arquivos alterados da worktree, relativos à raiz; decidem se o E2E roda. */
  arquivos: readonly string[];
  limiteMs?: number;
  /** Chamada depois dos testes das linguagens e antes do E2E: o lcov que o Sonar lê já está gravado. */
  aoTerminarAsLinguagens?: () => void;
}

export const aprovacao = (falhas: readonly Falha[]): boolean | undefined =>
  falhas.length === 0 ? true : falhas.some((f) => f.classe === "infraestrutura") ? undefined : false;

/** Traduz a classificação única para a Falha do ticket; o motivo e a causa de infraestrutura dependem de como o comando falhou. */
function classificar(comando: string, r: Resultado, codigoDeReprovacao?: number): Falha | undefined {
  const tipo = classificarSaidaDeComando(r, codigoDeReprovacao);
  if (tipo === "passou") return undefined;
  if (tipo === "reprovacao") {
    return { classe: "tecnica", motivo: `${comando} saiu com código ${String(r.codigo)}`, comando };
  }
  if (r.estourou) {
    return { classe: "infraestrutura", causa: "tempo_limite", motivo: `${comando}: tempo limite`, comando };
  }
  const motivo =
    r.codigo === 126 || r.codigo === 127
      ? `${comando}: ${r.log.trim()}`
      : `${comando} saiu com código inesperado ${String(r.codigo)}`;
  return { classe: "infraestrutura", causa: "comando_ausente", motivo, comando };
}

/** Roda os comandos de `corpo` com o ambiente sem credenciais (F5 §5.0). */
async function comAmbiente<T>(
  limiteMs: number,
  corpo: (rodar: (comando: string, cwd: string) => Promise<Resultado>) => Promise<T>,
) {
  const vazio = mkdtempSync(join(tmpdir(), "fabriquinha-verificacao-"));
  try {
    const env = ambienteSemCredenciais(process.env, vazio);
    return await corpo((comando, cwd) => executarNoShell(comando, cwd, { env, limiteMs, limiteLog: LIMITE.texto }));
  } finally {
    rmSync(vazio, { recursive: true, force: true });
  }
}

const linha = (comando: string, r: Resultado) => ({
  comando,
  codigoSaida: r.codigo,
  estourou: r.estourou,
  duracaoMs: r.duracaoMs,
});

/** Testes de cada linguagem em `join(worktree, caminho)` e, se a rodada pede e algum arquivo casa, o E2E dela. */
export function verificarTestes({
  projeto,
  e2e,
  worktree,
  arquivos,
  limiteMs = LIMITE_COMANDO_MS,
  aoTerminarAsLinguagens,
}: EntradaComandos): Promise<Verificacao> {
  return comAmbiente(limiteMs, async (rodar) => {
    const comandos = [];
    const logs = [];
    const falhas: Falha[] = [];
    for (const { caminho, comando_teste: comando } of projeto.verificacoes.linguagens) {
      const r = await rodar(comando, join(worktree, caminho));
      comandos.push({ ...linha(comando, r), caminho });
      logs.push({ nome: `teste-${caminho}.log`, texto: r.log });
      const falha = classificar(comando, r);
      if (falha) falhas.push(falha);
    }
    aoTerminarAsLinguagens?.();
    for (const config of e2e ? projeto.verificacoes.e2e : []) {
      const globs = projeto.verificacoes.globs.filter((g) => g.caminho_linguagem === config.caminho_linguagem);
      if (!arquivos.some((a) => globs.some((g) => matchesGlob(a, g.glob)))) continue;
      const cwd = join(worktree, config.caminho_linguagem);
      const nome = `e2e-${config.caminho_linguagem}`;
      const build = await rodar(config.comando_build, cwd);
      comandos.push({ ...linha(config.comando_build, build), caminho: config.caminho_linguagem });
      logs.push({ nome: `${nome}-build.log`, texto: build.log });
      const falhaBuild = classificar(config.comando_build, build);
      if (falhaBuild) {
        falhas.push(falhaBuild);
        continue;
      }
      const exec = await rodar(config.comando_execucao, cwd);
      comandos.push({ ...linha(config.comando_execucao, exec), caminho: config.caminho_linguagem });
      logs.push({ nome: `${nome}.log`, texto: exec.log });
      // Só o codigo_falha reprova; outra saída diferente de 0 é infraestrutura.
      const falha = classificar(config.comando_execucao, exec, config.codigo_falha);
      if (falha) falhas.push(falha);
    }
    return { tipo: "execucao_testes", aprovada: aprovacao(falhas), falhas, dados: { comandos }, logs };
  });
}

/** Um comando por fitness function, com cwd na worktree. */
export function verificarFitness({
  projeto,
  worktree,
  limiteMs = LIMITE_COMANDO_MS,
}: EntradaComandos): Promise<Verificacao> {
  return comAmbiente(limiteMs, async (rodar) => {
    const linhas = [];
    const logs = [];
    const falhas: Falha[] = [];
    for (const f of projeto.verificacoes.fitness) {
      const r = await rodar(f.comando, worktree);
      linhas.push({ ...f, ...linha(f.comando, r) });
      logs.push({ nome: `${f.nome}.log`, texto: r.log });
      const falha = classificar(f.comando, r);
      if (falha) falhas.push(falha);
    }
    return { tipo: "matriz_fitness", aprovada: aprovacao(falhas), falhas, dados: { linhas }, logs };
  });
}
