// O condutor de trabalhos (F4 §2, §6): o único que lança o pi e consulta o modelo. Roda o pi com o mesmo código de
// processo e protocolo nos modos autônomo e interativo, guarda os processos vivos com os diálogos de extensão pendentes
// (F4 §5.4), repassa os eventos a quem assina a sessão, espera os condutores na parada do serviço e, na subida, mata
// os grupos de processos que a instância anterior deixou.
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR, type Ator } from "../../../fluxo/nucleo/ator.ts";
import type { Modelo } from "../../nucleo/configuracao_agente.ts";
import type { ModoTrabalho } from "../../nucleo/trabalho_agentico.ts";
import { ErroDeRegra, existe, mensagem } from "../../../compartilhado/nucleo/erros.ts";
import type { Id } from "../../../compartilhado/nucleo/primitivos.ts";
import { instanteDepois, type Relogio, relogioDoSistema } from "../../../compartilhado/nucleo/relogio.ts";
import {
  type CausaDeInfraestrutura,
  type FalhaDaTentativa,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
} from "../../nucleo/tentativa.ts";
import { recolherGruposDasAvaliacoes } from "../../../qualidade/armazenamento/avaliacoes.ts";
import { falharPendentes } from "../../../qualidade/armazenamento/simulacao.ts";
import { gravarTokenDoProcesso, processosAbertos } from "../../armazenamento/trabalho_agentico.ts";
import { HarnessPi, type RespostaDaConsulta, type RodarComando } from "../../infra/harness_pi.ts";
import type { EventoPi } from "../../infra/pi.ts";
import type { Ambiente, IdentificadorDoProcesso } from "../../../ambiente/infra/ambiente.ts";
import { anotar, noLog } from "../../../compartilhado/infra/registro.ts";
import { ambienteDoServico, conjuntoDoServico } from "../../../ambiente/aplicacao/espaco/ambiente_do_servico.ts";
import type { PerguntaDoAgente, RespostaDoAuditorAutomatico } from "./auditor_automatico.ts";
import { type AvisarSessao, recuperarProcessosAbertos } from "./processo_do_ticket.ts";

/** Diálogos que esperam resposta; `notify` e afins não esperam, e `custom` nunca chega no modo RPC (P1 §2.1). */
const DIALOGOS = new Set(["select", "confirm", "input", "editor"]);

/** A execução autônoma que o Auditor abortou. */
const ABORTADA: FalhaDaTentativa = { tipo: "interrompida", por: AUDITOR, motivo: "abortada pelo Auditor" };

/** O que o pi relata do provedor do modelo, e a causa de infraestrutura que cada relato revela; o primeiro que casa vale. */
const CAUSAS_DO_ERRO_DO_PROVEDOR: readonly (readonly [RegExp, CausaDeInfraestrutura])[] = [
  [/quota exceeded|usage limit|rate limit|session limit|insufficient_quota|\b429\b/i, "cota"],
  [/ETIMEDOUT|TimeoutError/i, "tempo_limite"],
  [
    /HTTP 5\d\d|\b50[234]\b|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|Connection error|overloaded/i,
    "servico_externo_inacessivel",
  ],
];

/** A falha do agente que parou com erro: de infraestrutura quando o provedor relata cota, rede ou tempo; senão pede o Auditor. */
function falhaDoErroDoModelo(motivo: string): FalhaDaTentativa {
  const causa = CAUSAS_DO_ERRO_DO_PROVEDOR.find(([relato]) => relato.test(motivo))?.[1];
  return causa === undefined ? falhaQueExigeOAuditor(motivo) : { tipo: "falha_infraestrutura", causa, motivo };
}

/**
 * O maior silêncio do pi aceito enquanto o agente espera o modelo (ocupado, sem ferramenta rodando nem diálogo
 * pendente). Nas 33 mil respostas dos transcritos de `~/fabriquinha/sessoes` até 2026-11-05, a mais longa levou 5,9 min
 * do pedido ao fim, com o stream no meio, então o silêncio de verdade foi menor; a travada da I-259.T16 ficou 53 min sem
 * evento. 15 min dá folga de 2,5 vezes sobre a mais longa sem segurar à toa a retomada automática.
 */
const SILENCIO_MAXIMO_DO_MODELO_MIN = 15;

/**
 * A resposta do Auditor automático a uma chamada de `perguntar`: ela vai ao log numa linha com este prefixo e ao chat, e
 * o autor é o Agente da execução em curso, não o Auditor (CONCEITOS.md §15).
 */
