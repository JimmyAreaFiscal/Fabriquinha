// Auditoria do Histórico (F4; F7 §4.4) como funções puras: a barra com o mês e a coluna "O que o agente recebeu" em
// HTML, o envio conforme o estado e a conversa como mensagens do assistant-ui. As peças da conversa (mensagem, doSistema,
// chaveDa) são as do chat. O texto que vem do servidor passa sempre por `escapar`.
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Auditoria } from "../../../execucao/auditoria.ts";
import type { Entrada } from "../../rotas/chat.ts";
import { escapar, nomeDoModelo, plural, rotuloDoModelo } from "../render.ts";
import { chaveDa, doSistema, type Envio, mensagem, type MensagemPi } from "./chat.ts";

/** O que `GET /api/auditorias/:sessao` e o primeiro evento do SSE dão, com o id da sessão da página. */
export type DadosDaAuditoria = Omit<Auditoria, "assinar"> & { sessao: string };

const DICA = '<span class="dica-tecla">Enter envia · Shift+Enter quebra linha</span>';

/** O modelo da última resposta do agente, ou o padrão do pi enquanto ele não respondeu. */
export function modeloDaAuditoria(conversa: readonly unknown[]): string {
  const resposta = (conversa as Entrada[])
    .map((e) => e.message as MensagemPi | undefined)
    .findLast((m) => m?.role === "assistant");
  return resposta?.model
    ? nomeDoModelo({ provedor: String(resposta.provider), modelo: resposta.model })
    : "modelo padrão do pi";
}

/** Barra de estado: **Auditoria** e o mês, o escopo, o estado, o modelo e o link do índice do mês. */
export function barraDaAuditoria(dados: DadosDaAuditoria, modelo: string): string {
  const etiqueta =
    dados.estado === "rodando"
      ? '<span class="pill pill-rodando">rodando</span>'
      : '<span class="pill pill-aguarda">aguarda você · conversa</span>';
  return (
    `<div class="estado-sessao"><span class="issue"><span class="id">Auditoria</span> ${escapar(dados.rotulo)}</span>` +
    `<span class="sep">│</span><span class="muted">todos os projetos · ${plural(dados.sessoes, "sessão", "sessões")}</span>` +
    `${etiqueta}${rotuloDoModelo(modelo)}` +
    `<div class="direita"><a class="link" href="/api/auditorias/${encodeURIComponent(dados.sessao)}/indice.md" target="_blank" rel="noopener">índice do mês</a></div></div>`
  );
}

/** A coluna da direita: o que o agente recebeu e que ele só propõe. */
export function ladoDaAuditoria(dados: DadosDaAuditoria): string {
  const projetos = Object.entries(dados.projetos)
    .map(([p, n]) => `${escapar(p)} (${String(n)})`)
    .join(" · ");
  return (
    `<h3>O que o agente recebeu</h3><dl class="fatos"><dt>Mês</dt><dd>${escapar(dados.rotulo)}</dd>` +
    `<dt>Sessões</dt><dd>${plural(dados.sessoes, "terminada", "terminadas")}</dd>` +
    `<dt>Projetos</dt><dd>${projetos}</dd></dl>` +
    '<p class="muted pequeno">O agente só propõe melhorias: não registra issue nem altera projeto.</p>'
  );
}

/** Em conversa, o compositor com Enviar; com o agente rodando, só Abortar. */
export function envioDaAuditoria(estado: Auditoria["estado"]): Envio {
  if (estado === "rodando") {
    return {
      html:
        '<div class="fim">O agente está trabalhando; a pergunta fica para quando ele terminar.' +
        '<div class="botoes"><button type="button" class="btn btn-perigo" data-abortar>Abortar</button></div></div>',
    };
  }
  return {
    placeholder: "Pergunte sobre a auditoria",
    linha: `${DICA}<div class="direita"><button class="btn btn-primario">Enviar</button></div>`,
  };
}

/** A linha do sistema "Auditoria de … iniciada", que ocupa o lugar do prompt montado pela Fabriquinha (`m`). */
export const linhaDoInicio = (m: MensagemPi, dados: Pick<DadosDaAuditoria, "rotulo">): ThreadMessageLike =>
  doSistema({
    chave: chaveDa(m),
    html: `<div class="sistema">Auditoria de ${escapar(dados.rotulo)} iniciada</div>`,
  });

/** A conversa do JSONL; o prompt marcado `fabriquinha` vira a linha do início. */
export function conversaDaAuditoria(dados: DadosDaAuditoria): ThreadMessageLike[] {
  const mensagens = (dados.conversa as Entrada[]).flatMap((e) =>
    e.type === "message" ? [{ m: e.message as MensagemPi, fabriquinha: e.fabriquinha === true }] : [],
  );
  const resultados = new Map(
    mensagens.filter(({ m }) => m.role === "toolResult").map(({ m }) => [String(m.toolCallId), m] as const),
  );
  return mensagens.flatMap(({ m, fabriquinha }) => (fabriquinha ? [linhaDoInicio(m, dados)] : mensagem(m, resultados)));
}
