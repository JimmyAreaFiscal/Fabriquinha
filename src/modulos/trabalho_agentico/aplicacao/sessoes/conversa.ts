// provisório: remover no ticket 22 (a conversa guardada mudou para src/modulos/sessoes/historico/, e as sessões de agente
// a leem pelo harness: `SessoesDeAgente.lerConversa`)
import { condutor } from "../trabalho/condutor.ts";

export { emMarkdown, type Mensagem, texto } from "../../../sessoes/publico.ts";

/** As entradas do JSONL da sessão; linha incompleta do fim fica de fora. */
export const lerConversa = (raiz: string, sessao: string): unknown[] => condutor.lerConversa(raiz, sessao);

/** As perguntas que o agente fez com `perguntar` e que o Auditor respondeu; sessão sem arquivo não tem perguntas. */
export const perguntasRespondidasNaSessao = (raiz: string, sessao: string): { pergunta: string; resposta: string }[] =>
  condutor.perguntasRespondidasNaSessao(raiz, sessao);
