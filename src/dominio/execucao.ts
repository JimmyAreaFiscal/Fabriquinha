// Ciclo de vida de execuções e tickets (F1 §3.6, §3.10, §4.2, §4.3): C5 iniciar, C6 terminar, C8 falhar,
// C9 reabrir, C20 modelo do ticket e C21 consulta.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  type Execucao,
  exigirAuditor,
  exigirFabriquinha,
  ModoExecucao,
  rotuloIssue,
  type Ticket,
} from "./agregado.ts";
import { ErroDeRegra } from "./erros.ts";
import { type Etapa, type Fase, Id, Markdown, Modelo, Motivo } from "./primitivos.ts";
import type { Projeto } from "./projeto.ts";

/** Fase em que cada etapa pode executar (F1 §4.3). */
const FASE_DA_ETAPA: Readonly<Record<Etapa, Fase>> = {
  registro: "registro",
  desenho: "desenho",
  desenvolvimento: "desenvolvimento",
  revisao: "revisao",
  encerramento: "encerramento",
  sessao: "ajuste_pr",
};

/** `registro`, `desenho` e `sessao` conversam com o Auditor; as demais rodam sozinhas (F1 §3.6). */
export const modoDaEtapa = (etapa: Etapa): ModoExecucao =>
  etapa === "registro" || etapa === "desenho" || etapa === "sessao" ? "interativo" : "autonomo";

/** F1 §3.10: o override do ticket, senão o modelo da etapa no projeto; `undefined` deixa valer o padrão do pi. */
export const modeloDaExecucao = (ticket: Ticket, projeto: Projeto | undefined): Modelo | undefined =>
  ticket.modelo ?? projeto?.modelos[ticket.etapa];

export const rotuloTicket = (ticket: Ticket): string => `T-${String(ticket.id)}`;

/** As execuções da sessão principal do ticket: as autônomas e interativas, não as consultas (F1 §3.6). */
export const naSessaoPrincipal =
  (ticket: Id) =>
  (e: Execucao): boolean =>
    e.ticket === ticket && e.modo !== "consulta";

export function ticketDe(ag: Agregado, id: Id): Ticket {
  const ticket = ag.tickets.find((t) => t.id === id);
  if (!ticket)
    throw new ErroDeRegra(`o ticket T-${String(id)} não é da ${rotuloIssue(ag)}`, "confira o número do ticket");
  return ticket;
}

const emAndamento = (ag: Agregado, ticket: Ticket): Execucao | undefined =>
  ag.execucoes.find((e) => e.ticket === ticket.id && e.resultado === "em_andamento");

/** C7, C8, C10, C20 e C21 esperam a execução do ticket terminar. */
export function exigirSemExecucao(ag: Agregado, ticket: Ticket, acao: string): void {
  const execucao = emAndamento(ag, ticket);
  if (execucao) {
    throw new ErroDeRegra(
      `${rotuloTicket(ticket)} não pode ${acao}: a execução E-${String(execucao.id)} ainda está em andamento`,
      "espere ela terminar",
    );
  }
}

export const trocarTicket = (ag: Agregado, ticket: Ticket): Agregado => ({
  ...ag,
  tickets: ag.tickets.map((t) => (t.id === ticket.id ? ticket : t)),
});

/** C7 e C10: o agregado com `ticket` concluído agora. */
export const marcarConcluido = (ag: Agregado, ticket: Ticket, agora: string): Agregado =>
  trocarTicket(ag, { ...ticket, status: "concluido", concluidoEm: agora });

/** Ticket aberto que a própria Fabriquinha cria numa transição (C7, C10, C15). */
export const novoTicket = (ag: Agregado, ctx: Contexto, etapa: Etapa, titulo: string, descricao = ""): Ticket => ({
  id: ctx.novoId("ticket"),
  issue: ag.issue.id,
  etapa,
  titulo,
  descricao,
  status: "aberto",
  origem: "fabriquinha",
  criadoEm: ctx.agora,
});

function novaExecucao(ag: Agregado, ticket: Ticket, modo: ModoExecucao, sessaoPi: string, ctx: Contexto): Execucao {
  const modelo = modeloDaExecucao(ticket, ctx.projeto(ag.issue.projeto));
  return {
    id: ctx.novoId("execucao"),
    ticket: ticket.id,
    modo,
    sessaoPi,
    ...(modelo && { modelo }),
    resultado: "em_andamento",
    iniciadaEm: ctx.agora,
  };
}

const EntradaInicio = z.object({ ticket: Id, modo: ModoExecucao, sessaoPi: z.uuid() });

/** Por que a issue não aceita outra execução agora. */
export const jaTemExecucao = (ag: Agregado, execucao: Execucao): string =>
  `a ${rotuloIssue(ag)} já tem a execução E-${String(execucao.id)} em andamento`;

