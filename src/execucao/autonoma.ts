// Execução autônoma de um ticket (F4 §6.2): C5, worktree, pi em modo RPC até `agent_settled`, coleta depois do pi e
// C7; qualquer falha termina em C6 + C8 com o que faltou. Também os diálogos de extensão pendentes (F4 §5.4).
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Ator, Execucao } from "../dominio/agregado.ts";
import { concluirTicket } from "../dominio/conclusao.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { falharTicket, iniciarExecucao, terminarExecucao, ticketDe } from "../dominio/execucao.ts";
import { type Id, Motivo } from "../dominio/primitivos.ts";
import { depoisDoPi } from "../evidencias/coleta.ts";
import { raizDo } from "../persistencia/banco.ts";
import { anotar, dirDaExecucao, gravarPgid } from "../persistencia/execucoes.ts";
import { agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { projeto as lerProjeto } from "../persistencia/projetos.ts";
import { executar } from "../processo.ts";
import { garantirWorktree } from "../repositorio/worktree.ts";
import { ambientePi, argumentosPi, binarioPi, confianca, type EventoPi, lancarPi } from "./pi.ts";
import { montarPrompt } from "./prompt.ts";

const FABRIQUINHA: Ator = { tipo: "fabriquinha" };

/** Diálogos que esperam resposta; `notify` e afins não esperam (F4 §5.4). */
const DIALOGOS = new Set(["select", "confirm", "input", "editor"]);

export interface OpcoesAutonoma {
  /** Raiz do pacote P1 `pi-fabriquinha`. */
  pacote: string;
  /** Tempo limite de tempo ativo (F4 §3, §6.7). */
  timeoutMin: number;
}

/** A parte de uma mensagem do pi que decide o sucesso (F4 §6.2, passo 5). */
interface Mensagem {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
}

/** Execução com o pi vivo: os diálogos que esperam o Auditor e como respondê-los. */
interface Viva {
  pendentes: Map<string, EventoPi>;
  responder(id: string, resposta: object): void;
}

const vivas = new Map<Id, Viva>();

function existe<T>(valor: T | undefined, problema: string, solucao: string): T {
  if (valor === undefined) throw new ErroDeRegra(problema, solucao);
  return valor;
}

/** O texto de qualquer coisa lançada: um `throw` que não é `Error` também vira falha, nunca sucesso. */
const mensagem = (erro: unknown): string => (erro instanceof Error ? erro.message : String(erro));

/**
 * O erro como `Motivo` do F1, cortado em 2.000 caracteres: C6 e C8 nunca recusam a falha, e a execução nunca fica
 * `em_andamento` segurando a vaga do D8.
 */
const motivo = (texto: string): string => Motivo.catch("falha sem mensagem").parse(texto.slice(0, 2000));

/** Os diálogos de extensão da execução que esperam o Auditor; vazio se o pi dela não está vivo. */
export const dialogosPendentes = (execucao: Id): EventoPi[] => [...(vivas.get(execucao)?.pendentes.values() ?? [])];

/** Responde um diálogo pendente (`extension_ui_response` do RPC do pi): `value`, `confirmed` ou `cancelled`. */
export function responderDialogo(
  execucao: Id,
  id: string,
  resposta: { value: string } | { confirmed: boolean } | { cancelled: true },
): void {
  existe(vivas.get(execucao), `a execução E-${String(execucao)} não tem pi rodando`, "nada a responder").responder(
    id,
    resposta,
  );
}

interface Rodada {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
  prompt: string;
  timeoutMin: number;
  execucao: Id;
  banco: DatabaseSync;
}

/**
 * Lança o pi, envia o prompt e espera `agent_settled`; para o grupo do pi em qualquer desfecho. Resolve com o motivo
 * da falha, ou `undefined` se a última mensagem do assistente não parou com erro nem aborto.
 */
function rodarPi(r: Rodada): Promise<string | undefined> {
  return new Promise((resolve) => {
    const pendentes = new Map<string, EventoPi>();
    let ultima: Mensagem = {};
    let restante = r.timeoutMin * 60_000;
    let desde = 0;
    let relogio: NodeJS.Timeout | undefined;
    let feito = false;
    const fim = (falha?: string) => {
      if (feito) return;
      feito = true;
      clearTimeout(relogio);
      vivas.delete(r.execucao);
      void pi.parar().then(() => {
        resolve(falha);
      });
    };
    // F4 §6.7: só o tempo ativo conta; o relógio para enquanto algum diálogo espera o Auditor.
    const andar = () => {
      desde = Date.now();
      relogio = setTimeout(() => {
        fim(`tempo limite de ${String(r.timeoutMin)} min`);
      }, restante);
    };
    const pausar = () => {
      clearTimeout(relogio);
      restante -= Date.now() - desde;
    };

    const pi = lancarPi(r.args, r, (evento) => {
      switch (evento.type) {
        case "response":
          if (evento.success === false)
            fim(`o pi recusou o comando ${String(evento.command)}: ${String(evento.error)}`);
          break;
        case "message_end": {
          // `message` ausente ou nulo não derruba o ouvinte: vale como mensagem sem papel.
          const mensagem = (evento.message ?? {}) as Mensagem;
          if (mensagem.role === "assistant") ultima = mensagem;
          break;
        }
        case "extension_ui_request":
          // ponytail: diálogo com `timeout` o próprio pi resolve sozinho, então conta como tempo ativo e não fica
          // pendente aqui; o web só mostra os que esperam o Auditor sem prazo.
          if (DIALOGOS.has(String(evento.method)) && evento.timeout === undefined) {
            if (pendentes.size === 0) pausar();
            pendentes.set(String(evento.id), evento);
          }
          break;
        case "agent_settled":
          fim(
            ["error", "aborted"].includes(String(ultima.stopReason))
              ? [`o agente parou com stopReason ${String(ultima.stopReason)}`, ultima.errorMessage]
                  .filter(Boolean)
                  .join(": ")
              : undefined,
          );
          break;
      }
    });
    gravarPgid(r.banco, r.execucao, pi.pgid);
    void pi.saiu.then((codigo) => {
      fim(`o pi saiu antes de terminar a execução (código ${String(codigo)}); veja o log em ${r.log}`);
    });
    vivas.set(r.execucao, {
      pendentes,
      responder(id, resposta) {
        if (!pendentes.delete(id)) {
          throw new ErroDeRegra(`o diálogo ${id} não está pendente na E-${String(r.execucao)}`, "atualize o chat");
        }
        pi.enviar({ type: "extension_ui_response", id, ...resposta });
        if (pendentes.size === 0) andar();
      },
    });
    pi.enviar({ type: "prompt", message: r.prompt });
    andar();
  });
}

/**
 * F4 §6.2: executa o ticket autônomo do início ao fim. Erro de C5 (ticket não elegível, vaga do D8 ocupada) sobe
 * sem lançar nada; dali em diante, toda falha vira C6 + C8, e a promessa só rejeita se o próprio banco falhar.
 */
export async function executarAutonomo(banco: DatabaseSync, ticket: Id, opcoes: OpcoesAutonoma): Promise<void> {
  const issue = existe(
    agregadoDoTicket(banco, ticket),
    `o ticket T-${String(ticket)} não existe`,
    "confira o número do ticket",
  ).issue.id;
  let instrucao: string | undefined;
  const ag = comIssue(banco, issue, "iniciarExecucao", FABRIQUINHA, (antes, ctx) => {
    // C5 consome a instrução; o prompt a leva primeiro (F4 §6.4).
    instrucao = ticketDe(antes, ticket).instrucao;
    // F4 §5.1: as execuções do ticket continuam a mesma sessão principal; a primeira a cria.
    const principal = antes.execucoes.find((e) => e.ticket === ticket && e.modo !== "consulta");
    return iniciarExecucao(
      antes,
      { ticket, modo: "autonomo", sessaoPi: principal?.sessaoPi ?? randomUUID() },
      FABRIQUINHA,
      ctx,
    );
  });
  const execucao: Execucao = existe(
    ag.execucoes.find((e) => e.ticket === ticket && e.resultado === "em_andamento"),
    `C5 não deixou T-${String(ticket)} em andamento`,
    "confira o banco",
  );
  const t = ticketDe(ag, ticket);
  const raiz = raizDo(banco);
  const dir = dirDaExecucao(raiz, execucao.id);
  const log = join(dir, "log");
  const falhar = (erro: string) => {
    comIssue(banco, issue, "falharTicket", FABRIQUINHA, (a) =>
      falharTicket(a, { ticket, erro: motivo(erro) }, FABRIQUINHA),
    );
    anotar(log, `T-${String(ticket)} falhou: ${erro}`);
  };

  let worktree = "";
  let falha: string | undefined;
  try {
    // `gh` e `az` olham diretórios vazios: o agente não acha credencial de hospedagem (F4 §6.1.2).
    for (const sub of ["saida", "vazio"]) mkdirSync(join(dir, sub), { recursive: true });
    anotar(
      log,
      `E-${String(execucao.id)} iniciada: T-${String(ticket)}, etapa ${t.etapa}, sessão ${execucao.sessaoPi}`,
    );
    const projeto = existe(lerProjeto(banco, ag.issue.projeto), `o projeto ${ag.issue.projeto} sumiu`, "cadastre-o");
    worktree = await garantirWorktree(raiz, projeto, ag.issue, log);
    // ponytail: antesDoPi (F3 §7) entra aqui com a revisão (ticket 16); registro e desenho não coletam antes do pi.
    const prompt = montarPrompt({
      ag,
      ticket: t,
      instrucao,
      projeto,
      worktree,
      saida: join(dir, "saida"),
      modo: "autonomo",
    });
    writeFileSync(join(dir, "prompt.md"), prompt);
    // O `pi --version` conta no tempo limite da execução: um pi travado não prende a vaga do D8.
    const versao = await executar(binarioPi(), ["--version"], { limiteMs: opcoes.timeoutMin * 60_000 });
    anotar(log, `pi --version: ${(versao.saida + versao.erro).trim()}`);
    if (versao.limiteEstourado) throw new Error(`tempo limite de ${String(opcoes.timeoutMin)} min em pi --version`);
    const args = argumentosPi({
      raiz,
      sessaoPi: execucao.sessaoPi,
      etapa: t.etapa,
      modelo: execucao.modelo,
      pacote: opcoes.pacote,
      confianca: confianca(projeto.repo),
    });
    anotar(log, `pi ${args.join(" ")}`);
    falha = await rodarPi({
      args,
      cwd: worktree,
      env: ambientePi(raiz, execucao.id, dir),
      log,
      prompt,
      timeoutMin: opcoes.timeoutMin,
      execucao: execucao.id,
      banco,
    });
  } catch (error_) {
    falha = mensagem(error_);
  }

  // ponytail: coletarUso (F6 §3.3) entra depois de cada C6 com o ticket 17.
  if (falha !== undefined) {
    comIssue(banco, issue, "terminarExecucao", FABRIQUINHA, (a, ctx) =>
      terminarExecucao(a, { execucao: execucao.id, resultado: "falha", erro: motivo(falha) }, FABRIQUINHA, ctx),
    );
    falhar(falha);
    return;
  }
  comIssue(banco, issue, "terminarExecucao", FABRIQUINHA, (a, ctx) =>
    terminarExecucao(a, { execucao: execucao.id, resultado: "sucesso" }, FABRIQUINHA, ctx),
  );
  anotar(log, "pi terminou bem; coleta depois do pi");
  try {
    await depoisDoPi(banco, t, worktree, log);
    comIssue(banco, issue, "concluirTicket", FABRIQUINHA, (a, ctx) => concluirTicket(a, { ticket }, FABRIQUINHA, ctx));
    anotar(log, `T-${String(ticket)} concluído`);
  } catch (error_) {
    falhar(mensagem(error_));
  }
}
