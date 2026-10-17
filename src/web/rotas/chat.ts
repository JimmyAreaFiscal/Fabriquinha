// Rotas do chat (F7 §4.2, §4.4; F4 §5.4, §6.4 a §6.8): a sessão com a conversa, os eventos ao vivo por SSE, as
// mensagens com o histórico de outras sessões anexado, os diálogos de extensão, o aborto, o registro (C1, C2 e C10), a
// conclusão da sessão em aberto, responder e retomar (C9 e C20), a consulta (C21) e o histórico em Markdown. Cada rota
// só converte a entrada e chama o F4; as regras ficam lá.
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AUDITOR, type Execucao, type Issue, type PropostaIssue, type Ticket } from "../../dominio/agregado.ts";
import { naSessaoPrincipal, ticketDe } from "../../dominio/execucao.ts";
import { existe } from "../../dominio/erros.ts";
import { editarIssue } from "../../dominio/issue.ts";
import { lotes, propostasAbertas } from "../../dominio/propostas.ts";
import { Id, Motivo } from "../../dominio/primitivos.ts";
import { abortar, responderDialogo } from "../../execucao/gerente.ts";
import {
  anexarHistorico,
  exportarHistorico,
  type Mensagem,
  nomeDoHistorico,
  promptsDaFabriquinha,
  texto,
} from "../../execucao/historico.ts";
import {
  abrirChat,
  avisoDaProposta,
  avisoDoLote,
  concluirSessao,
  conversarSobre,
  decidirProposta,
  decidirGate,
  enviar,
  type InfoSessao,
  infoDaSessao,
  type OpcoesInterativa,
  reabrir,
  registrarNecessidade,
} from "../../execucao/sessoes.ts";
import { raizDo } from "../../persistencia/banco.ts";
import { agregadoExistente, comIssue, issueDoTicket, propostasDaIssue } from "../../persistencia/issues.ts";
import { configuracao } from "../../persistencia/servico.ts";
import { IdDoCaminho, type Rota } from "../rotas.ts";

/** A sessão com o que a barra de estado, o envio e a coluna da direita do chat leem. */
export interface CabecalhoDoChat {
  sessao: InfoSessao;
  issue: Issue;
  /** O ticket da sessão: o erro dele na falha e o modelo que o seletor da retomada mostra. */
  ticket: Ticket;
  /** As execuções da sessão, em ordem: dão as linhas do sistema da conversa. */
  execucoes: Execucao[];
  /** As propostas de issue abertas do ticket, só no registro interativo. */
  propostas?: PropostaIssue[];
}

/**
 * Uma entrada do JSONL do pi; o prompt montado pela Fabriquinha (F4 §6.3) vem com `fabriquinha`, e o aviso de uma
 * proposta decidida, com `aviso`.
 */
export type Entrada = Record<string, unknown> & { fabriquinha?: true; aviso?: true };

export interface DadosDoChat extends CabecalhoDoChat {
  conversa: Entrada[];
}

export const opcoes = (banco: DatabaseSync): OpcoesInterativa => ({ ociosidadeMin: configuracao(banco).ociosidadeMin });

function cabecalho(banco: DatabaseSync, sessao: InfoSessao): CabecalhoDoChat {
  const ag = agregadoExistente(banco, sessao.issue);
  const propostas =
    sessao.etapa === "registro" && sessao.modo === "interativo"
      ? propostasAbertas(ag, propostasDaIssue(banco, sessao.issue)).filter((p) => p.ticket === sessao.ticket)
      : undefined;
  return {
    sessao,
    issue: ag.issue,
    ticket: ticketDe(ag, sessao.ticket),
    execucoes: ag.execucoes.filter((e) => e.sessaoPi === sessao.sessao),
    ...(propostas && { propostas }),
  };
}

/**
 * A marca da mensagem do usuário que veio da Fabriquinha: `fabriquinha` no prompt montado por ela, que o chat mostra
 * como linha do sistema, com o link do `prompt.md`; `aviso` na mensagem de uma proposta de issue decidida ou de um
 * lote de propostas já decididas, que o chat mostra como mensagem da Fabriquinha. Nenhuma marca é mensagem do Auditor.
 */
