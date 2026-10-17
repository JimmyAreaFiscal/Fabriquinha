// Agregado da issue, ator e contexto dos comandos (F1 §3.2, §3.4, §3.5, §5).
// Cada comando é uma função pura `(agregado, entrada, ator, contexto) → agregado`; o F2 carrega, aplica e grava.
import { z } from "zod";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  Etapa,
  Fase,
  Id,
  Instante,
  Markdown,
  Modelo,
  Motivo,
  Slug,
  Titulo,
  type TipoId,
  unicoPor,
} from "./primitivos.ts";
import type { Projeto } from "./projeto.ts";

/**
 * Quem pede o comando; também é a origem de um ticket (quem o criou). `externo` é a IA de fora da Fabriquinha que
 * registra a necessidade pelo `fabriquinha necessidade`, sem sessão do pi.
 */
export const TipoAtor = z.enum(["auditor", "agente", "fabriquinha", "externo"]);

export const Ator = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal(TipoAtor.enum.auditor) }),
  z.object({ tipo: z.literal(TipoAtor.enum.agente), execucao: Id, ticket: Id }),
  z.object({ tipo: z.literal(TipoAtor.enum.fabriquinha) }),
  z.object({ tipo: z.literal(TipoAtor.enum.externo) }),
]);

/** Os atores sem dados: o Auditor, a própria Fabriquinha e a IA externa. */
export const AUDITOR: Ator = { tipo: "auditor" };
export const FABRIQUINHA: Ator = { tipo: "fabriquinha" };
export const EXTERNO: Ator = { tipo: "externo" };

export const TipoIssue = z.enum(["funcionalidade", "problema"]);

export const Issue = z.object({
  id: Id,
  projeto: Slug,
  titulo: Titulo.nullable(),
  tipo: TipoIssue.nullable(),
  descricao: Markdown.default(""),
  fase: Fase,
  deps: z.array(Id).default([]),
  criadaEm: Instante,
  concluidaEm: Instante.optional(),
  arquivadaEm: Instante.optional(),
  canceladaEm: Instante.optional(),
});

export const StatusTicket = z.enum(["aberto", "em_execucao", "concluido", "falhou", "fechado", "cancelado"]);

export const Ticket = z.object({
  id: Id,
  issue: Id,
  etapa: Etapa,
  titulo: Titulo,
  descricao: Markdown.default(""),
  status: StatusTicket,
  origem: TipoAtor,
  origemTicket: Id.optional(),
  modelo: Modelo.optional(),
  instrucao: Markdown.optional(),
  /** Quantas vezes seguidas a Fabriquinha devolveu o ticket ao agente por reprovação; o C9 do Auditor zera. */
  devolucoes: z.number().int().positive().optional(),
  erro: z.string().max(2000).optional(),
  criadoEm: Instante,
  concluidoEm: Instante.optional(),
  /** C25: quando o agente do registro ou do desenho enviou o resultado à aprovação do Auditor. */
  enviadoEm: Instante.optional(),
});

export const ModoExecucao = z.enum(["autonomo", "interativo", "consulta"]);
export const ResultadoExecucao = z.enum(["em_andamento", "sucesso", "falha"]);

export const Execucao = z.object({
  id: Id,
  ticket: Id,
  modo: ModoExecucao,
  sessaoPi: z.uuid(),
  modelo: Modelo.optional(),
  resultado: ResultadoExecucao,
  erro: z.string().max(2000).optional(),
  iniciadaEm: Instante,
  terminadaEm: Instante.optional(),
});

export const GateDecisao = z.enum(["registro", "desenho", "revisao", "pr"]);

/** Veredito de um gate. As regras entre `gate`, `aprovado`, `motivo`, `nota` e `por` (F1 §3.7) ficam nos CHECKs do F2. */
export const Decisao = z.object({
  id: Id,
  issue: Id,
  ticket: Id,
  gate: GateDecisao,
  aprovado: z.boolean(),
  motivo: Motivo.optional(),
  nota: z.number().int().min(1).max(5).optional(),
  por: TipoAtor.extract(["auditor", "agente"]),
  em: Instante,
});

/** Os 17 tipos do F3 §2. */
export const TipoEvidencia = z.enum([
  "comportamento",
  "criterios_aceite",
  "desenho_solucao",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
  "execucao_testes",
  "matriz_fitness",
  "relatorio_sonar",
  "arquivos_alterados",
  "explicacao_fitness",
  "comprovacao_criterios",
  "mensagem_pr",
  "aula_codigo",
  "video_demonstracao",
  "relatorio_produtividade",
  "pr_aberto",
]);

export const Produtor = TipoAtor.extract(["agente", "fabriquinha"]);

