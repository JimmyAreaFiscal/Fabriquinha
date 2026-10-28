// Ator, enums e o agregado no formato da issue (F1 §3.2, §3.4, §5): as transições da demanda usam o ator e os enums, e as
// regras cruzadas das evidências e a aula leem a demanda nesse formato (`comoLegado`).
import { z } from "zod";
import { ErroDeEscopo } from "./erros.ts";
import { Etapa, Fase, Id, Instante, Markdown, Modelo, Motivo, Slug, Titulo, unicoPor } from "./primitivos.ts";

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

/** Os atores sem dados: o Auditor e a própria Fabriquinha. */
export const AUDITOR: Ator = { tipo: "auditor" };
export const FABRIQUINHA: Ator = { tipo: "fabriquinha" };

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

/** O que impede o PR de ir ao gate (F5 §5.1, passo 4): conflito com a base e checks de CI que terminaram falhos. */
export interface ProblemasDoPR {
  conflito: boolean;
  checksFalhos: readonly { nome: string; url?: string }[];
}

export function exigirAuditor(ator: Ator, acao: string): void {
  if (ator.tipo !== "auditor") throw new ErroDeEscopo(`só o Auditor pode ${acao}`, "peça ao Auditor pelo web");
}

export function exigirFabriquinha(ator: Ator, acao: string): void {
  if (ator.tipo !== "fabriquinha") {
    throw new ErroDeEscopo(`só a Fabriquinha pode ${acao}`, "ela faz isso sozinha ao executar o ticket");
  }
}
