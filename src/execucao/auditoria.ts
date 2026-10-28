// O pi de conversa fora do agregado, sem ticket nem execução, que a avaliação do SDLC (avaliacao.ts) conduz numa pasta
// sob a raiz: sobe e retoma o pi na mesma sessão, recusa a mensagem com o agente trabalhando e, na subida do serviço,
// mata o pi que a instância anterior deixou. Nasceu com a Auditoria do Histórico, que a avaliação substituiu.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Modelo } from "../dominio/primitivos.ts";
import { anotar, noLog } from "../persistencia/execucoes.ts";
import { sinalNoGrupo } from "../processo.ts";
import { assinar as assinarSessao, avisar, mandar, rodarPi, situacao } from "./gerente.ts";
import { ambienteDaAuditoria, argumentosDaAuditoria } from "./pi.ts";

export interface OpcoesDaAuditoria {
  /** Minutos sem mensagem até o pi parar (F4 §3, §6.6); a próxima mensagem o retoma na mesma sessão. */
  ociosidadeMin: number;
  /** O modelo da Auditoria na Configuração; sem ele, o pi usa o padrão dele. */
  modelo?: Modelo | null;
}

export type EstadoDaAuditoria = "rodando" | "conversa";

/** O agente da auditoria vivo ou subindo/parando por sessão: no máximo um pi por sessão. */
const tarefas = new Map<string, Promise<string | undefined>>();

/** O que muda na condução do pi: a pasta sob a raiz, as extensões a mais e o que sincronizar com o banco. */
export interface Conducao {
  pasta: string;
  extensoes: string[];
  /** Chamado a cada `agent_end` e quando o pi para; erro dele vai para o log. */
  sincronizar: () => void;
}

/** O agente trabalha (ou o pi sobe ou para); parado, espera a próxima pergunta do Auditor. */
export const estadoDaAuditoria = (sessao: string): EstadoDaAuditoria =>
  (situacao(sessao)?.ocupado ?? tarefas.has(sessao)) ? "rodando" : "conversa";

/**
 * Lança o pi da auditoria na pasta dela, em modo consulta (ociosidade), com `prompt` como mensagem. Resolve com o
 * motivo da falha, ou `undefined`, quando o pi para. O pgid fica em `<pasta>/pgid` enquanto o pi vive, para o
 * reinício do serviço matá-lo (`recuperarAuditorias`).
 */
export function subir(
  raiz: string,
  sessao: string,
  prompt: string,
  { ociosidadeMin, modelo }: OpcoesDaAuditoria,
  { pasta, extensoes, sincronizar }: Conducao,
): Promise<string | undefined> {
  const dir = join(raiz, pasta, sessao);
  const log = join(dir, "log");
  const pgid = join(dir, "pgid");
  const args = argumentosDaAuditoria(raiz, sessao, modelo, extensoes);
  anotar(log, `pi ${args.join(" ")}`);
  const sincronizarNoLog = (): void => {
    try {
      sincronizar();
    } catch (error_) {
      anotar(log, `sincronização falhou: ${String(error_)}`);
    }
  };
  const desassinar = assinarSessao(sessao, (evento) => {
    if (evento.type === "agent_end") sincronizarNoLog();
  });
  const tarefa = rodarPi({
    execucao: { id: sessao, sessaoPi: sessao, modo: "consulta" },
    args,
    cwd: dir,
    env: ambienteDaAuditoria(raiz, dir),
    log,
    prompt,
    limiteMin: ociosidadeMin,
    aoLancar: (grupo) => {
      writeFileSync(pgid, String(grupo));
    },
  })
    .then((falha) => {
      rmSync(pgid, { force: true });
      anotar(log, falha === undefined ? "o pi da auditoria parou" : `o pi da auditoria parou com falha: ${falha}`);
      return falha;
    })
    .finally(() => {
      desassinar();
      sincronizarNoLog();
      tarefas.delete(sessao);
      avisar(sessao, log);
    });
  tarefas.set(sessao, tarefa);
  tarefa.catch(noLog);
  return tarefa;
}

/** O motivo da falha sem a dica do log, seguido das últimas linhas do `log` do pi (stderr, erro do spawn). */
export function causaDaFalha(dir: string, motivo: string): string {
  const linhas = readFileSync(join(dir, "log"), "utf8")
    .split("\n")
    .filter((l) => l && !/^\S+ (pi |o pi da auditoria parou)/.test(l))
    .slice(-5);
  return [motivo.split("; veja o log")[0], ...linhas].join(": ");
}

/** O envio comum à auditoria e à avaliação; `retomar` sobe um pi novo, com o pi parado, na mesma sessão. */
export function enviarNaConversa(sessao: string, mensagem: string, retomar: (prompt: string) => void): void {
  const viva = situacao(sessao);
  if (viva?.ocupado) {
    throw new ErroDeRegra("o agente da auditoria está trabalhando", "espere a resposta, ou use Abortar");
  }
  if (viva) mandar(sessao, { type: "prompt", message: mensagem });
  else if (tarefas.has(sessao)) {
    throw new ErroDeRegra("o agente da auditoria ainda está parando", "tente de novo em alguns segundos");
  } else retomar(mensagem);
}

/**
 * Na subida do serviço, mata o grupo de cada pi de auditoria que a instância anterior deixou (F4 §7): o `pgid` fica em
 * `auditorias/<sessão>/pgid` enquanto o pi vive.
 */
export function recuperarAuditorias(raiz: string): void {
  for (const pasta of ["auditorias", "avaliacoes"]) {
    const dir = join(raiz, pasta);
    for (const nome of existsSync(dir) ? readdirSync(dir) : []) {
      const pgid = join(dir, nome, "pgid");
      if (!existsSync(pgid)) continue;
      sinalNoGrupo(Number(readFileSync(pgid, "utf8")), "SIGKILL");
      rmSync(pgid);
    }
  }
}
