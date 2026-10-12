// Gerente de sessões (F4 §2, §6): o único que lança o pi. Roda uma execução da worktree ao fim do processo com o
// mesmo código de processo e protocolo nos modos autônomo e interativo, guarda as execuções vivas com os diálogos de
// extensão pendentes (F4 §5.4) e repassa os eventos a quem assina a sessão.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Agregado, type Execucao, FABRIQUINHA, type ModoExecucao } from "../dominio/agregado.ts";
import { ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import { iniciarExecucao, ticketDe } from "../dominio/execucao.ts";
import type { Id } from "../dominio/primitivos.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { raizDo } from "../persistencia/banco.ts";
import { anotar, dirDaExecucao, gravarPgid } from "../persistencia/execucoes.ts";
import { comIssue } from "../persistencia/issues.ts";
import { projeto as lerProjeto } from "../persistencia/projetos.ts";
import { executar } from "../processo.ts";
import { garantirWorktree } from "../repositorio/worktree.ts";
import { ambientePi, argumentosPi, binarioPi, confianca, type EventoPi, lancarPi } from "./pi.ts";

/** Diálogos que esperam resposta; `notify` e afins não esperam, e `custom` nunca chega no modo RPC (P1 §2.1). */
const DIALOGOS = new Set(["select", "confirm", "input", "editor"]);

/** Um diálogo de extensão pendente: o pedido do pi, quando chegou e, se o pi o resolve sozinho, quando expira. */
export type Dialogo = EventoPi & { em: string; expiraEm?: string };

/** O que o estado da sessão (F4 §5.2) lê de uma execução viva. */
export interface Situacao {
  execucao: Id;
  /** O agente está trabalhando; falso quando uma sessão interativa espera a próxima mensagem. */
  ocupado: boolean;
  /** Desde quando está ocupada ou ociosa. */
  desde: string;
  dialogos: Dialogo[];
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
  responder(id: string, resposta: object): void;
  mandar(comando: { type: string; message?: string }): void;
  encerrar(): void;
}

const vivas = new Map<Id, Viva>();
const ouvintes = new Map<string, Set<(evento: EventoPi) => void>>();

/** Execuções cujo pi já recebeu a ordem de parar e ainda não saiu: o C6 delas vem logo depois. */
const encerrando = new Set<Id>();

/** Recebe cada evento do pi das execuções da sessão e `{ type: "estado" }` quando o estado dela pode ter mudado. */
export function assinar(sessao: string, ouvinte: (evento: EventoPi) => void): () => void {
  const lista = ouvintes.get(sessao) ?? new Set();
  ouvintes.set(sessao, lista.add(ouvinte));
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

/** O pi da execução está parando; o C6 dela vem logo depois que ele sai. */
export const estaEncerrando = (execucao: Id): boolean => encerrando.has(execucao);

/** A execução viva da sessão neste serviço, se há uma. */
export function situacao(sessao: string): Situacao | undefined {
  const viva = [...vivas.values()].find((v) => v.sessaoPi === sessao);
  return (
    viva && {
      execucao: viva.execucao,
      ocupado: viva.ocupado,
      desde: viva.desde,
      dialogos: [...viva.pendentes.values()],
    }
  );
}

const viva = (execucao: Id, solucao: string): Viva =>
  existe(vivas.get(execucao), `a execução E-${String(execucao)} não tem pi rodando`, solucao);

/** Os diálogos de extensão da execução que esperam o Auditor; vazio se o pi dela não está vivo. */
export const dialogosPendentes = (execucao: Id): Dialogo[] => [...(vivas.get(execucao)?.pendentes.values() ?? [])];

/** Responde um diálogo pendente (`extension_ui_response` do RPC do pi): `value`, `confirmed` ou `cancelled`. */
export function responderDialogo(
  execucao: Id,
  id: string,
  resposta: { value: string } | { confirmed: boolean } | { cancelled: true },
): void {
  viva(execucao, "nada a responder").responder(id, resposta);
}

/**
 * Manda `abort` ao pi. Antes cancela os diálogos pendentes: o `editor` não tem tempo limite nem cancelamento do lado
 * do pi, e o agente preso nele nunca veria o `abort` (F4 §5.4).
 */
export function abortar(execucao: Id): void {
  const v = viva(execucao, "nada a abortar");
  for (const id of v.pendentes.keys()) v.responder(id, { cancelled: true });
  v.mandar({ type: "abort" });
}

/** Um comando de conversa ao pi vivo: `prompt` acorda a sessão ociosa; `steer` e `follow_up` entram no passo atual. */
export function mandar(execucao: Id, comando: { type: "prompt" | "steer" | "follow_up"; message: string }): void {
  viva(execucao, "retome a sessão").mandar(comando);
}

/** Para o pi da execução e a dá por bem terminada, como na ociosidade (F4 §6.6). */
export function encerrar(execucao: Id): void {
  viva(execucao, "nada a encerrar").encerrar();
}

/**
 * C5 na sessão principal do ticket (F4 §5.1: as execuções do ticket continuam a mesma conversa; a primeira a cria).
 * Devolve o agregado, a execução em andamento e a instrução do Auditor que C5 consumiu (F4 §6.4).
 */
export function iniciarNaSessaoPrincipal(
  banco: DatabaseSync,
  issue: Id,
  ticket: Id,
  modo: Exclude<ModoExecucao, "consulta">,
): { ag: Agregado; execucao: Execucao; instrucao: string | undefined } {
  let instrucao: string | undefined;
  const ag = comIssue(banco, issue, "iniciarExecucao", FABRIQUINHA, (antes, ctx) => {
    instrucao = ticketDe(antes, ticket).instrucao;
    const principal = antes.execucoes.find((e) => e.ticket === ticket && e.modo !== "consulta");
    return iniciarExecucao(antes, { ticket, modo, sessaoPi: principal?.sessaoPi ?? randomUUID() }, FABRIQUINHA, ctx);
  });
  const execucao = existe(
    ag.execucoes.find((e) => e.ticket === ticket && e.resultado === "em_andamento"),
    `C5 não deixou T-${String(ticket)} em andamento`,
    "confira o banco",
  );
  return { ag, execucao, instrucao };
}

export interface Rodada {
  banco: DatabaseSync;
  /** O agregado logo depois de C5. */
  ag: Agregado;
  execucao: Execucao;
  /** Raiz do pacote P1 `pi-fabriquinha`. */
  pacote: string;
  /**
   * Autônoma: tempo limite de tempo ativo (F4 §6.7), que vale também para o `pi --version`.
   * Interativa: a ociosidade depois da qual o processo para (F4 §6.6).
   */
  limiteMin: number;
  /** O primeiro prompt da execução, montado com a worktree pronta (F4 §6.3), depois da coleta antes do pi (F3 §7). */
  prompt(c: { projeto: Projeto; worktree: string; saida: string }): string | Promise<string>;
}

/**
 * Do diretório da execução ao fim do pi: worktree (F5), `prompt.md`, `pi --version` e o pi em modo RPC, até
 * assentar (autônoma) ou ficar ocioso (interativa). Não grava C6: devolve a worktree e, se falhou, o motivo.
 */
export async function rodarExecucao(r: Rodada): Promise<{ worktree: string; falha?: string }> {
  const raiz = raizDo(r.banco);
  const { execucao } = r;
  const dir = dirDaExecucao(raiz, execucao.id);
  const log = join(dir, "log");
  const ticket = ticketDe(r.ag, execucao.ticket);
  let worktree = "";
  try {
    // `gh` e `az` olham diretórios vazios: o agente não acha credencial de hospedagem (F4 §6.1.2).
    for (const sub of ["saida", "vazio"]) mkdirSync(join(dir, sub), { recursive: true });
    anotar(
      log,
      `E-${String(execucao.id)} iniciada: T-${String(ticket.id)}, etapa ${ticket.etapa}, modo ${execucao.modo}, ` +
        `sessão ${execucao.sessaoPi}`,
    );
    avisar(execucao.sessaoPi, log);
    const projeto = existe(
      lerProjeto(r.banco, r.ag.issue.projeto),
      `o projeto ${r.ag.issue.projeto} sumiu`,
      "cadastre-o",
    );
    worktree = await garantirWorktree(raiz, projeto, r.ag.issue, log);
    const prompt = await r.prompt({ projeto, worktree, saida: join(dir, "saida") });
    writeFileSync(join(dir, "prompt.md"), prompt);
    // O `pi --version` conta no limite: um pi travado não prende a vaga do D8 nem a sessão.
    const versao = await executar(binarioPi(), ["--version"], { limiteMs: r.limiteMin * 60_000 });
    anotar(log, `pi --version: ${(versao.saida + versao.erro).trim()}`);
    if (versao.limiteEstourado) throw new Error(`tempo limite de ${String(r.limiteMin)} min em pi --version`);
    const args = argumentosPi({
      raiz,
      sessaoPi: execucao.sessaoPi,
      etapa: ticket.etapa,
      modelo: execucao.modelo,
      pacote: r.pacote,
      confianca: confianca(projeto.repo),
    });
    anotar(log, `pi ${args.join(" ")}`);
    const falha = await rodarPi({
      banco: r.banco,
      execucao,
      args,
      cwd: worktree,
      env: ambientePi(raiz, execucao.id, dir),
      log,
      prompt,
      limiteMin: r.limiteMin,
    });
    return { worktree, ...(falha !== undefined && { falha }) };
  } catch (error_) {
    return { worktree, falha: mensagem(error_) };
  }
}

interface Processo {
  banco: DatabaseSync;
  execucao: Execucao;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
  prompt: string;
  limiteMin: number;
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
function rodarPi(r: Processo): Promise<string | undefined> {
  return new Promise((resolve) => {
    const { id, sessaoPi } = r.execucao;
    const autonoma = r.execucao.modo === "autonomo";
    const pendentes = new Map<string, Dialogo>();
    const expiracoes = new Map<string, NodeJS.Timeout>();
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
      encerrando.add(id);
      void pi.parar().then(() => {
        encerrando.delete(id);
        resolve(falha);
      });
    };
    // Autônoma (F4 §6.7): só o tempo ativo conta; o relógio para enquanto algum diálogo espera o Auditor.
    // Interativa (F4 §6.6): a ociosidade conta do zero cada vez que o agente assenta sem diálogo pendente.
    const acertarRelogio = () => {
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
      pendentes.set(dialogo, {
        ...evento,
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
      const parou = ["error", "aborted"].includes(String(ultima.stopReason));
      fim(
        parou
          ? [`o agente parou com stopReason ${String(ultima.stopReason)}`, ultima.errorMessage]
              .filter(Boolean)
              .join(": ")
          : undefined,
      );
    };

    const pi = lancarPi(r.args, r, (evento) => {
      repassar(sessaoPi, evento, r.log);
      switch (evento.type) {
        case "response":
          if (evento.success === false) aoRecusar(evento);
          break;
        case "message_end": {
          // `message` ausente ou nulo não derruba o ouvinte: vale como mensagem sem papel.
          const mensagem = (evento.message ?? {}) as Mensagem;
          if (mensagem.role === "assistant") ultima = mensagem;
          break;
        }
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
    gravarPgid(r.banco, id, pi.pgid);
    void pi.saiu.then((codigo) => {
      fim(`o pi saiu antes de terminar a execução (código ${String(codigo)}); veja o log em ${r.log}`);
    });
    const estaViva: Viva = {
      execucao: id,
      sessaoPi,
      ocupado: true,
      desde: new Date().toISOString(),
      pendentes,
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
    pi.enviar({ type: "prompt", message: r.prompt });
    mudou();
  });
}
