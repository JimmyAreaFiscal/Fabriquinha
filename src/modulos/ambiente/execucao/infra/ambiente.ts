// O Ambiente (CONCEITOS.md §7): o lugar físico onde o Espaço de Trabalho roda. Todo processo do Espaço passa por aqui.
import type { Readable, Writable } from "node:stream";

// O limite de cada comando do Espaço mora com o processo do serviço, que também o aplica ao git do core.
export { LIMITE_COMANDO_MS } from "../../../../shared/infra/processo.ts";
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

export const ehCredencialDeHospedagemOuSonar = (nome: string): boolean => CREDENCIAIS.has(nome);

/**
 * `base` sem as credenciais, com `gh` e `az` lendo a configuração de `dirVazio`, onde não há login salvo. Para o que
 * roda código do agente: o pi e os coletores de testes e fitness.
 */
export function ambienteSemCredenciais(base: NodeJS.ProcessEnv, dirVazio: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(base))
    if (valor !== undefined && !ehCredencialDeHospedagemOuSonar(nome)) env[nome] = valor;
  return { ...env, GH_CONFIG_DIR: dirVazio, AZURE_CONFIG_DIR: dirVazio };
}

const SUFIXO_DE_CHAVE_DE_PROVEDOR_DO_LLM = "_API_KEY";
// O pi aceita `AZURE_OPENAI_API_KEY`, mas o Ambiente que isola as variáveis do serviço nunca recebe variável de
// hospedagem ou do SonarQube.
export const CREDENCIAL_QUE_NUNCA_ENTRA_NO_AMBIENTE_ISOLADO = /^(GH_|AZURE_|SONAR_)/;

/** As chaves de provedor do LLM de `env`, sem credencial de hospedagem nem do SonarQube: o que o agente leva ao Ambiente isolado. */
export function chavesDeProvedorDoLlm(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entrada): entrada is [string, string] =>
        entrada[1] !== undefined &&
        entrada[0].endsWith(SUFIXO_DE_CHAVE_DE_PROVEDOR_DO_LLM) &&
        !CREDENCIAL_QUE_NUNCA_ENTRA_NO_AMBIENTE_ISOLADO.test(entrada[0]),
    ),
  );
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

/**
 * O Ambiente responde o que quem roda nele precisa saber pelo significado, nunca pelo tipo: um adapter novo é só uma
 * classe nova e o registro dela na fábrica da Configuração do Ambiente.
 */
export interface Ambiente {
  readonly id: string;
  /**
   * Os processos dele morrem com o serviço, como no host local, dentro do cgroup do serviço: o processo que sai sem
   * código morreu num reinício. Num Ambiente isolado o processo sai com 128+sinal, e a recuperação da subida decide.
   */
  readonly processosMorremComOServico: boolean;
  /**
   * O env do comando começa vazio e só recebe as variáveis do agente: quem chama não precisa tirar as credenciais do
   * serviço nem apontar `gh` e `az` para uma pasta vazia, e o `PATH` do pacote do harness e a configuração do pi vêm do
   * próprio Ambiente.
   */
  readonly isolaAsVariaveisDoServico: boolean;
  /**
   * Escreve em todo o `.git` do clone e cria as worktrees por conta própria. Sem isso, o core cria a worktree por ele e
   * guarda a pasta administrativa dela em `PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA`.
   */
  readonly escreveEmTodoOGitDoClone: boolean;
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
