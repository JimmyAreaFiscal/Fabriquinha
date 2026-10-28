// Gerente de sessões (F4 §2, §6): o único que lança o pi. Roda o pi com o mesmo código de processo e protocolo nos
// modos autônomo e interativo, guarda as execuções vivas com os diálogos de extensão pendentes (F4 §5.4) e repassa os
// eventos a quem assina a sessão.
import type { ModoExecucao } from "../dominio/agregado.ts";
import { ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { type EventoPi, lancarPi } from "./pi.ts";

/** Diálogos que esperam resposta; `notify` e afins não esperam, e `custom` nunca chega no modo RPC (P1 §2.1). */
const DIALOGOS = new Set(["select", "confirm", "input", "editor"]);

/** O `erro` do C6 da execução autônoma que o Auditor abortou: o Histórico a mostra como abortada (F7 §4.4). */
const ABORTADA = "abortada pelo Auditor";

/** Um diálogo de extensão pendente: o pedido do pi, quando chegou e, se o pi o resolve sozinho, quando expira. */
export type Dialogo = EventoPi & { em: string; expiraEm?: string };

/** O que o estado da sessão (F4 §5.2) lê de uma execução viva. */
export interface Situacao {
  /** O id da execução; a auditoria (fora do agregado) usa o id da sessão. */
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
  emAndamento: EventoPi[];
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

const vivas = new Map<Id | string, Viva>();
const ouvintes = new Map<string, Set<(evento: EventoPi) => void>>();

const vivaDaSessao = (sessao: string): Viva | undefined => [...vivas.values()].find((v) => v.sessaoPi === sessao);

/**
 * Recebe cada evento do pi das execuções da sessão e `{ type: "estado" }` quando o estado dela pode ter mudado.
 * Quem assina recebe antes o que o retrato do JSONL pode ainda não ter: as mensagens terminadas ainda sem gravação
 * garantida e os eventos da mensagem em andamento até ali.
 */
export function assinar(sessao: string, ouvinte: (evento: EventoPi) => void): () => void {
  const lista = ouvintes.get(sessao) ?? new Set();
  ouvintes.set(sessao, lista.add(ouvinte));
  const viva = vivaDaSessao(sessao);
  for (const evento of [...(viva?.naoGravadas ?? []), ...(viva?.emAndamento ?? [])]) ouvinte(evento);
  return () => {
    lista.delete(ouvinte);
    if (lista.size === 0) ouvintes.delete(sessao);
  };
}

/** Entrega o evento a cada ouvinte da sessão; o erro de um ouvinte vai para o `log` e não para a execução. */
function repassar(sessao: string, evento: EventoPi, log: string): void {
  for (const ouvinte of ouvintes.get(sessao) ?? []) {
    try {
      ouvinte(evento);
    } catch (error_) {
      anotar(log, `um ouvinte da sessão falhou com o evento ${String(evento.type)}: ${mensagem(error_)}`);
    }
  }
}

/** Avisa quem assina a sessão que o estado dela pode ter mudado (F7, eventos do chat); `log` é o da execução. */
export const avisar = (sessao: string, log: string): void => {
  repassar(sessao, { type: "estado" }, log);
};

/** A execução viva da sessão neste serviço, se há uma. */
export function situacao(sessao: string): Situacao | undefined {
  const viva = vivaDaSessao(sessao);
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

/** Uma linha de até 100 caracteres. */
const linha = (texto: string): string => (texto.length > 100 ? `${texto.slice(0, 99)}…` : texto);

/**
 * O que o agente está fazendo, se o evento o diz (F7 §4.4, Início): a ferramenta que começou a rodar, com o comando
 * ou o caminho, ou a primeira linha do texto que ele acabou de escrever. Os demais eventos não mudam a atividade.
 */
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

const viva = (execucao: Id | string, solucao: string): Viva =>
  existe(vivas.get(execucao), `a execução E-${String(execucao)} não tem pi rodando`, solucao);

/** Responde um diálogo pendente (`extension_ui_response` do RPC do pi): `value`, `confirmed` ou `cancelled`. */
export function responderDialogo(
  execucao: Id | string,
  id: string,
  resposta: { value: string } | { confirmed: boolean } | { cancelled: true },
): void {
  viva(execucao, "nada a responder").responder(id, resposta);
}

/**
 * Manda `abort` ao pi. Antes cancela os diálogos pendentes: o `editor` não tem tempo limite nem cancelamento do lado
 * do pi, e o agente preso nele nunca veria o `abort` (F4 §5.4).
 */
export function abortar(execucao: Id | string): void {
  const v = viva(execucao, "nada a abortar");
  for (const id of v.pendentes.keys()) v.responder(id, { cancelled: true });
  v.abortada = true;
  v.mandar({ type: "abort" });
}

/** Um comando de conversa ao pi vivo: `prompt` acorda a sessão ociosa; `steer` e `follow_up` entram no passo atual. */
export function mandar(
  execucao: Id | string,
  comando: { type: "prompt" | "steer" | "follow_up"; message: string },
): void {
  viva(execucao, "retome a sessão").mandar(comando);
}

/** Para o pi da execução e a dá por bem terminada, como na ociosidade (F4 §6.6). */
export function encerrar(execucao: Id | string): void {
  viva(execucao, "nada a encerrar").encerrar();
}

export interface Processo {
  /** A execução de um ticket, ou a auditoria (`id` é a sessão), que roda como consulta e fica fora do agregado. */
  execucao: { id: Id | string; sessaoPi: string; modo: ModoExecucao };
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
  prompt: string | undefined;
  limiteMin: number;
  /** Chamado com o grupo de processos do pi logo depois de lançado, para quem precisa matá-lo no reinício (F4 §7). */
  aoLancar(pgid: number): void;
}

/**
 * Lança o pi, envia o prompt e conduz o protocolo RPC até o fim, parando o grupo do pi em qualquer desfecho.
 * Autônoma: termina no `agent_settled`, com falha se a última mensagem do assistente parou com erro ou aborto.
 * Interativa: o `agent_settled` só a deixa ociosa; ela termina bem quando a ociosidade passa ou alguém a encerra.
 * A autônoma falha se o pi recusa um comando; a interativa só anota a recusa. Ambas falham se o pi sai sozinho.
 * Resolve com o motivo da falha, ou `undefined`.
 *
 * ponytail: um diálogo que o próprio pi resolve por `signal` não emite evento; ele fica pendente (e, na autônoma, o
 * relógio parado) até o Auditor respondê-lo ou cancelá-lo, ou até o pi terminar. Se a extensão que faz isso existir,
 * dar o diálogo por resolvido no `turn_start` seguinte.
 */
export function rodarPi(r: Processo): Promise<string | undefined> {
  return new Promise((resolve) => {
    const { id, sessaoPi } = r.execucao;
    const autonoma = r.execucao.modo === "autonomo";
    const pendentes = new Map<string, Dialogo>();
    const expiracoes = new Map<string, NodeJS.Timeout>();
    /** Os args das chamadas da `perguntar` em execução, por `toolCallId`: o select dela é a pergunta ao Auditor. */
    const perguntas = new Map<string, Record<string, unknown>>();
    let ultima: Mensagem = {};
    let restante = r.limiteMin * 60_000;
    let desde = 0;
    let relogio: NodeJS.Timeout | undefined;
    let feito = false;
    const fim = (falha?: string) => {
      if (feito) return;
      feito = true;
      clearTimeout(relogio);
      for (const t of expiracoes.values()) clearTimeout(t);
      vivas.delete(id);
      void pi.parar().then(() => {
        resolve(falha);
      });
    };
    // Autônoma (F4 §6.7): só o tempo ativo conta; o relógio para enquanto algum diálogo espera o Auditor.
    // Interativa (F4 §6.6): a ociosidade conta do zero cada vez que o agente assenta sem diálogo pendente.
    const acertarRelogio = () => {
      // Depois do fim, eventos atrasados do pi não armam relógio novo: ele seguraria o processo à toa.
      if (feito) return;
      if (autonoma) {
        if (pendentes.size > 0 && relogio) {
          clearTimeout(relogio);
          relogio = undefined;
          restante -= Date.now() - desde;
        } else if (pendentes.size === 0 && !relogio) {
          desde = Date.now();
          relogio = setTimeout(() => {
            fim(`tempo limite de ${String(r.limiteMin)} min`);
          }, restante);
        }
        return;
      }
      clearTimeout(relogio);
      relogio = undefined;
      if (!estaViva.ocupado && pendentes.size === 0) {
        relogio = setTimeout(() => {
          anotar(r.log, `sessão ociosa por ${String(r.limiteMin)} min; o pi para`);
          fim();
        }, restante);
      }
    };
    const mudou = () => {
      acertarRelogio();
      avisar(sessaoPi, r.log);
    };
    const ocupar = (ocupado: boolean) => {
      estaViva.ocupado = ocupado;
      estaViva.desde = new Date().toISOString();
    };

    const aoRecusar = (evento: EventoPi) => {
      const recusa = `o pi recusou o comando ${String(evento.command)}: ${String(evento.error)}`;
      if (autonoma) {
        fim(recusa);
        return;
      }
      // Na interativa a recusa já chegou ao chat; um `steer` que cruzou o `agent_settled` não derruba a sessão.
      anotar(r.log, recusa);
      if (evento.command === "prompt") {
        ocupar(false);
        mudou();
      }
    };
    const aoDialogo = (evento: EventoPi) => {
      const dialogo = String(evento.id);
      const em = Date.now();
      // F4 §5.4: o diálogo com tempo limite também espera o Auditor; o pi o resolve sozinho quando expira.
      const timeout = typeof evento.timeout === "number" ? evento.timeout : undefined;
      const pergunta = evento.method === "select" ? daPergunta(evento, perguntas.values()) : undefined;
      pendentes.set(dialogo, {
        ...evento,
        ...pergunta,
        em: new Date(em).toISOString(),
        ...(timeout !== undefined && { expiraEm: new Date(em + timeout).toISOString() }),
      });
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
          ? [`o agente parou com stopReason ${String(ultima.stopReason)}`, ultima.errorMessage]
              .filter(Boolean)
              .join(": ")
          : undefined,
      );
    };

    /** O último evento foi o `message_end` de uma mensagem do agente. */
    let agenteTerminou = false;
    const pi = lancarPi(r.args, r, (evento) => {
      if (agenteTerminou) estaViva.naoGravadas = [];
      agenteTerminou = false;
      repassar(sessaoPi, evento, r.log);
      estaViva.atividade = atividadeDo(evento) ?? estaViva.atividade;
      switch (evento.type) {
        case "message_start":
          estaViva.emAndamento = [evento];
          break;
        case "message_update":
          estaViva.emAndamento.push(evento);
          break;
        case "response":
          if (evento.success === false) aoRecusar(evento);
          break;
        case "message_end": {
          estaViva.emAndamento = [];
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
          if (evento.toolName === "perguntar")
            perguntas.set(String(evento.toolCallId), evento.args as Record<string, unknown>);
          break;
        case "tool_execution_end":
          perguntas.delete(String(evento.toolCallId));
          // O CLI `fabriquinha` roda noutro processo e não alcança os ouvintes: o fim da ferramenta avisa o chat.
          avisar(sessaoPi, r.log);
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
    });
    r.aoLancar(pi.pgid);
    void pi.saiu.then((codigo) => {
      fim(`o pi saiu antes de terminar a execução (código ${String(codigo)}); veja o log em ${r.log}`);
    });
    const estaViva: Viva = {
      execucao: id,
      sessaoPi,
      ocupado: r.prompt !== undefined,
      desde: new Date().toISOString(),
      pendentes,
      emAndamento: [],
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
          ocupar(true);
          mudou();
        }
      },
      encerrar: () => {
        fim();
      },
    };
    vivas.set(id, estaViva);
    if (r.prompt !== undefined) pi.enviar({ type: "prompt", message: r.prompt });
    mudou();
  });
}