/** C5: ticket `em_execucao`, nova execução em andamento e a instrução do Auditor consumida. */
export function iniciarExecucao(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirFabriquinha(ator, "iniciar uma execução");
  const { ticket: id, modo, sessaoPi } = EntradaInicio.parse(entrada);
  const ticket = ticketDe(ag, id);
  const t = rotuloTicket(ticket);
  const esperado = modoDaEtapa(ticket.etapa);
  if (modo !== esperado) {
    throw new ErroDeRegra(
      `${t} é da etapa ${ticket.etapa}, que roda em modo ${esperado}`,
      `inicie em modo ${esperado}`,
    );
  }
  const fase = FASE_DA_ETAPA[ticket.etapa];
  if (ag.issue.fase !== fase) {
    throw new ErroDeRegra(
      `${t} só executa na fase ${fase}, e a ${rotuloIssue(ag)} está em ${ag.issue.fase}`,
      "espere a issue chegar a essa fase",
    );
  }
  const rodando = ag.execucoes.find((e) => e.resultado === "em_andamento");
  if (rodando) throw new ErroDeRegra(jaTemExecucao(ag, rodando), "espere ela terminar");
  const aceitos: readonly Ticket["status"][] = modo === "autonomo" ? ["aberto"] : ["aberto", "em_execucao"];
  if (!aceitos.includes(ticket.status)) {
    throw new ErroDeRegra(`${t} está ${ticket.status} e não pode executar`, "reabra-o se ele falhou");
  }
  // O desenho é interativo, mas, como as etapas autônomas, só começa com as dependências concluídas (F1 §3.4).
  if (modo === "autonomo" || (ticket.etapa === "desenho" && ticket.status === "aberto")) {
    if (!ctx.depsConcluidas(ag.issue.id)) {
      throw new ErroDeRegra(
        `a ${rotuloIssue(ag)} depende de issues ainda não concluídas`,
        "conclua as dependências antes",
      );
    }
  }
  // A worktree é uma só por issue: o ticket que falhou deixa nela o trabalho sem commit, que o `git add -A` do
  // seguinte commitaria como dele.
  const pendente = ag.tickets.find(
    (o) => o.etapa === "desenvolvimento" && o.id < ticket.id && o.status !== "concluido",
  );
  if (ticket.etapa === "desenvolvimento" && pendente) {
    const p = rotuloTicket(pendente);
    throw new ErroDeRegra(
      `${t} só executa depois dos tickets de desenvolvimento anteriores da ${rotuloIssue(ag)}, e ${p} está ${pendente.status}`,
      `conclua ${p} antes`,
    );
  }
  const { instrucao: _consumida, ...resto } = ticket;
  return {
    ...trocarTicket(ag, { ...resto, status: "em_execucao" }),
    execucoes: [...ag.execucoes, novaExecucao(ag, ticket, modo, sessaoPi, ctx)],
  };
}

const EntradaTermino = z.discriminatedUnion("resultado", [
  z.object({ execucao: Id, resultado: z.literal("sucesso") }),
  z.object({ execucao: Id, resultado: z.literal("falha"), erro: Motivo }),
]);

/** C6: grava o resultado e o término; o ticket não muda. */
export function terminarExecucao(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirFabriquinha(ator, "terminar uma execução");
  const termino = EntradaTermino.parse(entrada);
  const e = `E-${String(termino.execucao)}`;
  const execucao = ag.execucoes.find((x) => x.id === termino.execucao);
  if (!execucao) throw new ErroDeRegra(`a execução ${e} não é da ${rotuloIssue(ag)}`, "confira o número da execução");
  if (execucao.resultado !== "em_andamento") {
    throw new ErroDeRegra(`a execução ${e} já terminou com ${execucao.resultado}`, "nada a fazer");
  }
  const terminada: Execucao = {
    ...execucao,
    resultado: termino.resultado,
    ...(termino.resultado === "falha" && { erro: termino.erro }),
    terminadaEm: ctx.agora,
  };
  return { ...ag, execucoes: ag.execucoes.map((x) => (x.id === execucao.id ? terminada : x)) };
}

const EntradaFalha = z.object({ ticket: Id, erro: Motivo });

/**
 * C8: ticket `falhou` e some o que a execução propôs: os tickets de desenvolvimento ainda abertos que ele criou e a
 * decisão de revisão dele (C14).
 */
