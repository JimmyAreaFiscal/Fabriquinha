// A conversa do pi fora do agregado, sem ticket nem execução, que a avaliação do SDLC (avaliacao.ts) monta numa pasta
// sob a raiz: sobe e retoma o pi na mesma sessão pelo `CondutorDeTrabalhos` e recusa a mensagem com o agente
// trabalhando. Nasceu com a Auditoria do Histórico, que a avaliação substituiu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ErroDeRegra } from "../nucleo/erros.ts";
import type { Modelo } from "../nucleo/configuracao_agente.ts";
import { anotar, noLog } from "../infra/registro.ts";
import { condutor } from "./trabalho/condutor.ts";
import { HarnessPi } from "../infra/agente/harness_pi.ts";

export interface OpcoesDaAuditoria {
  /** Minutos sem mensagem até o pi parar (F4 §3, §6.6); a próxima mensagem o retoma na mesma sessão. */
  ociosidadeMin: number;
  /** O modelo da Auditoria na Configuração; sem ele, o pi usa o padrão dele. */
  modelo?: Modelo | null;
}

type EstadoDaAuditoria = "rodando" | "conversa";

/** O que muda na condução do pi: a pasta sob a raiz, as extensões a mais e o que sincronizar com o banco. */
export interface Conducao {
  pasta: string;
  extensoes: string[];
  /** Guarda o grupo de processos do pi enquanto ele vive e `null` quando para, para o reinício do serviço matá-lo. */
  gravarGrupo: (grupo: number | null) => void;
  /** Chamado a cada `agent_end` e quando o pi para; erro dele vai para o log. */
  sincronizar: () => void;
}

/** O agente trabalha (ou o pi sobe ou para); parado, espera a próxima pergunta do Auditor. */
export const estadoDaAuditoria = (sessao: string): EstadoDaAuditoria =>
  (condutor.situacao(sessao)?.ocupado ?? condutor.emCurso(sessao)) ? "rodando" : "conversa";

/**
 * Lança o pi da auditoria na pasta dela, em modo consulta (ociosidade), com `prompt` como mensagem. Resolve com o
 * motivo da falha, ou `undefined`, quando o pi para. O grupo do pi fica gravado (`gravarGrupo`) enquanto ele vive,
 * para o condutor matá-lo na subida do serviço.
 */
export function subir(
  raiz: string,
  sessao: string,
  prompt: string,
  { ociosidadeMin, modelo }: OpcoesDaAuditoria,
  { pasta, extensoes, gravarGrupo, sincronizar }: Conducao,
): Promise<string | undefined> {
  const dir = join(raiz, pasta, sessao);
  const log = join(dir, "log");
  const harness = new HarnessPi();
  const args = harness.argumentos({ raiz, sessaoPi: sessao, modelo, extensoes });
  anotar(log, `pi ${args.join(" ")}`);
  const sincronizarNoLog = (): void => {
    try {
      sincronizar();
    } catch (error_) {
      anotar(log, `sincronização falhou: ${String(error_)}`);
    }
  };
  const desassinar = condutor.assinar(sessao, (evento) => {
    if (evento.type === "agent_end") sincronizarNoLog();
  });
  const tarefa = condutor
    .iniciar({
      execucao: { id: sessao, sessaoPi: sessao, modo: "consulta" },
      args,
      cwd: dir,
      env: harness.ambiente(raiz, dir),
      log,
      prompt,
      limiteMin: ociosidadeMin,
      aoLancar: gravarGrupo,
    })
    .then((falha) => {
      gravarGrupo(null);
      anotar(
        log,
        falha === undefined ? "o pi da auditoria parou" : `o pi da auditoria parou com falha: ${falha.motivo}`,
      );
      return falha?.motivo;
    })
    .finally(() => {
      desassinar();
      sincronizarNoLog();
      condutor.avisar(sessao, log);
    });
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
  const viva = condutor.situacao(sessao);
  if (viva?.ocupado) {
    throw new ErroDeRegra("o agente da auditoria está trabalhando", "espere a resposta, ou use Abortar");
  }
  if (viva) condutor.mandar(sessao, { type: "prompt", message: mensagem });
  else if (condutor.emCurso(sessao)) {
    throw new ErroDeRegra("o agente da auditoria ainda está parando", "tente de novo em alguns segundos");
  } else retomar(mensagem);
}