function marcador(banco: DatabaseSync, sessao: InfoSessao): (mensagem: unknown) => Entrada | undefined {
  const ag = agregadoExistente(banco, sessao.issue);
  const prompts = promptsDaFabriquinha(raizDo(banco), ag, sessao.ticket);
  const doTicket = propostasDaIssue(banco, sessao.issue).filter((p) => p.ticket === sessao.ticket);
  const avisos = new Set([
    ...doTicket.filter((p) => p.status !== "pendente").map((p) => avisoDaProposta(p, sessao.issue)),
    ...lotes(doTicket)
      .filter((l) => l.every((p) => p.status !== "pendente"))
      .map((l) => avisoDoLote(l, sessao.issue)),
  ]);
  return (mensagem) => {
    const m = mensagem as Partial<Mensagem> | undefined;
    if (m?.role !== "user") return undefined;
    const t = texto(m as Mensagem);
    if (prompts.has(t)) return { fabriquinha: true };
    return avisos.has(t) ? { aviso: true } : undefined;
  };
}

function dadosDoChat(banco: DatabaseSync, sessao: InfoSessao, conversa: unknown[]): DadosDoChat {
  const marcar = marcador(banco, sessao);
  return {
    ...cabecalho(banco, sessao),
    conversa: conversa.map((e) => ({ ...(e as Entrada), ...marcar((e as Entrada).message) })),
  };
}

/**
 * SSE (F4 §5.4): primeiro `{ type: "chat" }` com a sessão e a conversa até agora, lidas logo antes de assinar, sem
 * nada no meio; depois os eventos da mensagem que o agente ainda escreve, que o JSONL não tem, e cada evento do pi
 * como veio e `{ type: "estado" }` com o cabeçalho novo. Quem reconecta recebe o retrato inteiro de novo.
 */
async function eventos(banco: DatabaseSync, sessao: string, resposta: ServerResponse) {
  const chat = await abrirChat(banco, sessao);
  // `abrirChat` pode esperar o C6 de um pi que está parando: quem saiu nesse meio-tempo não assina, senão a assinatura
  // ficaria para sempre, sem o `close` que a cancela.
  if (resposta.destroyed) return;
  const escrever = (dado: object) => resposta.write(`data: ${JSON.stringify(dado)}\n\n`);
  resposta.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
  escrever({ type: "chat", ...dadosDoChat(banco, chat.sessao, chat.conversa) });
  const cancelar = chat.assinar((evento) => {
    if (evento.type === "estado") {
      escrever({ type: "estado", ...cabecalho(banco, evento.sessao as InfoSessao) });
    } else
      escrever(evento.type === "message_end" ? { ...evento, ...marcador(banco, chat.sessao)(evento.message) } : evento);
  });
  resposta.on("close", cancelar);
}

/** Responder e retomar (C9): a instrução e as sessões cujo histórico vai junto com ela (F4 §6.8). */
const Reabertura = z.strictObject({
  instrucao: z.string().default(""),
  anexos: z.array(z.string().min(1)).default([]),
});

/** A sessão principal do ticket, onde a retomada continua (F4 §6.4). */
function sessaoPrincipal(banco: DatabaseSync, ticket: Id): string {
  const ag = agregadoExistente(banco, issueDoTicket(banco, ticket));
  return existe(
    ag.execucoes.findLast(naSessaoPrincipal(ticket)),
    `T-${String(ticket)} ainda não tem sessão`,
    "execute o ticket antes de retomá-lo",
  ).sessaoPi;
}

/** `anexos` são sessões cujo histórico vai junto (F4 §6.8). */
const NovaMensagem = z.strictObject({
  texto: z.string().trim().min(1),
  modo: z.enum(["prompt", "steer", "follow_up"]),
  anexos: z.array(z.string().min(1)).default([]),
});

/** `{ valor }`, `{ confirmado }` ou `{ cancelado: true }`, no formato do `extension_ui_response` do pi. */
const RespostaDialogo = z.union([
  z.strictObject({ valor: z.string() }).transform((r) => ({ value: r.valor })),
  z.strictObject({ confirmado: z.boolean() }).transform((r) => ({ confirmed: r.confirmado })),
  z.strictObject({ cancelado: z.literal(true) }).transform(() => ({ cancelled: true as const })),
]);