export interface RespostaAutomatica extends RespostaDoAuditorAutomatico {
  ator: Extract<Ator, { tipo: "agente" }>;
  /** O `toolCallId` da chamada de `perguntar` que ela respondeu. */
  chamada: string;
  pergunta: string;
}
export const PREFIXO_DA_RESPOSTA_AUTOMATICA = "resposta automática ";

/** Um diálogo de extensão pendente: o pedido do pi, quando chegou e, se o pi o resolve sozinho, quando expira. */
export type Dialogo = EventoPi & { em: string; expiraEm?: string };

/** O que o estado da sessão (F4 §5.2) lê de um processo vivo. */
export interface Situacao {
  /** O id do processo; a avaliação (fora do agregado) usa o id da sessão. */
  execucao: Id | string;
  /** O agente está trabalhando; falso quando uma sessão interativa espera a próxima mensagem. */
  ocupado: boolean;
  /** Desde quando está ocupada ou ociosa. */
  desde: string;
  dialogos: Dialogo[];
  /** O que o agente está fazendo, pelo último evento que o diz (`atividadeDo`). */
  atividade?: string;
}

/** A parte de uma mensagem do pi que decide o sucesso (F4 §6.2, passo 5). */
interface Mensagem {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

interface Viva extends Omit<Situacao, "dialogos"> {
  sessaoPi: string;
  pendentes: Map<string, Dialogo>;
  /** Os eventos da mensagem que o pi está escrevendo, do `message_start` em diante: ela só vai ao JSONL no fim. */
  eventosDaMensagemEmEscrita: EventoPi[];
  /**
   * Os `message_end` que o JSONL pode ainda não ter. O pi 0.84.4 emite o `message_end` antes de gravar a mensagem e,
   * numa sessão sem resposta do agente, só grava quando a primeira chega: qualquer evento depois do `message_end` de
   * uma mensagem do agente prova que tudo até ela está no arquivo. O chat ignora o que o retrato já tem.
   */
  naoGravadas: EventoPi[];
  /** O Auditor mandou `abort`. */
  abortada: boolean;
  responder(id: string, resposta: object): void;
  mandar(comando: { type: string; message?: string }): void;
  encerrar(): void;
}

/** Uma linha de até 100 caracteres. */
const linha = (texto: string): string => (texto.length > 100 ? `${texto.slice(0, 99)}…` : texto);

/**
 * O que o agente está fazendo, se o evento o diz (F7 §4.4, Início): a ferramenta que começou a rodar, com o comando
 * ou o caminho, ou a primeira linha do texto que ele acabou de escrever. Os demais eventos não mudam a atividade.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function atividadeDo(evento: EventoPi): string | undefined {
  if (evento.type === "tool_execution_start") {
    const args = (evento.args ?? {}) as Record<string, unknown>;
    const alvo = [args.command, args.path].find((x) => typeof x === "string");
    return linha([String(evento.toolName), alvo].filter(Boolean).join(" "));
  }
  const m = evento.type === "message_end" ? (evento.message as { role?: string; content?: unknown } | null) : null;
  if (m?.role !== "assistant" || !Array.isArray(m.content)) return undefined;
  const texto = (m.content as { type?: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("\n");
  const primeira = texto
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return primeira && linha(primeira);
}

/** O que o chat precisa saber do select aberto pela `perguntar` (a de `title` igual a `args.question`); `undefined` nos demais. */
function daPergunta(evento: EventoPi, emExecucao: Iterable<Record<string, unknown>>): Partial<Dialogo> | undefined {
  const args = [...emExecucao].find((a) => a.question === evento.title);
  if (!args) return undefined;
  const opcoes = (args.options ?? []) as { description?: string }[];
  return {
    pergunta: true,
    multiSelect: Boolean(args.multiSelect),
    descricoes: opcoes.map((o) => o.description),
    message: args.details,
  };
}

/** @testes tipo que o teste usa para montar a entrada */
export interface PedidoDeProcesso {
  /** O processo de um ticket, ou da avaliação (`id` é a sessão), que roda como consulta e fica fora do agregado. */
  execucao: { id: Id | string; sessaoPi: string; modo: ModoTrabalho };
  args: string[];
  cwd: string;
  /** Onde o pi roda: o Ambiente do Espaço do ticket; sem ele (consulta, avaliação, simulação), o do serviço. */
  ambiente?: Ambiente;
  env: NodeJS.ProcessEnv;
  /** Com o banco, o processo é de um ticket e recebe o token com que o agente fala com a API (`FABRIQUINHA_TOKEN`). */
  banco?: DatabaseSync;
  log: string;
  prompt: string | undefined;
  limiteMin: number;
  /**
   * O pi em `--mode json` (a simulação): lê o prompt dos argumentos, não usa o RPC e sai quando termina o trabalho;
   * sair, com qualquer código ou sinal, é o desfecho normal, e o `limiteMin` é o único relógio.
   */
  terminaSozinho?: boolean;
  /** Chamado com o grupo de processos do pi e o Ambiente que o lançou, logo depois de lançado, para quem precisa matá-lo no reinício (F4 §7). */
  aoLancar(pgid: number, ambienteId: string): void;
  /**
   * Autônoma: o Auditor automático lê antes a pergunta da `perguntar` e devolve a resposta do que é banal; `undefined`
   * deixa a pergunta com o Auditor humano. Sem a triagem, toda pergunta espera o humano.
   */
  triarPergunta?: (pergunta: PerguntaDoAgente) => Promise<RespostaDoAuditorAutomatico | undefined>;
  /** Padrão: SILENCIO_MAXIMO_DO_MODELO_MIN; os testes encurtam. */
  silencioMaximoDoModeloMin?: number;
}

/** O sinal a um processo que não vai esperar a resposta; a falha do sinal vai para o log, nunca derruba o serviço. */
function sinalizarSemEsperar(
  ambienteDoProcesso: Ambiente,
  identificador: IdentificadorDoProcesso,
  sinal: NodeJS.Signals,
): void {
  ambienteDoProcesso.sinalizar(identificador, sinal).catch(noLog);
}

export class CondutorDeTrabalhos {
  private readonly harness = new HarnessPi();
  private readonly vivas = new Map<Id | string, Viva>();
  private readonly ouvintes = new Map<string, Set<(evento: EventoPi) => void>>();
  /** Os processos de ticket com condutor vivo, por id, com o grupo do pi e o Ambiente que o lançou, depois de lançado. */
  private readonly ativas = new Map<
    string,
    { identificador?: IdentificadorDoProcesso; ambienteDoPi?: Ambiente; interrompida?: boolean }
  >();
  /** Os condutores em curso, por id do processo: o `parar` do serviço os espera antes de fechar o banco. */
  private readonly condutores = new Map<string, Promise<unknown>>();
  /** As sessões com pi subindo, vivo ou parando: no máximo um pi por sessão. */
  private readonly sessoesEmCurso = new Set<string>();
  /** Desde o início do `parar`, o pi que sai é efeito da parada do serviço. */
  private parando = false;
  /** O endereço da API do agente (`FABRIQUINHA_API`): o serviço o informa depois do listen e o retira ao parar. */
  urlDaApi: string | undefined;