/** Um anexo guardado por conteúdo (F2 §5.1); `nome` é o nome original, que o `dados` referencia. */
export const ArquivoEvidencia = z.object({
  nome: z.string().min(1).max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});

/**
 * Metadados da evidência (F1 §3.8). `dados` e `arquivos` vêm já validados pelo F3; o domínio só os carrega, para
 * que C17 grave metadados e conteúdo na mesma transação pelo caminho único do `comIssue`.
 */
export const Evidencia = z.object({
  id: Id,
  ticket: Id,
  tipo: TipoEvidencia,
  produtor: Produtor,
  aprovada: z.boolean().optional(),
  dados: z.record(z.string(), z.json()),
  arquivos: z.array(ArquivoEvidencia).refine(unicoPor("nome"), "nome de anexo repetido"),
  em: Instante,
});

export const StatusProposta = z.enum(["pendente", "aceita", "recusada"]);

/**
 * Proposta de issue (C23): fato preso ao ticket de registro ou desenho que a IA fez, fora do agregado. O Auditor a
 * aceita ou recusa (C24); o aceite cria a issue `issueCriada`.
 */
export const PropostaIssue = z.object({
  id: Id,
  ticket: Id,
  titulo: Titulo,
  mensagem: Markdown.refine((t) => t.trim() !== "", "mensagem vazia"),
  arquivos: z.number().int().nonnegative(),
  status: StatusProposta,
  issueCriada: Id.optional(),
  em: Instante,
  decididaEm: Instante.optional(),
});

export type Ator = z.infer<typeof Ator>;
export type TipoIssue = z.infer<typeof TipoIssue>;
export type Issue = z.infer<typeof Issue>;
export type Ticket = z.infer<typeof Ticket>;
export type ModoExecucao = z.infer<typeof ModoExecucao>;
export type Execucao = z.infer<typeof Execucao>;
export type Decisao = z.infer<typeof Decisao>;
export type TipoEvidencia = z.infer<typeof TipoEvidencia>;
export type Produtor = z.infer<typeof Produtor>;
export type ArquivoEvidencia = z.infer<typeof ArquivoEvidencia>;
export type Evidencia = z.infer<typeof Evidencia>;
export type PropostaIssue = z.infer<typeof PropostaIssue>;

/** A issue com o que pertence a ela (F1 §5). */
export interface Agregado {
  readonly issue: Issue;
  readonly tickets: readonly Ticket[];
  /** As execuções dos tickets desta issue. */
  readonly execucoes: readonly Execucao[];
  readonly decisoes: readonly Decisao[];
  /** As evidências dos tickets desta issue. */
  readonly evidencias: readonly Evidencia[];
}

/**
 * Instante, IDs e fatos externos que o comando consulta. São funções para que só rode a consulta que o comando
 * usa; o F2 as responde dentro da transação do comando (F2 §3.5).
 */
export interface Contexto {
  readonly agora: Instante;
  novoId(tipo: TipoId): Id;
  projeto(nome: string): Projeto | undefined;
  issueExiste(id: Id): boolean;
  /** Issues de que `id` depende, direta ou indiretamente. */
  alcancaveis(id: Id): readonly Id[];
  /** Todas as dependências da issue estão `concluida`. */
  depsConcluidas(issue: Id): boolean;
  /**
   * O ticket tem commit registrado pelo F5 (C7 do desenvolvimento, F1 §5.1). Fora da lista do F2 §3.5: o commit
   * fica fora do agregado, e o F5 o grava na mesma transação, logo antes do C7 (F5 §4, passo 4).
   */
  temCommit(ticket: Id): boolean;
  /**
   * O estado do PR da issue que o F5 acabou de ler na plataforma, logo antes da transação (F5 §5.2). Só o gate do PR
   * (C16) o lê e o informa: a Fabriquinha não confia num estado lido antes.
   */
  readonly estadoPR?: EstadoDoPR;
  /**
   * O conflito e os checks falhos do PR que o F5 acabou de ler na plataforma, depois de publicá-lo (F5 §5.1, passo 4).
   * Só o encerramento (C7) o lê: a Fabriquinha não confia numa verificação feita antes.
   */
  readonly problemasPR?: ProblemasDoPR;
}

/** O PR na plataforma (F5 §5.2): mergeado é o PR aceito; fechado é sem merge. */
export type EstadoDoPR = "aberto" | "mergeado" | "fechado";

/** O que impede o PR de ir ao gate (F5 §5.1, passo 4): conflito com a base e checks de CI que terminaram falhos. */
export interface ProblemasDoPR {
  conflito: boolean;
  checksFalhos: readonly { nome: string; url?: string }[];
}

