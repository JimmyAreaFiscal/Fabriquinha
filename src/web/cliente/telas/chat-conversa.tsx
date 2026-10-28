// A conversa do chat com o assistant-ui: a lista que rola sozinha (o Viewport segue o fim só quando o Auditor está
// nele), os balões do Auditor e do agente, as linhas do sistema e a área de envio. O estado vem de chat-montar.ts,
// que redesenha com `desenharConversa` a cada mudança; o servidor entrega este arquivo empacotado pelo esbuild.
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
  type ThreadMessageLike,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
  useAuiEvent,
  useAuiState,
  useExternalStoreRuntime,
  useThreadViewport,
} from "@assistant-ui/react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { markdown } from "../markdown.ts";
import { type Bloco, comCursor, corpoDaFerramenta, type Envio, type MensagemPi } from "./chat.ts";

export interface PropsDaConversa {
  mensagens: readonly ThreadMessageLike[];
  envio: Envio;
  /** Envia o texto do compositor; se falhar, o texto volta ao campo. */
  aoEnviar: (texto: string) => Promise<void>;
  /** Chamado quando o Auditor tenta enviar o campo vazio ou só com espaços; sem ele, o envio vazio segue calado. */
  aoVazio?: () => void;
}

const html = (h: string) => ({ __html: h });

const useNoFluxo = () => useAuiState((s) => s.message.id === "fluxo");

function Texto({ text }: TextMessagePartProps) {
  const fluxo = useNoFluxo();
  return (
    <div className="balao md" dangerouslySetInnerHTML={html(fluxo ? comCursor(markdown(text)) : markdown(text))} />
  );
}

function Raciocinio({ text }: ReasoningMessagePartProps) {
  return (
    <details className="pensando">
      <summary>{useNoFluxo() ? "raciocínio…" : "raciocínio"}</summary>
      <p>{text}</p>
    </details>
  );
}

/** O `open` do `<details>` fica com o navegador: o resultado que chega troca só o conteúdo. */
function Ferramenta({ artifact }: ToolCallMessagePartProps) {
  const { chamada, resultado } = artifact as { chamada: Bloco; resultado?: MensagemPi };
  return (
    <details
      className="ferramenta"
      data-chamada={chamada.id}
      dangerouslySetInnerHTML={html(corpoDaFerramenta(chamada, resultado))}
    />
  );
}

const PARTES = { Text: Texto, Reasoning: Raciocinio, tools: { Fallback: Ferramenta } };

const DoAuditor = () => (
  <MessagePrimitive.Root className="msg voce">
    <MessagePrimitive.Parts components={PARTES} />
  </MessagePrimitive.Root>
);

const DoAgente = () => (
  <MessagePrimitive.Root className={useNoFluxo() ? "msg agente fluxo" : "msg agente"}>
    <MessagePrimitive.Parts components={PARTES} />
  </MessagePrimitive.Root>
);

function DoSistema() {
  const h = useAuiState((s) => String(s.message.metadata.custom.html));
  return <MessagePrimitive.Root dangerouslySetInnerHTML={html(h)} />;
}

/** O envio do Auditor leva a lista ao fim, para ele ver a própria mensagem e o que vier depois. */
function RolarAoEnviar() {
  const rolar = useThreadViewport((v) => v.scrollToBottom);
  useAuiEvent("composer.send", () => {
    rolar();
  });
  return null;
}

const PAPEIS = { user: DoAuditor, assistant: DoAgente, system: DoSistema };

function DaMensagem({ papel }: Readonly<{ papel: keyof typeof PAPEIS }>) {
  const Mensagem = PAPEIS[papel];
  return <Mensagem />;
}

function Conversa({ mensagens, envio, aoEnviar, aoVazio }: Readonly<PropsDaConversa>) {
  // ponytail: sem `isRunning`: o assistant-ui bloqueia o Enter enquanto roda, e o Auditor redireciona o agente rodando.
  const runtime = useExternalStoreRuntime({
    messages: mensagens,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async ({ content }) => {
      const texto = content
        .flatMap((p) => (p.type === "text" ? [p.text] : []))
        .join("\n")
        .trim();
      try {
        await aoEnviar(texto);
      } catch {
        runtime.thread.composer.setText(texto);
      }
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="coluna-conversa">
        <ThreadPrimitive.Viewport className="conversa" data-conversa aria-live="polite">
          <ThreadPrimitive.Messages>{({ message }) => <DaMensagem papel={message.role} />}</ThreadPrimitive.Messages>
          <RolarAoEnviar />
        </ThreadPrimitive.Viewport>
        <div className="area-envio">
          {"html" in envio ? (
            <div className="envio-fixo" dangerouslySetInnerHTML={html(envio.html)} />
          ) : (
            <ComposerPrimitive.Root
              className="compositor"
              data-envio
              onSubmit={() => {
                if (aoVazio && !runtime.thread.composer.getState().text.trim()) aoVazio();
              }}
              onKeyDown={(e) => {
                if (aoVazio && e.key === "Enter" && !e.shiftKey && !runtime.thread.composer.getState().text.trim())
                  aoVazio();
              }}
            >
              <ComposerPrimitive.Input name="texto" rows={2} aria-label="Mensagem" placeholder={envio.placeholder} />
              <div className="linha-1" dangerouslySetInnerHTML={html(envio.linha)} />
            </ComposerPrimitive.Root>
          )}
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const raizes = new WeakMap<Element, Root>();

/** Desenha (ou redesenha) a conversa em `alvo`, já no DOM ao voltar (o seletor de modelo procura nele); o React só troca o que mudou. */
export function desenharConversa(alvo: Element, props: PropsDaConversa): void {
  let raiz = raizes.get(alvo);
  if (!raiz) {
    raiz = createRoot(alvo);
    raizes.set(alvo, raiz);
  }
  const conversa = <Conversa {...props} />;
  flushSync(() => {
    raiz.render(conversa);
  });
}

/** Desmonta a conversa ao sair da página. */
export function desmontarConversa(alvo: Element): void {
  raizes.get(alvo)?.unmount();
  raizes.delete(alvo);
}