  /**
   * O ambiente do pi com o token novo do processo: só o hash vai ao banco, e o token vale até o `fim` do processo, que o
   * invalida. Sem banco (consulta, simulação), o ambiente segue como veio.
   */
  private ambienteComToken(r: PedidoDeProcesso): NodeJS.ProcessEnv {
    if (r.banco === undefined) return r.env;
    const token = randomBytes(32).toString("hex");
    gravarTokenDoProcesso(r.banco, String(r.execucao.id), token);
    return {
      ...r.env,
      FABRIQUINHA_TOKEN: token,
      ...(this.urlDaApi !== undefined && { FABRIQUINHA_API: this.urlDaApi }),
    };
  }

  private vivaDaSessao(sessao: string): Viva | undefined {
    return [...this.vivas.values()].find((v) => v.sessaoPi === sessao);
  }

  /**
   * Recebe cada evento do pi dos processos da sessão e `{ type: "estado" }` quando o estado dela pode ter mudado.
   * Quem assina recebe antes o que o retrato do JSONL pode ainda não ter: as mensagens terminadas ainda sem gravação
   * garantida e os eventos da mensagem em andamento até ali.
   */
  assinar(sessao: string, ouvinte: (evento: EventoPi) => void): () => void {
    const lista = this.ouvintes.get(sessao) ?? new Set();
    this.ouvintes.set(sessao, lista.add(ouvinte));
    const viva = this.vivaDaSessao(sessao);
    for (const evento of [...(viva?.naoGravadas ?? []), ...(viva?.eventosDaMensagemEmEscrita ?? [])]) ouvinte(evento);
    return () => {
      lista.delete(ouvinte);
      if (lista.size === 0) this.ouvintes.delete(sessao);
    };
  }

  /** Entrega o evento a cada ouvinte da sessão; o erro de um ouvinte vai para o `log` e não para o processo. */
  private repassar(sessao: string, evento: EventoPi, log: string): void {
    for (const ouvinte of this.ouvintes.get(sessao) ?? []) {
      try {
        ouvinte(evento);
      } catch (error_) {
        anotar(log, `um ouvinte da sessão falhou com o evento ${String(evento.type)}: ${mensagem(error_)}`);
      }
    }
  }

