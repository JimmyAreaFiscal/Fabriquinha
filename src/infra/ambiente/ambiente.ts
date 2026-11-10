// O Ambiente (CONCEITOS.md §7): o lugar físico onde o Espaço de Trabalho roda. Todo processo do Espaço passa por aqui.
import type { Readable, Writable } from "node:stream";

/** F3 §6 e F5 §3.2: limite de cada comando configurado pelo Auditor. */
export const LIMITE_COMANDO_MS = 30 * 60_000;
/** Variáveis com credencial de hospedagem ou do SonarQube (F4 §6.1, F5 §5.0). */
const CREDENCIAIS = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "SYSTEM_ACCESSTOKEN",
  "SONAR_TOKEN",
]);

/**
 * `base` sem as credenciais, com `gh` e `az` lendo a configuração de `dirVazio`, onde não há login salvo. Para o que
 * roda código do agente: o pi e os coletores de testes e fitness.
 */
export function ambienteSemCredenciais(base: NodeJS.ProcessEnv, dirVazio: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(base))
    if (valor !== undefined && !CREDENCIAIS.has(nome)) env[nome] = valor;
  return { ...env, GH_CONFIG_DIR: dirVazio, AZURE_CONFIG_DIR: dirVazio };
}

export interface ComandoNoAmbiente {
  /** O programa; com `noShell`, a linha de comando inteira. */
  programa: string;
  argumentos: string[];
  /** Caminho no Ambiente (`caminhoNoAmbiente` converte o do host). */
  cwd: string;
  env: Record<string, string>;
  /** Passado o limite, o grupo de processos inteiro morre. */
  limiteMs?: number;
  /** Guarda só o fim da saída, pelo menos estes bytes: saída enorme não esgota a memória. */
  ultimosBytes?: number;
  /** Roda `programa` como linha de comando de shell (testes, fitness, preparação), com stderr e stdout juntos em `saida`. */
  noShell?: boolean;
}

export interface SaidaDoComando {
  /** `null` quando o comando morreu por sinal; no shell, também quando estourou o limite. */
  codigo: number | null;
  saida: string;
  /** Sempre vazio no shell: o stderr vai junto em `saida`. */
  erro: string;
  limiteEstourado: boolean;
  duracaoMs: number;
}

export interface IdentificadorDoProcesso {
  ambiente_id: string;
  grupo_processo: number;
}

/** Um processo interativo (o pi): fala por stdin e stdout até `saiu`. */
export interface ProcessoNoAmbiente {
  identificador: IdentificadorDoProcesso;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  /** O código de saída; `null` se morreu por sinal. */
  saiu: Promise<number | null>;
  /** Avisa de falha do processo ou do stdin (ex.: EPIPE), que sem ouvinte derrubaria o serviço. */
  aoFalhar(ouvinte: (erro: Error) => void): void;
}

export interface Ambiente {
  readonly id: string;
  readonly tipo: "host_local" | "container";
  /** Espera o comando terminar. Só lança se o programa nem chega a rodar (ex.: não está instalado). */
  executar(comando: ComandoNoAmbiente): Promise<SaidaDoComando>;
  /** Lança o processo num grupo próprio e devolve sem esperar. */
  lancar(comando: ComandoNoAmbiente): ProcessoNoAmbiente;
  /** Também serve à recuperação da subida, com o identificador gravado antes do reinício. */
  sinalizar(identificador: IdentificadorDoProcesso, sinal: NodeJS.Signals): Promise<void>;
  caminhoNoAmbiente(caminhoNoHost: string): string;
  /**
   * Põe a pasta do processo (`E-<id>`) e a pasta da sessão do pi onde o Ambiente as enxerga, antes de o processo
   * nascer. No host local elas já estão ao alcance; no container, só as pastas montadas nele ficam visíveis.
   */
  abrigarProcesso(pastaDaExecucao: string, sessao: string): void;
}
