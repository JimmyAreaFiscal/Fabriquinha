// O contrato da API do agente (`/api/agente/*`): as entradas e as respostas dos sete comandos do agente e o erro, no
// formato do CLI do agente. Só tipos e schemas; o endpoint e o cliente empacotado compartilham este arquivo.
import { z } from "zod";
import { TipoEvidencia } from "../../qualidade/nucleo/evidencias/evidencia.ts";
import { Projeto } from "../../ambiente/nucleo/projeto.ts";

const EnderecoDoTicket = z.string().min(1);
const Veredito = z.enum(["atende", "nao_atende"]);

/**
 * `GET /api/agente/projeto`: o projeto da demanda do agente.
 */
export const RespostaProjetoVer = Projeto;
export type RespostaProjetoVer = z.infer<typeof RespostaProjetoVer>;

/**
 * `GET /api/agente/demandas/:demanda`: a demanda (com a origem como o CLI a mostra), as rodadas, as decisões e os tickets.
 */
export const RespostaDemandaVer = z.object({
  demanda: z.record(z.string(), z.unknown()),
  rodadas: z.array(z.record(z.string(), z.unknown())),
  decisoes: z.array(z.record(z.string(), z.unknown())),
  tickets: z.array(z.record(z.string(), z.unknown())),
});
export type RespostaDemandaVer = z.infer<typeof RespostaDemandaVer>;

/**
 * `GET /api/agente/tickets/:ticket`: o próprio ticket, pelo endereço público, com o motivo quando falhou.
 */
export const RespostaTicketVer = z.looseObject({
  ticket: EnderecoDoTicket,
  rodada: z.string().optional(),
  motivo: z.string().optional(),
});
export type RespostaTicketVer = z.infer<typeof RespostaTicketVer>;

/**
 * `POST /api/agente/tickets`: o ticket corretivo na rodada do agente.
 */
export const PedidoTicketCriar = z.object({ rodada: z.string().min(1), titulo: z.string().optional() });
export type PedidoTicketCriar = z.infer<typeof PedidoTicketCriar>;

/**
 * Os tickets que nasceram do `PedidoTicketCriar`.
 */
export const RespostaTicketCriar = z.object({ rodada: z.string(), tickets: z.array(EnderecoDoTicket) });
export type RespostaTicketCriar = z.infer<typeof RespostaTicketCriar>;

/**
 * `POST /api/agente/revisoes`: o veredito do agente sobre o próprio ticket de revisão. `correcoes` e `plano` chegam já
 * lidos (o cliente lê o arquivo ou o stdin); só a presença conta na recusa de `aprovar` com opções a mais.
 */
export const PedidoRevisaoDecidir = z.object({
  ticket: EnderecoDoTicket,
  veredito: z.string(),
  motivo: z.string().optional(),
  correcoes: z.unknown().optional(),
  plano: z.unknown().optional(),
});
export type PedidoRevisaoDecidir = z.infer<typeof PedidoRevisaoDecidir>;

/**
 * A decisão registrada pelo `PedidoRevisaoDecidir`.
 */
export const RespostaRevisaoDecidir = z.object({
  ticket: EnderecoDoTicket,
  rodada: z.string().optional(),
  resultado: z.enum(["aprovado", "reprovado"]),
});
export type RespostaRevisaoDecidir = z.infer<typeof RespostaRevisaoDecidir>;

/**
 * `GET /api/agente/evidencias/:tipo/schema`: o schema JSON dos dados do tipo e a regra dos arquivos.
 */
export const RespostaEvidenciaSchema = z.object({ dados: z.record(z.string(), z.unknown()), arquivos: z.unknown() });
export type RespostaEvidenciaSchema = z.infer<typeof RespostaEvidenciaSchema>;

/** Um anexo já enviado: o caminho no Ambiente do agente e o SHA-256 dos bytes, que `POST /api/agente/anexos` conferiu. */
const AnexoDoPedido = z.object({
  caminho: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * `POST /api/agente/anexos?caminho=<caminho no Ambiente>&sha256=<hex>`: o corpo é o arquivo, em `application/octet-stream`.
 * O serviço lê em blocos e só aceita se o SHA-256 dos bytes for o declarado.
 */
export const ParametrosDoAnexoEnviado = AnexoDoPedido;
export type ParametrosDoAnexoEnviado = z.infer<typeof ParametrosDoAnexoEnviado>;

/** O anexo que o serviço conferiu: o `PedidoEvidenciaAdd` o cita pelo mesmo caminho e SHA-256. */
export const RespostaAnexoEnviado = AnexoDoPedido;
export type RespostaAnexoEnviado = z.infer<typeof RespostaAnexoEnviado>;

/**
 * `POST /api/agente/evidencias`: a evidência do próprio ticket; `dados` chega já lido e cada anexo cita um já enviado.
 */
export const PedidoEvidenciaAdd = z.object({
  ticket: EnderecoDoTicket,
  tipo: z.string(),
  dados: z.unknown().optional(),
  anexos: z.array(AnexoDoPedido).default([]),
});
export type PedidoEvidenciaAdd = z.infer<typeof PedidoEvidenciaAdd>;

/**
 * A evidência gravada pelo `PedidoEvidenciaAdd`.
 */
export const RespostaEvidenciaAdd = z.object({
  ticket: EnderecoDoTicket,
  tipo: TipoEvidencia,
  veredito: Veredito.optional(),
});
export type RespostaEvidenciaAdd = z.infer<typeof RespostaEvidenciaAdd>;

/**
 * O erro de qualquer endpoint: a `mensagem` é o que o CLI imprime no stderr (já com a orientação entre parênteses),
 * `orientacao` é essa orientação à parte e `codigo_de_saida` o código do CLI (1 erro, 2 uso inválido).
 */
export const ErroDaApiDoAgente = z.object({
  mensagem: z.string(),
  orientacao: z.string().optional(),
  codigo_de_saida: z.union([z.literal(1), z.literal(2)]),
});
export type ErroDaApiDoAgente = z.infer<typeof ErroDaApiDoAgente>;
