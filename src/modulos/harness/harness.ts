// O Harness (F4 §6.1): a ferramenta que roda o agente de código num Ambiente, hoje o pi (`harness/pi/`). O resto do
// serviço só conhece esta interface; a única instância concreta nasce na composição e chega pelo `CondutorDeTrabalhos`.
// Só tipos: o adapter é quem tem valor.
import type { Ambiente, IdentificadorDoProcesso } from "../sandbox/infra/ambiente.ts";
import type { Effort, Modelo, ModoTrabalho } from "../compartilhado/nucleo/primitivos.ts";
import type { LinhaDeUso } from "../compartilhado/nucleo/vocabulario_do_sdlc/uso.ts";

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

/**
 * O agente do ticket de uma demanda, ou o da sessão de ajustes: o adapter monta a linha de comando, filtra as skills que
 * o pacote dele tem e resolve a confiança do Auditor no `repositorio`.
 */
export interface LancamentoDoTicket {
  tipo: "ticket";
  raiz: string;
  sessao: string;
  /** A pasta do processo (`saida/`, `vazio/`), sob a raiz. */
  dir: string;
  /** As skills de artefato da etapa (P1 §5.1), as do catálogo. */
  skills: readonly string[];
  modelo: Modelo | undefined;
  effort?: Effort;
  modo: ModoTrabalho;
  /** A raiz git do projeto, de onde vem a confiança herdada do Auditor. */
  repositorio: string;
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
  /**
   * Lança o agente do `lancamento` no `ambiente`, em `cwd`, com o stderr no `log`; cada evento do stdout vai para
   * `aoEvento`. O adapter monta a linha de comando e as variáveis de ambiente sem credenciais; `variaveisDoServico` (o
   * token e o endereço da API do agente) entram por cima delas.
   */
  lancar(
    ambiente: Ambiente,
    lancamento: LancamentoDoTicket,
    opcoes: { cwd: string; log: string; variaveisDoServico?: Record<string, string> },
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
