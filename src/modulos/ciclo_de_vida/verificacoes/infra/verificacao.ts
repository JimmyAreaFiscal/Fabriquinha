// A Verificação: uma checagem determinística da worktree, sem banco, com o resultado de três classes. `coletar` guarda
// o registro completo (falhas, dados e logs) que o fechamento do ticket ainda grava como Evidência; `executar` o reduz.
import { LIMITE_COMANDO_MS } from "../../../../shared/nucleo/primitivos.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import {
  CATALOGO_DE_ETAPAS,
  type CausaDeInfraestrutura,
  type EtapaTicket,
  type TipoVerificacao,
} from "../../etapas/publico.ts";
import { classificarSaidaDeComando, type ResultadoDaVerificacao } from "../nucleo/verificacao.ts";
import { ambienteSemCredenciais } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { type Ambiente } from "../../../ambiente/publico.ts";

/** A reprovação técnica volta ao agente; a de infraestrutura leva a causa que a política da Tentativa lê. */
export type Falha =
  | { classe: "tecnica"; motivo: string; comando?: string }
  | { classe: "infraestrutura"; causa: CausaDeInfraestrutura; motivo: string; comando?: string };

type FalhaDeInfraestrutura = Extract<Falha, { classe: "infraestrutura" }>;

export interface RegistroDaVerificacao {
  tipo: "execucao_testes" | "matriz_fitness" | "relatorio_sonar";
  /** `true` sem falhas; `false` se todas são técnicas; `undefined` se há infraestrutura. */
  passou: boolean | undefined;
  falhas: Falha[];
  dados: Record<string, unknown>;
  logs: { nome: string; texto: string }[];
}

/**
 * Quantos bytes do fim da saída de cada comando o log guarda: o tamanho de um anexo de texto da Evidência (F3 §3.1), que
 * o registro vira. A Verificação fica abaixo do motor e não lê o limite dele; o teste confere que os dois concordam.
 * @testes o teste o compara com o limite do anexo de texto da Evidência
 */
export const ULTIMOS_BYTES_DO_LOG = 5 * 1024 * 1024;

export interface ContextoDaVerificacao {
  /** O Ambiente do Espaço: os comandos configurados rodam nele. */
  ambiente: Ambiente;
  worktree: string;
  /** Tempo máximo de cada comando; o Sonar tem o seu em `OpcoesSonar`. */
  limiteMs?: number;
}

interface Resultado {
  /** `null` quando o comando morreu por sinal ou estourou o limite. */
  codigo: number | null;
  estourou: boolean;
  duracaoMs: number;
  /** Stdout e stderr intercalados, com no máximo `ULTIMOS_BYTES_DO_LOG` bytes (os do fim). */
  log: string;
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
function resultadoDoRegistro({ passou, falhas, dados, logs }: RegistroDaVerificacao): ResultadoDaVerificacao {
  if (passou) return { tipo: "passou", relatorio: { dados, logs } };
  if (passou === false) {
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

  abstract executar(contexto: ContextoDaVerificacao): Promise<ResultadoDaVerificacao>;
}

/** A Verificação que deixa registro completo (testes, fitness, sonar, e2e): `coletar` o guarda e `executar` o reduz. */
export abstract class VerificacaoComRegistro extends Verificacao {
  abstract coletar(contexto: ContextoDaVerificacao): Promise<RegistroDaVerificacao>;

  async executar(contexto: ContextoDaVerificacao): Promise<ResultadoDaVerificacao> {
    return resultadoDoRegistro(await this.coletar(contexto));
  }
}

type VerificacoesMontadas<F> = { [T in keyof F]: F[T] extends () => infer V ? V : never };

type FabricasDeVerificacao = Partial<Record<TipoVerificacao, () => Verificacao>>;

/**
 * Monta, na ordem do catálogo, as Verificações que quem chama sabe construir (`fabricas`), por tipo. Recusa a fábrica
 * de uma Verificação que `CATALOGO_DE_ETAPAS[etapa].verificacoes` não lista; a que a Etapa lista e não vem em
 * `fabricas` fica de fora, para quem chama montar só a parte que usa (os hooks, por exemplo, são do fechamento).
 */
export function montarVerificacoesDaEtapa<F extends FabricasDeVerificacao>(
  etapa: EtapaTicket,
  fabricas: F,
): VerificacoesMontadas<F> {
  const exigidas: readonly string[] = CATALOGO_DE_ETAPAS[etapa].verificacoes;
  const naoExigida = Object.keys(fabricas).find((tipo) => !exigidas.includes(tipo));
  if (naoExigida) throw new ErroDeRegra(`a etapa ${etapa} não exige a verificação ${naoExigida}`);
  const fabricasPorTipo: FabricasDeVerificacao = fabricas;
  const montadas = exigidas.flatMap((tipo) => {
    const fabrica = fabricasPorTipo[tipo as TipoVerificacao];
    return fabrica ? [[tipo, fabrica()]] : [];
  });
  // O cast vale porque cada chave de `montadas` vem de `fabricas`.
  return Object.fromEntries(montadas) as VerificacoesMontadas<F>;
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
  ambiente: Ambiente,
  limiteMs: number = LIMITE_COMANDO_MS,
  corpo: (rodar: ComandoRodar) => Promise<T>,
) {
  const vazio = mkdtempSync(join(tmpdir(), "fabriquinha-verificacao-"));
  try {
    const env = ambienteSemCredenciais(process.env, vazio);
    return await corpo(async (comando, cwd) => {
      const r = await ambiente.executar({
        programa: comando,
        argumentos: [],
        cwd: ambiente.caminhoNoAmbiente(cwd),
        env,
        limiteMs,
        ultimosBytes: ULTIMOS_BYTES_DO_LOG,
        noShell: true,
      });
      return { codigo: r.codigo, estourou: r.limiteEstourado, duracaoMs: r.duracaoMs, log: r.saida };
    });
  } finally {
    rmSync(vazio, { recursive: true, force: true });
  }
}

/** A linha do comando em `dados`; `log` é o nome do anexo com a saída dele (`ComandoRodado`). */
export const linhaDoComando = (comando: string, r: Resultado, log: string) => ({
  comando,
  codigoSaida: r.codigo,
  estourou: r.estourou,
  duracaoMs: r.duracaoMs,
  log,
});