/** A decisão do gate do registro e do desenho (C10, C15): aprovar, ou devolver com o motivo, que vai ao agente. */
export const DecisaoDoGate = z.discriminatedUnion("aprovado", [
  z.strictObject({ aprovado: z.literal(true) }),
  z.strictObject({ aprovado: z.literal(false), motivo: Motivo }),
]);

const DecisaoProposta = z.strictObject({ aceita: z.boolean() });

const Registro = z.strictObject({
  projeto: z.string(),
  deps: z.array(Id).default([]),
  descricao: z.string().trim().min(1, "a descrição da necessidade é obrigatória"),
});

export const ROTAS_DO_CHAT: Rota[] = [
  {
    metodo: "POST",
    caminho: "/api/registros",
    tratar: ({ banco, corpo }) => {
      const { projeto, deps, descricao } = Registro.parse(corpo);
      return { sessao: registrarNecessidade(banco, projeto, deps, descricao, opcoes(banco)) };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao",
    tratar: async ({ banco, params }) => {
      const chat = await abrirChat(banco, String(params.sessao));
      return dadosDoChat(banco, chat.sessao, chat.conversa);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/eventos",
    tratar: ({ banco, params, resposta }) => eventos(banco, String(params.sessao), resposta),
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/mensagens",
    tratar: async ({ banco, params, corpo }) => {
      const { texto, modo, anexos } = NovaMensagem.parse(corpo);
      const sessao = String(params.sessao);
      const mensagem = anexos.length > 0 ? await anexarHistorico(banco, sessao, anexos, texto) : texto;
      await enviar(banco, sessao, mensagem, modo, opcoes(banco));
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/historico.md",
    tratar: async ({ banco, params, resposta }) => {
      const info = await infoDaSessao(banco, String(params.sessao));
      resposta
        .writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${nomeDoHistorico(info)}"`,
        })
        .end(exportarHistorico(banco, info.sessao));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/dialogos/:id",
    tratar: async ({ banco, params, corpo }) => {
      const resposta = RespostaDialogo.parse(corpo);
      const { execucao } = await infoDaSessao(banco, String(params.sessao));
      responderDialogo(execucao, String(params.id), resposta);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/abortar",
    tratar: async ({ banco, params }) => {
      abortar((await infoDaSessao(banco, String(params.sessao))).execucao);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/issues/:id",
    tratar: ({ banco, params, corpo }) =>
      comIssue(banco, IdDoCaminho.parse(params.id), "editarIssue", AUDITOR, (ag) => editarIssue(ag, corpo, AUDITOR))
        .issue,
  },
  {
    metodo: "POST",
    caminho: "/api/issues/:id/registro",
    tratar: async ({ banco, params, corpo }) => {
      const decisao = DecisaoDoGate.parse(corpo);
      await decidirGate(banco, IdDoCaminho.parse(params.id), "registro", decisao, opcoes(banco));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/propostas/:id",
    tratar: ({ banco, params, corpo }) => {
      const { aceita } = DecisaoProposta.parse(corpo);
      return decidirProposta(banco, IdDoCaminho.parse(params.id), aceita, opcoes(banco));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/tickets/:id/reabrir",
    tratar: async ({ banco, params, corpo }) => {
      const ticket = IdDoCaminho.parse(params.id);
      const { instrucao, anexos } = Reabertura.parse(corpo);
      // O histórico anexado vai na instrução da próxima tentativa (F4 §6.4, §6.8), como numa mensagem.
      const texto =
        anexos.length > 0 ? await anexarHistorico(banco, sessaoPrincipal(banco, ticket), anexos, instrucao) : instrucao;
      reabrir(banco, ticket, texto.trim() || undefined);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/tickets/:id/consulta",
    tratar: async ({ banco, params }) => ({
      sessao: await conversarSobre(banco, IdDoCaminho.parse(params.id), opcoes(banco)),
    }),
  },
  {
    metodo: "POST",
    caminho: "/api/tickets/:id/concluir-sessao",
    tratar: ({ banco, params }) => concluirSessao(banco, IdDoCaminho.parse(params.id)),
  },
];