export function falharTicket(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  exigirFabriquinha(ator, "falhar um ticket");
  const { ticket: id, erro } = EntradaFalha.parse(entrada);
  const ticket = ticketDe(ag, id);
  if (modoDaEtapa(ticket.etapa) !== "autonomo") {
    throw new ErroDeRegra(
      `${rotuloTicket(ticket)} é interativo e não falha`,
      "a sessão continua em execução e o Auditor a retoma",
    );
  }
  if (ticket.status !== "em_execucao") {
    throw new ErroDeRegra(
      `${rotuloTicket(ticket)} está ${ticket.status}, não em execução`,
      "só falha o ticket em execução",
    );
  }
  exigirSemExecucao(ag, ticket, "falhar");
  const criadoPorEle = (t: Ticket) =>
    t.origemTicket === ticket.id && t.etapa === "desenvolvimento" && t.status === "aberto";
  return {
    ...ag,
    decisoes: ag.decisoes.filter((d) => d.gate !== "revisao" || d.ticket !== ticket.id),
    tickets: ag.tickets
      .filter((t) => !criadoPorEle(t))
      .map((t) => (t.id === ticket.id ? { ...t, status: "falhou" as const, erro } : t)),
  };
}

const EntradaDevolucao = z.object({ ticket: Id, instrucao: Markdown });

/**
 * O C9 da Fabriquinha: o ticket autônomo cujo código reprovou num gate volta `aberto`, com a instrução de corrigir,
 * para a próxima execução retomar a mesma sessão; o trabalho fica na worktree.
 */
export function devolverTicket(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  exigirFabriquinha(ator, "devolver um ticket");
  const { ticket: id, instrucao } = EntradaDevolucao.parse(entrada);
  const ticket = ticketDe(ag, id);
  if (modoDaEtapa(ticket.etapa) !== "autonomo" || ticket.status !== "em_execucao") {
    throw new ErroDeRegra(`${rotuloTicket(ticket)} está ${ticket.status}`, "só se devolve ticket autônomo em execução");
  }
  exigirSemExecucao(ag, ticket, "devolver");
  return trocarTicket(ag, { ...ticket, status: "aberto", instrucao, devolucoes: (ticket.devolucoes ?? 0) + 1 });
}

const EntradaReabertura = z.object({ ticket: Id, instrucao: Markdown.optional() });

/** C9: ticket `aberto` de novo, sem o erro, com a resposta do Auditor para a próxima execução (F4 §6.4). */
export function reabrirTicket(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  exigirAuditor(ator, "reabrir um ticket");
  const { ticket: id, instrucao } = EntradaReabertura.parse(entrada);
  const ticket = ticketDe(ag, id);
  if (ticket.status !== "falhou") {
    throw new ErroDeRegra(`${rotuloTicket(ticket)} está ${ticket.status}`, "só se reabre ticket que falhou");
  }
  const { erro: _apagado, devolucoes: _zeradas, ...resto } = ticket;
  return trocarTicket(ag, { ...resto, status: "aberto", ...(instrucao !== undefined && { instrucao }) });
}

const EntradaModelo = z.object({ ticket: Id, modelo: Modelo.nullable() });

/** C20: define ou remove (`null`) o override de modelo do ticket; vale a partir da próxima execução. */
export function definirModeloTicket(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  exigirAuditor(ator, "trocar o modelo de um ticket");
  const { ticket: id, modelo } = EntradaModelo.parse(entrada);
  const ticket = ticketDe(ag, id);
  if (ticket.status === "concluido") {
    throw new ErroDeRegra(`${rotuloTicket(ticket)} já está concluído`, "o modelo só vale para as próximas execuções");
  }
  exigirSemExecucao(ag, ticket, "trocar de modelo");
  const { modelo: _anterior, ...resto } = ticket;
  return trocarTicket(ag, { ...resto, ...(modelo && { modelo }) });
}

const EntradaConsulta = z.object({ ticket: Id, sessaoPi: z.uuid() });

/** C21: nova execução em modo consulta, numa cópia da sessão principal; o ticket não muda. */
export function iniciarConsulta(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "abrir uma consulta");
  const { ticket: id, sessaoPi } = EntradaConsulta.parse(entrada);
  const ticket = ticketDe(ag, id);
  const principal = ag.execucoes.find(naSessaoPrincipal(ticket.id))?.sessaoPi;
  if (principal === undefined) {
    throw new ErroDeRegra(`${rotuloTicket(ticket)} ainda não tem sessão`, "consulte um ticket que já executou");
  }
  exigirSemExecucao(ag, ticket, "abrir uma consulta");
  if (sessaoPi === principal) {
    throw new ErroDeRegra(
      `a consulta não pode usar a sessão principal de ${rotuloTicket(ticket)}`,
      "copie a sessão antes",
    );
  }
  return { ...ag, execucoes: [...ag.execucoes, novaExecucao(ag, ticket, "consulta", sessaoPi, ctx)] };
}
