// As sessões de agente (MELHORIAS §9, Execução): o único que lança o harness e consulta o modelo. Roda o agente com o
// mesmo código de processo e protocolo nos modos autônomo e interativo, guarda os processos vivos com os diálogos de
// extensão pendentes (F4 §5.4), repassa os eventos a quem assina a sessão, espera as execuções na parada do serviço e, na
// subida, mata os grupos de processos que a instância anterior deixou. A política (prompt, modelo, capacidades, a
// resposta automática a uma pergunta) chega pronta no pedido.
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
import { instanteDepois, type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { anotar, noLog } from "../../../../shared/infra/registro.ts";
import {
  type Ambiente,
  ambienteDoServico,
  conjuntoDoServico,
  type IdentificadorDoProcesso,
} from "../../../ambiente/publico.ts";
import {
  atividadeDo,
  daPergunta,
  type Dialogo,
  DIALOGOS,
  type EventoDaSessao,
  OuvintesDasSessoes,
  type PerguntaDoAgente,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAPergunta,
  type RespostaAutomatica,
  type Situacao,
} from "../../chat/publico.ts";
import type {
  EventoDoAgente,
  Harness,
  LancamentoDoTicket,
  MensagemDoAgente,
  ModoTrabalho,
  PedidoDeExtensao,
  ProcessoDoAgente,
  RespostaDaConsulta,
} from "../../harness/publico.ts";
import { lerConversaDoArquivo, perguntasRespondidasNaConversa } from "../../historico/publico.ts";
import type { Modelo } from "../../modelos/publico.ts";
import { execucoesAbertas, gravarTokenDaExecucao } from "../armazenamento/sessoes_e_execucoes.ts";
import { type FalhaDaExecucao, falhaDoErroDoModelo } from "../nucleo/falha_da_execucao.ts";

/** A execução autônoma que quem acompanha a sessão abortou. */
const ABORTADA: FalhaDaExecucao = { tipo: "abortada", motivo: "abortada pelo Auditor" };

/**
 * O maior silêncio do pi aceito enquanto o agente espera o modelo (ocupado, sem ferramenta rodando nem diálogo
 * pendente). Nas 33 mil respostas dos transcritos de `~/fabriquinha/sessoes` até 2026-11-05, a mais longa levou 5,9 min
 * do pedido ao fim, com o stream no meio, então o silêncio de verdade foi menor; a travada da I-259.T16 ficou 53 min sem
 * evento. 15 min dá folga de 2,5 vezes sobre a mais longa sem segurar à toa a retomada automática.
 */
const SILENCIO_MAXIMO_DO_MODELO_MIN = 15;

interface Viva extends Omit<Situacao, "dialogos"> {
  sessao: string;
  pendentes: Map<string, Dialogo>;
  /** Os eventos da mensagem que o pi está escrevendo, do `message_start` em diante: ela só vai ao JSONL no fim. */
  eventosDaMensagemEmEscrita: EventoDoAgente[];
  /**
   * Os `message_end` que o JSONL pode ainda não ter. O pi 0.84.4 emite o `message_end` antes de gravar a mensagem e,
   * numa sessão sem resposta do agente, só grava quando a primeira chega: qualquer evento depois do `message_end` de
   * uma mensagem do agente prova que tudo até ela está no arquivo. O chat ignora o que o retrato já tem.
   */
  naoGravadas: EventoDoAgente[];
  /** O Auditor mandou `abort`. */
  abortada: boolean;
  responder(id: string, resposta: object): void;
  mandar(comando: { type: string; message?: string }): void;
  encerrar(): void;
}

/** @testes tipo que o teste usa para montar a entrada */
export interface PedidoDeProcesso {
  /** A execução a lançar, a sessão que ela continua e o modo. */
  execucao: { id: number | string; sessao: string; modo: ModoTrabalho };
  /** O agente a lançar, que o harness transforma em linha de comando e variáveis de ambiente. */
  lancamento: LancamentoDoTicket;
  cwd: string;
  /** Onde o pi roda: o Ambiente do Espaço do ticket; sem ele, o do serviço. */
  ambiente?: Ambiente;
  /** Com o banco, a execução recebe o token com que o agente fala com a API (`FABRIQUINHA_TOKEN`). */
  banco?: DatabaseSync;
  log: string;
  prompt: string | undefined;
  limiteMin: number;
  /** Chamado com o grupo de processos do pi e o Ambiente que o lançou, logo depois de lançado, para quem precisa matá-lo no reinício (F4 §7). */
  aoLancar(pgid: number, ambienteId: string): void;
  /**
   * Autônoma: a política lê antes a pergunta da `perguntar` e devolve a resposta do que pode responder sozinha;
   * `undefined` deixa a pergunta com o Auditor humano. Sem a triagem, toda pergunta espera o humano.
   */
  triarPergunta?: (pergunta: PerguntaDoAgente) => Promise<RespostaAPergunta | undefined>;
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

export class SessoesDeAgente {
  #harness: Harness | undefined;
  private readonly vivas = new Map<number | string, Viva>();
  private readonly ouvintes = new OuvintesDasSessoes();
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

  /** Sem o harness, o condutor espera o da composição (`montarHarness`). */
  constructor(harness?: Harness) {
    this.#harness = harness;
  }

  /** O harness que roda o agente; o resto do serviço o pede ao condutor, que o recebeu da composição. */
  get harness(): Harness {
    return existe(this.#harness, "o condutor não tem harness", "monte o harness pela composição do serviço");
  }

  montarHarness(harness: Harness): void {
    this.#harness = harness;
  }

  /**
   * O token novo do processo e o endereço da API do agente, que o harness soma às variáveis do agente: só o hash vai ao
   * banco, e o token vale até o `fim` do processo, que o invalida. Sem banco, nenhuma.
   */
  private variaveisDoServico(r: PedidoDeProcesso): Record<string, string> {
    if (r.banco === undefined) return {};
    const token = randomBytes(32).toString("hex");
    gravarTokenDaExecucao(r.banco, String(r.execucao.id), token);
    return {
      FABRIQUINHA_TOKEN: token,
      ...(this.urlDaApi !== undefined && { FABRIQUINHA_API: this.urlDaApi }),
    };
  }

  /**
   * O harness pode recusar o lançamento antes de subir o agente (a raiz git sumiu, a sessão tem dois arquivos): a sessão
   * deixa de estar em curso, para a próxima tentativa poder lançar, e o erro segue para quem pediu.
   */
  private lancarSemPrenderASessao(sessao: string, lancar: () => ProcessoDoAgente): ProcessoDoAgente {
    try {
      return lancar();
    } catch (erro) {
      this.sessoesEmCurso.delete(sessao);
      throw erro;
    }
  }

  private vivaDaSessao(sessao: string): Viva | undefined {
    return [...this.vivas.values()].find((v) => v.sessao === sessao);
  }

  /**
   * Recebe cada evento do pi dos processos da sessão e `{ type: "estado" }` quando o estado dela pode ter mudado.
   * Quem assina recebe antes o que o retrato do JSONL pode ainda não ter: as mensagens terminadas ainda sem gravação
   * garantida e os eventos da mensagem em andamento até ali.
   */
  assinar(sessao: string, ouvinte: (evento: EventoDaSessao) => void): () => void {
    const viva = this.vivaDaSessao(sessao);
    return this.ouvintes.assinar(sessao, ouvinte, [
      ...(viva?.naoGravadas ?? []),
      ...(viva?.eventosDaMensagemEmEscrita ?? []),
    ]);
  }

  private repassar(sessao: string, evento: EventoDaSessao, log: string): void {
    this.ouvintes.repassar(sessao, evento, log);
  }

  /** Avisa quem assina a sessão que o estado dela pode ter mudado (F7, eventos do chat); `log` é o do processo. */
  readonly avisar = (sessao: string, log: string): void => {
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

  private viva(execucao: number | string, solucao: string): Viva {
    return existe(this.vivas.get(execucao), `a execução E-${String(execucao)} não tem pi rodando`, solucao);
  }

  /** Responde um diálogo pendente (`extension_ui_response` do RPC do pi): `value`, `confirmed` ou `cancelled`. */
  responder(
    execucao: number | string,
    dialogo: string,
    resposta: { value: string } | { confirmed: boolean } | { cancelled: true },
  ): void {
    this.viva(execucao, "nada a responder").responder(dialogo, resposta);
  }

  /**
   * Manda `abort` ao pi. Antes cancela os diálogos pendentes: o `editor` não tem tempo limite nem cancelamento do lado
   * do pi, e o agente preso nele nunca veria o `abort` (F4 §5.4).
   */
  abortar(execucao: number | string): void {
    const v = this.viva(execucao, "nada a abortar");
    for (const id of v.pendentes.keys()) v.responder(id, { cancelled: true });
    v.abortada = true;
    v.mandar({ type: "abort" });
  }

  /** Um comando de conversa ao pi vivo: `prompt` acorda a sessão ociosa; `steer` e `follow_up` entram no passo atual. */
  mandar(execucao: number | string, comando: { type: "prompt" | "steer" | "follow_up"; message: string }): void {
    this.viva(execucao, "retome a sessão").mandar(comando);
  }

  /** Para o pi do processo e o dá por bem terminado, como na ociosidade (F4 §6.6). */
  encerrar(execucao: number | string): void {
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
   * F4 §7: toda execução aberta é de uma instância anterior. Mata o grupo do harness de cada uma, pelo Ambiente que a
   * lançou (o host local ou um container do conjunto). Encerrar as execuções e decidir o que isso significa para quem as
   * pediu fica com quem chama. O container do processo morto é limpo e devolvido pelo `reconciliarNaSubida` do conjunto.
   */
  matarProcessosDaInstanciaAnterior(banco: DatabaseSync): void {
    const doServico = ambienteDoServico();
    const processos = execucoesAbertas(banco).flatMap(({ ambiente_id, grupo_processo }) =>
      grupo_processo === null ? [] : [{ ambiente_id, grupo_processo }],
    );
    // ponytail: o sinal não é esperado; com container o `reconciliarNaSubida` limpa o que sobrar antes de o serviço seguir.
    for (const processo of processos) {
      const ambiente =
        processo.ambiente_id === doServico.id ? doServico : conjuntoDoServico()?.ambientePorId(processo.ambiente_id);
      if (ambiente) sinalizarSemEsperar(ambiente, processo, "SIGKILL");
    }
  }

  /** A conversa guardada da sessão: as entradas do arquivo que o harness grava, ou nenhuma antes de ele existir. */
  lerConversa(raiz: string, sessao: string): unknown[] {
    return lerConversaDoArquivo(this.harness.arquivoDaSessao(raiz, sessao));
  }

  /** As perguntas da `perguntar` que o Auditor respondeu na sessão; sessão sem conversa não tem perguntas. */
  perguntasRespondidasNaSessao(raiz: string, sessao: string): { pergunta: string; resposta: string }[] {
    return perguntasRespondidasNaConversa(this.lerConversa(raiz, sessao));
  }

  /**
   * A consulta ao modelo (F4 §6.5): uma chamada única, sem ferramentas, no ambiente sem credenciais dos outros
   * modos. Devolve a resposta e o Uso dela, ou `undefined` se o pi falhou ou passou de `limiteMs`.
   */
  consultar(prompt: string, modelo: Modelo | undefined, limiteMs: number): Promise<RespostaDaConsulta | undefined> {
    return this.harness.perguntar(prompt, modelo, limiteMs);
  }

  /**
   * Lança o pi, envia o prompt e conduz o protocolo RPC até o fim, parando o grupo do pi em qualquer desfecho.
   * Autônoma: termina no `agent_settled`, com falha se a última mensagem do assistente parou com erro ou aborto.
   * Interativa: o `agent_settled` só a deixa ociosa; ela termina bem quando a ociosidade passa ou alguém a encerra.
   * Ambas falham como infraestrutura (`tempo_limite` e `modelo_sem_resposta`) se o modelo fica calado.
   * A autônoma falha se o pi recusa um comando; a interativa só anota a recusa. Ambas falham se o pi sai sozinho.
   * Resolve com a falha técnica, ou `undefined`.
   *
   * ponytail: um diálogo que o próprio pi resolve por `signal` não emite evento; ele fica pendente (e, na autônoma, o
   * relógio parado) até o Auditor respondê-lo ou cancelá-lo, ou até o pi terminar. Se a extensão que faz isso existir,
   * dar o diálogo por resolvido no `turn_start` seguinte.
   */
  lancarExecucao(r: PedidoDeProcesso, relogio: Relogio = relogioDoSistema): Promise<FalhaDaExecucao | undefined> {
    return new Promise((resolve) => {
      const agoraEmMs = () => Date.parse(relogio.agora());
      const { id, sessao } = r.execucao;
      const variaveisDoServico = this.variaveisDoServico(r);
      const autonoma = r.execucao.modo === "autonomo";
      const pendentes = new Map<string, Dialogo>();
      const expiracoes = new Map<string, NodeJS.Timeout>();
      /** Os args das chamadas da `perguntar` em execução, por `toolCallId`: o select dela é a pergunta ao Auditor. */
      const perguntas = new Map<string, Readonly<Record<string, unknown>>>();
      let ultima: MensagemDoAgente = {};
      let restante = r.limiteMin * 60_000;
      let desde = 0;
      let temporizadorDoLimite: NodeJS.Timeout | undefined;
      /** As ferramentas em execução, por `toolCallId`: enquanto alguma roda, o silêncio do pi não é do modelo. */
      const ferramentasRodando = new Set<string>();
      let vigiaDoModelo: NodeJS.Timeout | undefined;
      let feito = false;
      this.sessoesEmCurso.add(sessao);
      const fim = (falha?: FalhaDaExecucao) => {
        if (feito) return;
        feito = true;
        clearTimeout(temporizadorDoLimite);
        clearTimeout(vigiaDoModelo);
        for (const t of expiracoes.values()) clearTimeout(t);
        this.vivas.delete(id);
        void pi.parar().then(() => {
          this.sessoesEmCurso.delete(sessao);
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
          const falha: FalhaDaExecucao = {
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
        this.avisar(sessao, r.log);
      };
      const ocupar = (ocupado: boolean) => {
        estaViva.ocupado = ocupado;
        estaViva.desde = relogio.agora();
      };

      const aoRecusar = (evento: Extract<EventoDoAgente, { type: "response" }>) => {
        const recusa = `o pi recusou o comando ${evento.command}: ${String(evento.error)}`;
        if (autonoma) {
          fim({ tipo: "falha_do_agente", motivo: recusa });
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
        args: Readonly<Record<string, unknown>>,
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
        this.repassar(sessao, { type: "resposta_automatica", ...registro }, r.log);
        estaViva.responder(dialogo, {
          value: args.multiSelect ? JSON.stringify([decisao.resposta]) : decisao.resposta,
        });
      };
      const aoDialogo = (evento: PedidoDeExtensao) => {
        const dialogo = evento.id;
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
      const pi = this.lancarSemPrenderASessao(sessao, () =>
        this.harness.lancar(ambienteDoPi, r.lancamento, { cwd: r.cwd, log: r.log, variaveisDoServico }, (evento) => {
          if (agenteTerminou) estaViva.naoGravadas = [];
          agenteTerminou = false;
          this.repassar(sessao, evento, r.log);
          estaViva.atividade = atividadeDo(evento) ?? estaViva.atividade;
          switch (evento.type) {
            case "message_start":
              estaViva.eventosDaMensagemEmEscrita = [evento];
              break;
            case "message_update":
              estaViva.eventosDaMensagemEmEscrita.push(evento);
              break;
            case "response":
              if (!evento.success) aoRecusar(evento);
              break;
            case "message_end": {
              estaViva.eventosDaMensagemEmEscrita = [];
              estaViva.naoGravadas.push(evento);
              // `message` ausente não derruba o ouvinte: vale como mensagem sem papel.
              const mensagem = evento.message ?? {};
              if (mensagem.role === "assistant") {
                ultima = mensagem;
                agenteTerminou = true;
              }
              break;
            }
            case "tool_execution_start":
              ferramentasRodando.add(evento.toolCallId);
              if (evento.toolName === "perguntar") perguntas.set(evento.toolCallId, evento.args);
              break;
            case "tool_execution_end":
              ferramentasRodando.delete(evento.toolCallId);
              perguntas.delete(evento.toolCallId);
              // O CLI `fabriquinha` roda noutro processo e não alcança os ouvintes: o fim da ferramenta avisa o chat.
              this.avisar(sessao, r.log);
              break;
            case "agent_start":
              ocupar(true);
              mudou();
              break;
            case "extension_ui_request":
              if (DIALOGOS.has(evento.method)) aoDialogo(evento);
              break;
            case "agent_settled":
              aoAssentar();
              break;
          }
          rearmarVigiaDoModelo();
        }),
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
        // Sem código, o pi do Ambiente cujos processos morrem com o serviço morreu por sinal: o cgroup do serviço ou um kill
        // externo, que a Fabriquinha trata como reinício. Nos outros o reinício é decidido na subida do serviço.
        fim(
          codigo === null && ambienteDoPi.processosMorremComOServico
            ? { tipo: "servico_reiniciado" }
            : {
                tipo: "falha_do_agente",
                motivo: `o pi saiu antes de terminar a execução (código ${String(codigo)}); veja o log em ${r.log}`,
              },
        );
      });
      const estaViva: Viva = {
        execucao: id,
        sessao,
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