  /** Avisa quem assina a sessão que o estado dela pode ter mudado (F7, eventos do chat); `log` é o do processo. */
  readonly avisar: AvisarSessao = (sessao, log) => {
    this.repassar(sessao, { type: "estado" }, log);
  };

  /** O processo vivo da sessão neste serviço, se há um. */
  situacao(sessao: string): Situacao | undefined {
    const viva = this.vivaDaSessao(sessao);
    return (
      viva && {
        execucao: viva.execucao,
        ocupado: viva.ocupado,
        desde: viva.desde,
        dialogos: [...viva.pendentes.values()],
        ...(viva.atividade && { atividade: viva.atividade }),
      }
    );
  }

  /** A sessão tem pi subindo, vivo ou parando. */
  emCurso(sessao: string): boolean {
    return this.sessoesEmCurso.has(sessao);
  }

  private viva(execucao: Id | string, solucao: string): Viva {
    return existe(this.vivas.get(execucao), `a execução E-${String(execucao)} não tem pi rodando`, solucao);
  }

  /** Responde um diálogo pendente (`extension_ui_response` do RPC do pi): `value`, `confirmed` ou `cancelled`. */
  responder(
    execucao: Id | string,
    dialogo: string,
    resposta: { value: string } | { confirmed: boolean } | { cancelled: true },
  ): void {
    this.viva(execucao, "nada a responder").responder(dialogo, resposta);
  }

  /**
   * Manda `abort` ao pi. Antes cancela os diálogos pendentes: o `editor` não tem tempo limite nem cancelamento do lado
   * do pi, e o agente preso nele nunca veria o `abort` (F4 §5.4).
   */
  abortar(execucao: Id | string): void {
    const v = this.viva(execucao, "nada a abortar");
    for (const id of v.pendentes.keys()) v.responder(id, { cancelled: true });
    v.abortada = true;
    v.mandar({ type: "abort" });
  }

  /** Um comando de conversa ao pi vivo: `prompt` acorda a sessão ociosa; `steer` e `follow_up` entram no passo atual. */
  mandar(execucao: Id | string, comando: { type: "prompt" | "steer" | "follow_up"; message: string }): void {
    this.viva(execucao, "retome a sessão").mandar(comando);
  }

  /** Para o pi do processo e o dá por bem terminado, como na ociosidade (F4 §6.6). */
  encerrar(execucao: Id | string): void {
    this.viva(execucao, "nada a encerrar").encerrar();
  }

  /**
   * Registra o processo do ticket `id` e conduz até `conducao` terminar, já interrompível durante a preparação. O
   * `aguardarTodos` espera esta promessa.
   */
  acompanhar<R>(id: string, conducao: () => Promise<R>): Promise<R> {
    this.ativas.set(id, {});
    const fim = conducao();
    this.condutores.set(id, fim);
    const sair = () => this.condutores.delete(id);
    fim.then(sair, sair);
    return fim;
  }

  /** Espera o condutor do processo `id` terminar, inclusive o fechamento; sem condutor em curso, volta na hora. */
  async aguardarFim(id: string): Promise<void> {
    await this.condutores.get(id);
  }

  /** O Auditor interrompeu o processo do ticket enquanto o condutor dele vivia. */
  foiInterrompido(id: string): boolean {
    return this.ativas.get(id)?.interrompida === true;
  }

  /** O processo do ticket terminou: sai do registro dos que podem ser interrompidos. */
  deixarDeAcompanhar(id: string): void {
    this.ativas.delete(id);
  }

  /**
   * Interrompe o processo do ticket com condutor vivo: o SIGTERM no grupo faz o condutor gravar a falha; ainda na
   * preparação, o pi que subir recebe o término já. `false`: não há condutor.
   */
  interromper(id: string): boolean {
    const viva = this.ativas.get(id);
    if (!viva) return false;
    viva.interrompida = true;
    if (viva.identificador && viva.ambienteDoPi) sinalizarSemEsperar(viva.ambienteDoPi, viva.identificador, "SIGTERM");
    return true;
  }

  /** A parada do serviço começou: o condutor que acordar depois grava "serviço reiniciado" e não lança pi novo. */
  emParada(): boolean {
    return this.parando;
  }

  /** O `parar` do serviço chama antes de qualquer `await`. */
  marcarParada(): void {
    this.parando = true;
  }

