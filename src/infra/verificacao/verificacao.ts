// A Verificação: uma checagem determinística da worktree, sem banco, com o resultado de três classes. `coletar` guarda
// o registro completo (falhas, dados e logs) que o fechamento do ticket ainda grava como Evidência; `executar` o reduz.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import type { EtapaTicket } from "../../nucleo/primitivos.ts";
import { LIMITE } from "../../nucleo/schemas.ts";
import type { CausaDeInfraestrutura } from "../../nucleo/tentativa.ts";
import {
  classificarSaidaDeComando,
  type ResultadoDaVerificacao,
  type TipoVerificacao,
} from "../../nucleo/verificacao.ts";
import { ambienteSemCredenciais, executarNoShell, LIMITE_COMANDO_MS, type Resultado } from "../processo.ts";

/** A reprovação técnica volta ao agente; a de infraestrutura leva a causa que a política da Tentativa lê. */
export type Falha =
  | { classe: "tecnica"; motivo: string; comando?: string }
  | { classe: "infraestrutura"; causa: CausaDeInfraestrutura; motivo: string; comando?: string };

type FalhaDeInfraestrutura = Extract<Falha, { classe: "infraestrutura" }>;

export interface RegistroDaVerificacao {
  tipo: "execucao_testes" | "matriz_fitness" | "relatorio_sonar";
  /** `true` sem falhas; `false` se todas são técnicas; `undefined` se há infraestrutura. */
  aprovada: boolean | undefined;
  falhas: Falha[];
  dados: Record<string, unknown>;
  logs: { nome: string; texto: string }[];
}

export interface ContextoDaVerificacao {
  worktree: string;
  /** Tempo máximo de cada comando; o Sonar tem o seu em `OpcoesSonar`. */
  limiteMs?: number;
}

export type ComandoRodar = (comando: string, cwd: string) => Promise<Resultado>;

/** Os comandos de uma verificação já rodados; `coletar` os fecha no registro, e o teste compõe o E2E nos seus. */
export interface ComandosRodados {
  comandos: Record<string, unknown>[];
  logs: { nome: string; texto: string }[];
  falhas: Falha[];
}

export const aprovacao = (falhas: readonly Falha[]): boolean | undefined =>
  falhas.length === 0 ? true : falhas.some((f) => f.classe === "infraestrutura") ? undefined : false;

/** Qualquer infraestrutura vence a reprovação, como na aprovação: a causa é a da primeira e o motivo junta todas. */
function resultadoDoRegistro({ aprovada, falhas, dados, logs }: RegistroDaVerificacao): ResultadoDaVerificacao {
  if (aprovada) return { tipo: "passou", relatorio: { dados, logs } };
  if (aprovada === false) {
    return {
      tipo: "reprovacao",
      motivo: falhas.map((f) => f.motivo).join("; "),
      log: logs.map((l) => l.texto).join("\n"),
    };
  }
  const infraestrutura = falhas.filter((f) => f.classe === "infraestrutura") as [FalhaDeInfraestrutura];
  return {
    tipo: "falha_infraestrutura",
    causa: infraestrutura[0].causa,
    motivo: infraestrutura.map((f) => f.motivo).join("; "),
  };
}

export abstract class Verificacao {
  abstract readonly tipo: TipoVerificacao;

  abstract coletar(contexto: ContextoDaVerificacao): Promise<RegistroDaVerificacao>;

  async executar(contexto: ContextoDaVerificacao): Promise<ResultadoDaVerificacao> {
    return resultadoDoRegistro(await this.coletar(contexto));
  }
}

// Até a demanda 15 as Verificações que cada Etapa exige são esta tabela fechada. O E2E não é item: entra em `testes`.
const VERIFICACOES_DA_ETAPA: Record<EtapaTicket, readonly TipoVerificacao[]> = {
  entender_e_desenhar: [],
  planejar: [],
  implementar: ["testes", "fitness", "sonar", "hooks_do_commit"],
  revisar_rodada: ["fitness"],
  encerrar_rodada: ["conferencia_do_pr"],
  ajustar_resultado: [],
  revisar_demanda: [],
  encerrar_demanda: ["conferencia_do_pr"],
  resolver_conflito: ["testes", "fitness", "sonar", "hooks_do_commit"],
};

export const verificacoesDaEtapa = (etapa: EtapaTicket): readonly TipoVerificacao[] => VERIFICACOES_DA_ETAPA[etapa];

/** Devolve a Verificação que quem chama montou, depois de conferir que a tabela da Etapa a exige. */
export function exigidaPelaEtapa<V extends Verificacao>(etapa: EtapaTicket, verificacao: V): V {
  if (!verificacoesDaEtapa(etapa).includes(verificacao.tipo)) {
    throw new ErroDeRegra(`a etapa ${etapa} não exige a verificação ${verificacao.tipo}`);
  }
  return verificacao;
}

/** Traduz a classificação única para a Falha do ticket; o motivo e a causa de infraestrutura dependem de como o comando falhou. */
export function classificarComando(comando: string, r: Resultado, codigoDeReprovacao?: number): Falha | undefined {
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
export async function comAmbienteSemCredenciais<T>(
  limiteMs: number = LIMITE_COMANDO_MS,
  corpo: (rodar: ComandoRodar) => Promise<T>,
) {
  const vazio = mkdtempSync(join(tmpdir(), "fabriquinha-verificacao-"));
  try {
    const env = ambienteSemCredenciais(process.env, vazio);
    return await corpo((comando, cwd) => executarNoShell(comando, cwd, { env, limiteMs, limiteLog: LIMITE.texto }));
  } finally {
    rmSync(vazio, { recursive: true, force: true });
  }
}

export const linhaDoComando = (comando: string, r: Resultado) => ({
  comando,
  codigoSaida: r.codigo,
  estourou: r.estourou,
  duracaoMs: r.duracaoMs,
});
