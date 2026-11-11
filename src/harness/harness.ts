// O Harness (F4 §6.1): a ferramenta que roda o agente de código num Ambiente, hoje o pi (`harness/pi/`). O resto do
// serviço só conhece esta interface; a única instância concreta nasce na composição e chega pelo `CondutorDeTrabalhos`.
// Só tipos: o adapter é quem tem valor.
import type { Ambiente, IdentificadorDoProcesso } from "../ambiente/infra/ambiente.ts";
import type { Effort, Modelo, ModoTrabalho } from "../compartilhado/nucleo/primitivos.ts";
import type { LinhaDeUso } from "../custos/nucleo/uso.ts";

/**
 * Um evento ou resposta do agente: um objeto JSON por linha do stdout, que o condutor lê pelo `type`.
 * ponytail: é o formato do protocolo RPC do pi, que o adapter pi entrega sem tradução; um segundo harness traduz os
 * eventos dele para este formato, ou o condutor passa a ler um conjunto de eventos próprio da Fabriquinha.
 */
export type EventoDoAgente = Record<string, unknown> & { type?: unknown };

/** O que a consulta devolve: o stdout do agente e o Uso que ela gastou. */
export interface RespostaDaConsulta {
  saida: string;
  uso: LinhaDeUso[];
}

/** O agente do ticket de uma demanda, ou o da sessão de ajustes. */
export interface LancamentoDoTicket {
  raiz: string;
  sessao: string;
  /** As skills de artefato da etapa (P1 §5.1), já filtradas por `skillsDisponiveis`. */
  skills: string[];
  modelo: Modelo | undefined;
  effort?: Effort;
  /** A decisão de confiança do Auditor no repositório (`confiancaNoRepositorio`); `undefined`: vale o padrão. */
  confianca: boolean | undefined;
  modo: ModoTrabalho;
}

/** A auditoria do Histórico: sem skills, effort nem confiança herdada; o `modelo` é o da Configuração, ou o padrão do harness. */
export interface LancamentoDeAuditoria {
  raiz: string;
  sessao: string;
  modelo?: Modelo | null;
  /** As extensões a mais da conversa (a `achado.ts` da avaliação), pelo nome do arquivo no pacote. */
  extensoes?: string[];
}

/** A execução simulada (F8 §5): o agente imita o Usuário Simulado pelo navegador e sai sozinho ao terminar. */
export interface LancamentoDaSimulacao {
  dirDaSessao: string;
  /** Os arquivos que vão junto do prompt. */
  anexos: string[];
  prompt: string;
}

/** O processo do agente lançado num Ambiente. */
export interface ProcessoDoAgente {
  /** O grupo de processos do agente no Ambiente (F4 §7). */
  readonly identificador: IdentificadorDoProcesso;
  /** Um comando do protocolo, como uma linha JSON no stdin. */
  enviar(comando: object): void;
  /** Resolve com o código de saída quando o agente termina e o stdout fecha, inclusive se ele nem chegou a rodar. */
  readonly saiu: Promise<number | null>;
  /** SIGTERM no grupo, um tempo de graça, e SIGKILL no grupo, para não sobrar o que o agente abriu. */
  parar(): Promise<void>;
}

export interface Harness {
  /** A linha de comando do agente do ticket ou da auditoria. */
  argumentos(lancamento: LancamentoDoTicket | LancamentoDeAuditoria): string[];
  /** A linha de comando da execução simulada, que lê o prompt dos argumentos e sai sozinha. */
  argumentosDaSimulacao(lancamento: LancamentoDaSimulacao): string[];
  /**
   * As variáveis de ambiente do agente, sem credenciais, para o processo em `dir`. Com `execucao`, é o agente de um
   * ticket; sem ela, o da auditoria.
   */
  variaveisDeAmbiente(
    raiz: string,
    dir: string,
    execucao?: number | string,
    tipoDoAmbiente?: Ambiente["tipo"],
  ): NodeJS.ProcessEnv;
  /** As `skills` que o pacote do harness tem, na mesma ordem. */
  skillsDisponiveis(skills: readonly string[]): string[];
  /** A decisão de confiança do Auditor mais próxima de `repositorio`; `undefined`: vale o padrão dele. */
  confiancaNoRepositorio(repositorio: string): boolean | undefined;
  /**
   * Lança o agente no `ambiente`, com o stderr no `log`; cada evento do stdout vai para `aoEvento`. Com `fecharStdin`,
   * o stdin fecha já (o agente que lê o prompt dos argumentos).
   */
  lancar(
    ambiente: Ambiente,
    args: readonly string[],
    opcoes: { cwd: string; env: NodeJS.ProcessEnv; log: string; fecharStdin?: boolean },
    aoEvento: (evento: EventoDoAgente) => void,
  ): ProcessoDoAgente;
  /**
   * A consulta (F4 §6.5): uma chamada única, sem ferramentas, que só lê o `prompt`. Devolve a resposta e o Uso, ou
   * `undefined` se o agente falhou ou passou de `limiteMs`.
   */
  perguntar(prompt: string, modelo: Modelo | undefined, limiteMs: number): Promise<RespostaDaConsulta | undefined>;
  /** Todos os pares provedor/modelo que o harness conhece (F4 §9). */
  listarModelos(): Promise<Modelo[]>;
  /** Recusa (ErroDeRegra) o par que o harness não conhece. */
  conferirModelo(modelo: Modelo): Promise<void>;
  /** O arquivo da conversa da sessão `sessao` sob `raiz`, ou `undefined` se ainda não existe. */
  arquivoDaSessao(raiz: string, sessao: string): string | undefined;
  /** O Uso da sessão por provedor e modelo, só o de `[inicio, fim]` (ms); nenhum se a sessão ainda não tem arquivo. */
  lerUsoDaSessao(raiz: string, sessao: string, inicio: number, fim: number): LinhaDeUso[];
}