  /**
   * Parada do serviço: espera os condutores em curso por até `limiteMs`, para gravarem o fim do processo com o banco
   * ainda aberto. Passado o limite, mata o grupo dos pi que restaram (SIGKILL) e espera os condutores gravarem a falha:
   * quem falha por causa da parada termina como "serviço reiniciado". A espera depois do SIGKILL também tem limite
   * (`aposKillMs`): o condutor fora do pi (preparação, verificações) pode não acordar; então volta assim mesmo, e a
   * subida seguinte marca o ticket como "serviço reiniciado".
   */
  async aguardarTodos(limiteMs: number, aposKillMs = 2000): Promise<void> {
    this.marcarParada();
    const esperar = async (ms: number) => {
      let timer: NodeJS.Timeout | undefined;
      const limite = new Promise<"limite">((pronto) => {
        timer = setTimeout(pronto, ms, "limite");
      });
      const resultado = await Promise.race([Promise.allSettled(this.condutores.values()), limite]);
      clearTimeout(timer);
      return resultado;
    };
    if ((await esperar(limiteMs)) === "limite") {
      for (const { identificador, ambienteDoPi } of this.ativas.values()) {
        if (identificador && ambienteDoPi) sinalizarSemEsperar(ambienteDoPi, identificador, "SIGKILL");
      }
      await esperar(aposKillMs);
    }
    this.parando = false;
  }

  /**
   * F4 §7: todo processo em andamento é de uma instância anterior. Mata o grupo do pi de cada processo de ticket, pelo
   * Ambiente que o lançou (o host local ou um container do conjunto), e o de cada avaliação e de cada execução simulada
   * pendente (que falha); os processos dos tickets se encerram com "serviço reiniciado", decidido aqui, que sabe quem
   * reiniciou. O container do processo morto é limpo e devolvido pelo `reconciliarNaSubida` do conjunto.
   */
  recuperarNaSubida(banco: DatabaseSync, relogio: Relogio = relogioDoSistema): void {
    const doServico = ambienteDoServico();
    const gruposDoServico = [
      ...recolherGruposDasAvaliacoes(banco),
      ...falharPendentes(banco, falhaPorServicoReiniciado.motivo, relogio.agora()),
    ];
    const processos = [
      ...processosAbertos(banco).flatMap(({ ambiente_id, grupo_processo }) =>
        grupo_processo === null ? [] : [{ ambiente_id, grupo_processo }],
      ),
      ...gruposDoServico.map((grupo_processo) => ({ ambiente_id: doServico.id, grupo_processo })),
    ];
    // ponytail: o sinal não é esperado; com container o `reconciliarNaSubida` limpa o que sobrar antes de o serviço seguir.
    for (const processo of processos) {
      const ambiente =
        processo.ambiente_id === doServico.id ? doServico : conjuntoDoServico()?.ambientePorId(processo.ambiente_id);
      if (ambiente) sinalizarSemEsperar(ambiente, processo, "SIGKILL");
    }
    recuperarProcessosAbertos(banco, this.avisar);
  }

  /**
   * A consulta ao modelo (F4 §6.5): uma chamada única, sem ferramentas, no ambiente sem credenciais dos outros
   * modos. Devolve a resposta e o Uso dela, ou `undefined` se o pi falhou ou passou de `limiteMs`.
   */
  consultar(
    prompt: string,
    modelo: Modelo | undefined,
    limiteMs: number,
    rodar?: RodarComando,
  ): Promise<RespostaDaConsulta | undefined> {
    return this.harness.perguntar(prompt, modelo, limiteMs, rodar);
  }

