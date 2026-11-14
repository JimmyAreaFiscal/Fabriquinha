// A conversa guardada de uma sessão com o que as execuções dela registraram fora do JSONL (F4 §6.1.2): o prompt com que
// quem pediu lançou cada execução (`prompt.md`) e as respostas do Auditor automático, que o motor anota no log. Daí sai a
// marca de cada mensagem: o prompt do pedido e quem respondeu a `perguntar`. Tudo é lido só quando pedido.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PREFIXO_DA_RESPOSTA_AUTOMATICA, type RespostaAutomatica } from "../../chat/publico.ts";
import { lerConversaDoArquivo, type Mensagem, perguntasRespondidasNaConversa, texto } from "../../historico/publico.ts";

/** A marca de uma mensagem: o prompt do pedido, ou a resposta da `perguntar`, com o Agente que respondeu sozinho. */
type MarcaDaMensagem =
  { promptDoPedido: true } | { respostaDaPergunta: { respondidaPor?: RespostaAutomatica["ator"] } };

export interface ConversaDaSessao {
  /** As entradas do arquivo que o harness grava, ou nenhuma antes de ele existir. */
  readonly entradas: unknown[];
  /**
   * Os prompts que quem pediu montou: o da primeira execução e os das autônomas. Os das retomadas interativas são a
   * mensagem de quem conversa.
   */
  readonly promptsDoPedido: ReadonlySet<string>;
  /** As perguntas da `perguntar` que alguém respondeu; cancelamento e resposta vazia ficam de fora. */
  readonly perguntasRespondidas: { pergunta: string; resposta: string }[];
  marcaDa(mensagem: unknown): MarcaDaMensagem | undefined;
}

/** A sessão com as pastas das execuções dela, em ordem. */
interface SessaoComPastas {
  modo: string;
  /** O arquivo da conversa que o harness grava, se já existe. */
  arquivo: string | undefined;
  pastas: readonly { dir: string; log: string }[];
}

const registroDaRespostaAutomatica = new RegExp(`^\\S+ ${PREFIXO_DA_RESPOSTA_AUTOMATICA}(\\{.*\\})$`);

const linhasDosArquivos = (arquivos: readonly string[]): string[] =>
  arquivos.filter((arquivo) => existsSync(arquivo)).map((arquivo) => readFileSync(arquivo, "utf8"));

function promptsDoPedido({ modo, pastas }: SessaoComPastas): Set<string> {
  const doPedido = pastas.filter((_, i) => i === 0 || modo === "autonomo");
  return new Set(linhasDosArquivos(doPedido.map(({ dir }) => join(dir, "prompt.md"))));
}

/** Quem o Auditor automático fez responder, por chamada de `perguntar`. */
function respondidasPeloAuditorAutomatico({ pastas }: SessaoComPastas): Map<string, RespostaAutomatica["ator"]> {
  const registros = linhasDosArquivos(pastas.map(({ log }) => log))
    .flatMap((conteudo) => conteudo.split("\n"))
    // Só a linha cujo texto começa com o prefixo é o registro; as livres do motor citam a pergunta crua do agente.
    .map((linha) => registroDaRespostaAutomatica.exec(linha)?.[1])
    .filter((json) => json !== undefined)
    .map((json) => JSON.parse(json) as RespostaAutomatica);
  return new Map(registros.map((registro) => [registro.chamada, registro.ator]));
}

export function conversaDaSessao(sessao: SessaoComPastas): ConversaDaSessao {
  let prompts: Set<string> | undefined;
  let automaticas: Map<string, RespostaAutomatica["ator"]> | undefined;
  const lerPrompts = () => (prompts ??= promptsDoPedido(sessao));
  return {
    get entradas() {
      return lerConversaDoArquivo(sessao.arquivo);
    },
    get promptsDoPedido() {
      return lerPrompts();
    },
    get perguntasRespondidas() {
      return perguntasRespondidasNaConversa(lerConversaDoArquivo(sessao.arquivo));
    },
    marcaDa(mensagem) {
      const m = mensagem as (Partial<Mensagem> & { toolCallId?: string }) | undefined;
      if (m?.role === "toolResult" && m.toolName === "perguntar") {
        automaticas ??= respondidasPeloAuditorAutomatico(sessao);
        const respondidaPor = automaticas.get(String(m.toolCallId));
        return { respostaDaPergunta: respondidaPor ? { respondidaPor } : {} };
      }
      return m?.role === "user" && lerPrompts().has(texto(m as Mensagem)) ? { promptDoPedido: true } : undefined;
    },
  };
}
