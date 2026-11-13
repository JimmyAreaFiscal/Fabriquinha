// A marca que a política dos agentes põe nas mensagens da conversa de uma sessão: o prompt que a Fabriquinha montou vira
// linha do sistema no chat, e a resposta de `perguntar` leva o Ator de quem respondeu, o Agente (o Auditor automático, que
// o condutor anota no log da execução) ou o Auditor.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDITOR, Ator } from "../../../etapas/publico.ts";
import {
  type Execucao,
  type Mensagem,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAutomatica,
  type Sessao,
  texto,
} from "../../../../sessoes/publico.ts";
import { pastasDoProcesso } from "../../../../sessoes/publico.ts";

/** A sessão e as execuções dela, em ordem: de onde saem os prompts e os registros das respostas automáticas. */
interface ExecucoesDaSessao {
  sessao: Pick<Sessao, "modo">;
  execucoes: readonly Pick<Execucao, "id">[];
}

/**
 * Os prompts que a Fabriquinha montou: o da primeira execução e os das autônomas. Os das retomadas interativas são a
 * mensagem do Auditor.
 */
export function promptsDaFabriquinha(raiz: string, { sessao, execucoes }: ExecucoesDaSessao): Set<string> {
  const arquivos = execucoes
    .filter((e, i) => i === 0 || sessao.modo === "autonomo")
    .map((e) => join(pastasDoProcesso(raiz, e.id).dir, "prompt.md"));
  return new Set(arquivos.filter((a) => existsSync(a)).map((a) => readFileSync(a, "utf8")));
}

const registroDaRespostaAutomatica = new RegExp(`^\\S+ ${PREFIXO_DA_RESPOSTA_AUTOMATICA}(\\{.*\\})$`);

/** Os Agentes que o Auditor automático fez responder, por chamada de `perguntar`: o condutor os anota no log da execução. */
function atoresDasRespostasAutomaticas(
  raiz: string,
  { execucoes }: ExecucoesDaSessao,
): Map<string, RespostaAutomatica["ator"]> {
  const registros = execucoes
    .map((e) => pastasDoProcesso(raiz, e.id).log)
    .filter((log) => existsSync(log))
    .flatMap((log) => readFileSync(log, "utf8").split("\n"))
    // Só a linha cujo texto começa com o prefixo é o registro; as livres do condutor citam a pergunta crua do agente.
    .map((linha) => registroDaRespostaAutomatica.exec(linha)?.[1])
    .filter((json) => json !== undefined)
    .map((json) => JSON.parse(json) as RespostaAutomatica)
    .filter((registro) => Ator.safeParse(registro.ator).success);
  return new Map(registros.map((r) => [r.chamada, r.ator]));
}

/** A marca de cada mensagem da conversa da sessão: `fabriquinha` no prompt montado, o `ator` na resposta de `perguntar`. */
export function marcadorDaConversa(
  raiz: string,
  execucoesDaSessao: ExecucoesDaSessao,
): (mensagem: unknown) => { fabriquinha: true } | { ator: Ator } | undefined {
  const prompts = promptsDaFabriquinha(raiz, execucoesDaSessao);
  const automaticas = atoresDasRespostasAutomaticas(raiz, execucoesDaSessao);
  return (mensagem) => {
    const m = mensagem as (Partial<Mensagem> & { toolCallId?: string }) | undefined;
    if (m?.role === "toolResult" && m.toolName === "perguntar") {
      return { ator: automaticas.get(String(m.toolCallId)) ?? AUDITOR };
    }
    return m?.role === "user" && prompts.has(texto(m as Mensagem)) ? { fabriquinha: true } : undefined;
  };
}