  /**
   * Lança o pi, envia o prompt e conduz o protocolo RPC até o fim, parando o grupo do pi em qualquer desfecho.
   * Autônoma: termina no `agent_settled`, com falha se a última mensagem do assistente parou com erro ou aborto.
   * Interativa: o `agent_settled` só a deixa ociosa; ela termina bem quando a ociosidade passa ou alguém a encerra.
   * Ambas falham como infraestrutura (`tempo_limite` e `modelo_sem_resposta`, que a política retoma) se o modelo fica calado.
   * A autônoma falha se o pi recusa um comando; a interativa só anota a recusa. Ambas falham se o pi sai sozinho.
   * Resolve com a falha tipada, ou `undefined`.
   *
   * ponytail: um diálogo que o próprio pi resolve por `signal` não emite evento; ele fica pendente (e, na autônoma, o
   * relógio parado) até o Auditor respondê-lo ou cancelá-lo, ou até o pi terminar. Se a extensão que faz isso existir,
   * dar o diálogo por resolvido no `turn_start` seguinte.
   */
  iniciar(r: PedidoDeProcesso, relogio: Relogio = relogioDoSistema): Promise<FalhaDaTentativa | undefined> {
    return new Promise((resolve) => {
      const agoraEmMs = () => Date.parse(relogio.agora());
      const { id, sessaoPi } = r.execucao;
      const env = this.ambienteComToken(r);
      const autonoma = r.execucao.modo === "autonomo";
      const pendentes = new Map<string, Dialogo>();
      const expiracoes = new Map<string, NodeJS.Timeout>();
      /** Os args das chamadas da `perguntar` em execução, por `toolCallId`: o select dela é a pergunta ao Auditor. */
      const perguntas = new Map<string, Record<string, unknown>>();
      let ultima: Mensagem = {};
      let restante = r.limiteMin * 60_000;
      let desde = 0;
      let temporizadorDoLimite: NodeJS.Timeout | undefined;
      /** As ferramentas em execução, por `toolCallId`: enquanto alguma roda, o silêncio do pi não é do modelo. */
      const ferramentasRodando = new Set<string>();
      let vigiaDoModelo: NodeJS.Timeout | undefined;
      let feito = false;
      this.sessoesEmCurso.add(sessaoPi);
      const fim = (falha?: FalhaDaTentativa) => {
        if (feito) return;
        feito = true;
        clearTimeout(temporizadorDoLimite);
        clearTimeout(vigiaDoModelo);
        for (const t of expiracoes.values()) clearTimeout(t);
        this.vivas.delete(id);
        void pi.parar().then(() => {
          this.sessoesEmCurso.delete(sessaoPi);
          resolve(falha);
        });
      };
      // Autônoma (F4 §6.7): só o tempo ativo conta; o relógio para enquanto algum diálogo espera o Auditor.
      // Interativa (F4 §6.6): a ociosidade conta do zero cada vez que o agente assenta sem diálogo pendente.
      const acertarRelogio = () => {
        // Depois do fim, eventos atrasados do pi não armam relógio novo: ele seguraria o processo à toa.
        if (feito) return;
        if (autonoma) {
          if (pendentes.size > 0 && temporizadorDoLimite) {
            clearTimeout(temporizadorDoLimite);
            temporizadorDoLimite = undefined;
            restante -= agoraEmMs() - desde;
          } else if (pendentes.size === 0 && !temporizadorDoLimite) {
            desde = agoraEmMs();
            temporizadorDoLimite = setTimeout(() => {
              fim({
                tipo: "falha_infraestrutura",
                causa: "tempo_limite",
                motivo: `tempo limite de ${String(r.limiteMin)} min`,
              });
            }, restante);
          }
          return;
        }
        clearTimeout(temporizadorDoLimite);
        temporizadorDoLimite = undefined;
        if (!estaViva.ocupado && pendentes.size === 0) {
          temporizadorDoLimite = setTimeout(() => {
            anotar(r.log, `sessão ociosa por ${String(r.limiteMin)} min; o pi para`);
            fim();
          }, restante);
        }
      };
      /**
       * Rearma a cada evento e a cada mudança de estado: só conta enquanto se espera o modelo. O provedor que não responde
       * não gera erro nem evento; sem o vigia, a execução esperaria o limite inteiro (horas) para falhar.
       */
      const rearmarVigiaDoModelo = () => {
        clearTimeout(vigiaDoModelo);
        if (feito || !estaViva.ocupado || ferramentasRodando.size > 0 || pendentes.size > 0) return;
        const silencioMin = r.silencioMaximoDoModeloMin ?? SILENCIO_MAXIMO_DO_MODELO_MIN;
        vigiaDoModelo = setTimeout(() => {
          const falha: FalhaDaTentativa = {
            tipo: "falha_infraestrutura",
            causa: "modelo_sem_resposta",
            motivo: `o modelo ficou ${String(silencioMin)} min sem responder (tempo limite sem eventos do pi)`,
          };
          anotar(r.log, falha.motivo);
          fim(falha);
        }, silencioMin * 60_000);
      };
      const mudou = () => {
        rearmarVigiaDoModelo();
        acertarRelogio();
        this.avisar(sessaoPi, r.log);
      };
      const ocupar = (ocupado: boolean) => {
        estaViva.ocupado = ocupado;
        estaViva.desde = relogio.agora();
      };

      const aoRecusar = (evento: EventoPi) => {
        const recusa = `o pi recusou o comando ${String(evento.command)}: ${String(evento.error)}`;
        if (autonoma) {
          fim(falhaQueExigeOAuditor(recusa));
          return;
        }
        // Na interativa a recusa já chegou ao chat; um `steer` que cruzou o `agent_settled` não derruba a sessão. O prompt
        // rejeitado devolve o estado de antes dele: o pi que o recusa por já estar trabalhando continua ocupado.
        anotar(r.log, recusa);
        if (evento.command === "prompt") {
          ocupar(ocupadoAntesDoPrompt);
          mudou();
        }
      };
      /** Manda ao agente a resposta do Auditor automático, se o humano não respondeu antes; a escalada só vai ao log. */
      const triar = async (
        triagem: NonNullable<PedidoDeProcesso["triarPergunta"]>,
        dialogo: string,
        chamada: string,
        args: Record<string, unknown>,
      ) => {
        const opcoesComRotulo = ((args.options ?? []) as { label: string; description?: string }[])
          .map((o) => ({ rotulo: o.label.trim(), descricao: o.description?.trim() ?? "" }))
          .filter((o) => o.rotulo);
        const opcoes = opcoesComRotulo.map((o) => o.rotulo);
        const descricoes = opcoesComRotulo.some((o) => o.descricao)
          ? { descricoes: opcoesComRotulo.map((o) => o.descricao) }
          : {};
        const pergunta = String(args.question);
        const detalhes = typeof args.details === "string" && args.details ? { detalhes: args.details } : {};
        const decisao = await triagem({ pergunta, ...detalhes, opcoes, ...descricoes });
        if (!decisao) {
          anotar(r.log, `Auditor automático escalou ao Auditor: ${pergunta}`);
          return;
        }
        if (!pendentes.has(dialogo)) return;
        anotar(r.log, `Auditor automático respondeu "${decisao.resposta}" a "${pergunta}": ${decisao.justificativa}`);
        const registro: RespostaAutomatica = {
          ...decisao,
          ator: { tipo: "agente", trabalho_id: String(r.execucao.id) },
          chamada,
          pergunta,
        };
        anotar(r.log, `${PREFIXO_DA_RESPOSTA_AUTOMATICA}${JSON.stringify(registro)}`);
        this.repassar(sessaoPi, { type: "resposta_automatica", ...registro }, r.log);
        estaViva.responder(dialogo, {
          value: args.multiSelect ? JSON.stringify([decisao.resposta]) : decisao.resposta,
        });
      };
      const aoDialogo = (evento: EventoPi) => {
        const dialogo = String(evento.id);
        const em = relogio.agora();
        // F4 §5.4: o diálogo com tempo limite também espera o Auditor; o pi o resolve sozinho quando expira.
        const timeout = typeof evento.timeout === "number" ? evento.timeout : undefined;
        const pergunta = evento.method === "select" ? daPergunta(evento, perguntas.values()) : undefined;
        pendentes.set(dialogo, {
          ...evento,
          ...pergunta,
          em,
          ...(timeout !== undefined && { expiraEm: instanteDepois(em, timeout) }),
        });
        const chamada = [...perguntas].find(
          ([, a]) => evento.title === a.question || String(evento.title).startsWith(`${String(a.question)}\n\n`),
        );
        if (autonoma && r.triarPergunta && chamada) void triar(r.triarPergunta, dialogo, ...chamada);
        if (timeout !== undefined) {
          expiracoes.set(
            dialogo,
            setTimeout(() => {
              pendentes.delete(dialogo);
              expiracoes.delete(dialogo);
              mudou();
            }, timeout),
          );
        }
        mudou();
      };
      const aoAssentar = () => {
        if (!autonoma) {
          ocupar(false);
          mudou();
          return;
        }
        if (estaViva.abortada && ultima.stopReason === "aborted") {
          fim(ABORTADA);
          return;
        }
        const parou = ["error", "aborted"].includes(String(ultima.stopReason));
        fim(
          parou
            ? falhaDoErroDoModelo(
                [`o agente parou com stopReason ${String(ultima.stopReason)}`, ultima.errorMessage]
                  .filter(Boolean)
                  .join(": "),
              )
            : undefined,
        );
      };

      /** O último evento foi o `message_end` de uma mensagem do agente. */
      let agenteTerminou = false;
      /** Se o agente trabalhava quando o último `prompt` foi mandado: a recusa do pi volta a ele. */
      let ocupadoAntesDoPrompt = false;
      const ambienteDoPi = r.ambiente ?? ambienteDoServico();
      const pi = this.harness.lancar(
        ambienteDoPi,
        r.args,
        { cwd: r.cwd, env, log: r.log, ...(r.terminaSozinho && { fecharStdin: true }) },
        (evento) => {
          // O `--mode json` não fala o protocolo RPC: o resultado do trabalho é o que ele grava em disco.
          if (r.terminaSozinho) return;
          if (agenteTerminou) estaViva.naoGravadas = [];
          agenteTerminou = false;
          this.repassar(sessaoPi, evento, r.log);
          estaViva.atividade = atividadeDo(evento) ?? estaViva.atividade;
          switch (evento.type) {
            case "message_start":
              estaViva.eventosDaMensagemEmEscrita = [evento];
              break;
            case "message_update":
              estaViva.eventosDaMensagemEmEscrita.push(evento);
              break;
            case "response":
              if (evento.success === false) aoRecusar(evento);
              break;
            case "message_end": {
              estaViva.eventosDaMensagemEmEscrita = [];
              estaViva.naoGravadas.push(evento);
              // `message` ausente ou nulo não derruba o ouvinte: vale como mensagem sem papel.
              const mensagem = (evento.message ?? {}) as Mensagem;
              if (mensagem.role === "assistant") {
                ultima = mensagem;
                agenteTerminou = true;
              }
              break;
            }
            case "tool_execution_start":
              ferramentasRodando.add(String(evento.toolCallId));
              if (evento.toolName === "perguntar")
                perguntas.set(String(evento.toolCallId), evento.args as Record<string, unknown>);
              break;
            case "tool_execution_end":
              ferramentasRodando.delete(String(evento.toolCallId));
              perguntas.delete(String(evento.toolCallId));
              // O CLI `fabriquinha` roda noutro processo e não alcança os ouvintes: o fim da ferramenta avisa o chat.
              this.avisar(sessaoPi, r.log);
              break;
            case "agent_start":
              ocupar(true);
              mudou();
              break;
            case "extension_ui_request":
              if (DIALOGOS.has(String(evento.method))) aoDialogo(evento);
              break;
            case "agent_settled":
              aoAssentar();
              break;
          }
          rearmarVigiaDoModelo();
        },
      );
      // Sem pid (o pi nem subiu) não há grupo a gravar; o `saiu` do pi relata o erro.
      if (Number.isInteger(pi.identificador.grupo_processo)) {
        const ativa = this.ativas.get(String(id));
        if (ativa) {
          ativa.identificador = pi.identificador;
          ativa.ambienteDoPi = ambienteDoPi;
          // Interrompido durante a preparação: o pi que acaba de subir recebe o término já.
          if (ativa.interrompida) sinalizarSemEsperar(ambienteDoPi, pi.identificador, "SIGTERM");
        }
        r.aoLancar(pi.identificador.grupo_processo, pi.identificador.ambiente_id);
      }
      void pi.saiu.then((codigo) => {
        if (r.terminaSozinho) {
          fim();
          return;
        }
        // Sem código, o pi do host morreu por sinal: o cgroup do serviço ou um kill externo, que a Fabriquinha trata como
        // reinício. No container o processo sai com 128+sinal, e o reinício é decidido pela `recuperarNaSubida`.
        fim(
          codigo === null && ambienteDoPi.tipo === "host_local"
            ? falhaPorServicoReiniciado
            : falhaQueExigeOAuditor(
                `o pi saiu antes de terminar a execução (código ${String(codigo)}); veja o log em ${r.log}`,
              ),
        );
      });
      const estaViva: Viva = {
        execucao: id,
        sessaoPi,
        ocupado: r.prompt !== undefined,
        desde: relogio.agora(),
        pendentes,
        eventosDaMensagemEmEscrita: [],
        naoGravadas: [],
        abortada: false,
        responder(dialogo, resposta) {
          if (!pendentes.delete(dialogo)) {
            throw new ErroDeRegra(`o diálogo ${dialogo} não está pendente na E-${String(id)}`, "atualize o chat");
          }
          clearTimeout(expiracoes.get(dialogo));
          expiracoes.delete(dialogo);
          pi.enviar({ type: "extension_ui_response", id: dialogo, ...resposta });
          mudou();
        },
        mandar(comando) {
          pi.enviar(comando);
          if (comando.type === "prompt") {
            ocupadoAntesDoPrompt = estaViva.ocupado;
            ocupar(true);
            mudou();
          }
        },
        encerrar: () => {
          fim();
        },
      };
      this.vivas.set(id, estaViva);
      if (r.prompt !== undefined) pi.enviar({ type: "prompt", message: r.prompt });
      mudou();
    });
  }
}

/** O condutor do serviço: todo pi e toda consulta ao modelo passam por ele. */
export const condutor = new CondutorDeTrabalhos();