/** Nome gravado na tabela `comando` (F6 §7) para cada comando aplicado por `comIssue`. */
export type NomeComando =
  | "editarIssue"
  | "adicionarDependencia"
  | "removerDependencia"
  | "iniciarExecucao"
  | "terminarExecucao"
  | "falharTicket"
  | "devolverTicket"
  | "reabrirTicket"
  | "definirModeloTicket"
  | "iniciarConsulta"
  | "registrarEvidencia"
  | "decidirRegistro"
  | "concluirTicket"
  | "adicionarTicketDesenvolvimento"
  | "editarTicket"
  | "removerTicket"
  | "decidirDesenho"
  | "registrarDecisaoRevisao"
  | "enviarParaAprovacao"
  | "decidirPR"
  | "cancelarIssue"
  | "proporIssue"
  | "decidirProposta";

/** Erro da execução que o cancelamento da issue terminou (C22). */
export const CANCELADA = "issue cancelada pelo Auditor";

export const rotuloIssue = (ag: Agregado): string => `I-${String(ag.issue.id)}`;

/** Issue cancelada não muda mais: a F2 recusa qualquer comando sobre ela. */
export function exigirNaoCancelada(ag: Agregado): void {
  if (ag.issue.canceladaEm !== undefined) {
    throw new ErroDeRegra(`a ${rotuloIssue(ag)} está cancelada e não muda mais`, "registre uma nova issue se precisar");
  }
}

export function exigirAuditor(ator: Ator, acao: string): void {
  if (ator.tipo !== "auditor") throw new ErroDeEscopo(`só o Auditor pode ${acao}`, "peça ao Auditor pelo web");
}

export function exigirFabriquinha(ator: Ator, acao: string): void {
  if (ator.tipo !== "fabriquinha") {
    throw new ErroDeEscopo(`só a Fabriquinha pode ${acao}`, "ela faz isso sozinha ao executar o ticket");
  }
}

/** O ticket de registro da issue que a IA externa registrou e ainda está no registro: o que ela pode mudar. */
export const registroExterno = (ag: Agregado): Ticket | undefined =>
  ag.issue.fase === "registro"
    ? ag.tickets.find((t) => t.etapa === "registro" && t.origem === "externo" && t.status === "em_execucao")
    : undefined;

/** A IA externa só age no registro da issue que ela registrou (`fabriquinha necessidade`). */
export function exigirRegistroExterno(ag: Agregado, acao: string): Ticket {
  const ticket = registroExterno(ag);
  if (!ticket) {
    throw new ErroDeEscopo(
      `a IA externa não pode ${acao}`,
      `ela só age no registro das issues que registrou, e a ${rotuloIssue(ag)} não é uma delas ou já saiu do registro`,
    );
  }
  return ticket;
}

/**
 * Auditor sempre. Agente só pelo próprio ticket, se ele for desta issue e de uma das `etapas`, e só enquanto a
 * execução dele está em andamento (F1 §3.2). Consulta não conta: ela pergunta, não altera (F4 §6.5). IA externa só
 * no registro que ela registrou, quando o registro está entre as `etapas`.
 */
export function exigirAuditorOuAgente(ag: Agregado, ator: Ator, etapas: readonly Etapa[], acao: string): void {
  if (ator.tipo === "auditor") return;
  if (ator.tipo === "externo" && etapas.includes("registro")) {
    exigirRegistroExterno(ag, acao);
    return;
  }
  const quem = `o Auditor ou o agente de ${etapas.join(", ")} da ${rotuloIssue(ag)}`;
  if (ator.tipo !== "agente") {
    throw new ErroDeEscopo(
      `${ator.tipo === "fabriquinha" ? "a Fabriquinha" : "a IA externa"} não pode ${acao}`,
      `quem pode é ${quem}`,
    );
  }
  const ticket = `T-${String(ator.ticket)}`;
  if (!ag.tickets.some((t) => t.id === ator.ticket && etapas.includes(t.etapa))) {
    throw new ErroDeEscopo(`o agente de ${ticket} não pode ${acao}`, `quem pode é ${quem}`);
  }
  exigirExecucaoEmAndamento(ag, ator, acao);
}

/** O agente só age enquanto a execução dele está em andamento e não é consulta (F1 §3.2, F4 §6.5). */
export function exigirExecucaoEmAndamento(ag: Agregado, ator: Ator & { tipo: "agente" }, acao: string): void {
  const execucao = `E-${String(ator.execucao)}`;
  const emAndamento = ag.execucoes.find(
    (e) => e.id === ator.execucao && e.ticket === ator.ticket && e.resultado === "em_andamento",
  );
  if (!emAndamento) throw new ErroDeEscopo(`a execução ${execucao} já terminou`, "peça ao Auditor uma nova execução");
  if (emAndamento.modo === "consulta") {
    throw new ErroDeEscopo(
      `a execução ${execucao} é uma consulta, que só pergunta e não pode ${acao}`,
      "peça ao Auditor que faça a mudança",
    );
  }
}
