// Verificações por comando de um ticket da demanda (testes por linguagem, E2E e fitness), sem banco: rodam na worktree,
// sem credenciais, e classificam cada falha como reprovação técnica ou falha de infraestrutura. Quem chama grava.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import type { Projeto } from "../dominio/configuracao_projeto.ts";
import { ambienteSemCredenciais, executarNoShell, LIMITE_COMANDO_MS, type Resultado } from "../processo.ts";
import { LIMITE } from "./schemas.ts";

export interface Falha {
  classe: "tecnica" | "infraestrutura";
  motivo: string;
  comando?: string;
}

export interface Verificacao {
  tipo: "execucao_testes" | "matriz_fitness" | "relatorio_sonar";
  /** `true` sem falhas; `false` se todas são técnicas; `undefined` se há infraestrutura. */
  aprovada: boolean | undefined;
  falhas: Falha[];
  dados: Record<string, unknown>;
  logs: { nome: string; texto: string }[];
}

export interface EntradaComandos {
  projeto: Projeto;
  e2e: boolean;
  worktree: string;
  /** Arquivos alterados da worktree, relativos à raiz; decidem se o E2E roda. */
  arquivos: readonly string[];
  limiteMs?: number;
}

export const aprovacao = (falhas: readonly Falha[]): boolean | undefined =>
  falhas.length === 0 ? true : falhas.some((f) => f.classe === "infraestrutura") ? undefined : false;

/** Estouro do tempo e saída 126/127 (comando que não roda) são infraestrutura; outra saída diferente de 0, técnica. */
function classificar(comando: string, r: Resultado, tecnica = (c: number | null) => c !== 0): Falha | undefined {
  if (r.estourou) return { classe: "infraestrutura", motivo: `${comando}: tempo limite`, comando };
  if (r.codigo === 126 || r.codigo === 127) {
    return { classe: "infraestrutura", motivo: `${comando}: ${r.log.trim()}`, comando };
  }
  if (tecnica(r.codigo)) {
    return { classe: "tecnica", motivo: `${comando} saiu com código ${String(r.codigo)}`, comando };
  }
  return undefined;
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
}: EntradaComandos): Promise<Verificacao> {
  return comAmbiente(limiteMs, async (rodar) => {
    const comandos = [];
    const logs = [];
    const falhas: Falha[] = [];
    for (const { caminho, comando_teste: comando } of projeto.linguagens) {
      const r = await rodar(comando, join(worktree, caminho));
      comandos.push({ ...linha(comando, r), caminho });
      logs.push({ nome: `teste-${caminho}.log`, texto: r.log });
      const falha = classificar(comando, r);
      if (falha) falhas.push(falha);
    }
    for (const config of e2e ? projeto.e2e : []) {
      const globs = projeto.globs.filter((g) => g.caminho_linguagem === config.caminho_linguagem);
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
      const falha = classificar(config.comando_execucao, exec, (c) => c === config.codigo_falha);
      if (falha) falhas.push(falha);
      else if (exec.codigo !== 0) {
        falhas.push({
          classe: "infraestrutura",
          motivo: `${config.comando_execucao} saiu com código inesperado ${String(exec.codigo)}`,
          comando: config.comando_execucao,
        });
      }
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
    for (const f of projeto.fitness) {
      const r = await rodar(f.comando, worktree);
      linhas.push({ ...f, ...linha(f.comando, r) });
      logs.push({ nome: `${f.nome}.log`, texto: r.log });
      const falha = classificar(f.comando, r);
      if (falha) falhas.push(falha);
    }
    return { tipo: "matriz_fitness", aprovada: aprovacao(falhas), falhas, dados: { linhas }, logs };
  });
}
