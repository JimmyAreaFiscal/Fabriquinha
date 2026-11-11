// O contrato da API do chat da sessão de ticket da demanda: a entrada de cada rota e o corpo da resposta JSON.
// São só tipos e schemas: quem monta o valor é a aplicação, quem o valida na saída é o teste de rota.
import { z } from "zod";
import { EtapaTicket, Instante, Modelo, ModoTrabalho } from "../../compartilhado/nucleo/primitivos.ts";
import { ProcessoDoTrabalho } from "../../trabalho_agentico/nucleo/trabalho_agentico.ts";

const Texto = z.string();

/** Uma entrada do JSONL do pi; o prompt montado pela Fabriquinha (F4 §6.3) vem com `fabriquinha`. */
const EntradaDoChat = z.looseObject({ fabriquinha: z.literal(true).optional() });

/** Um diálogo de extensão pendente: o pedido do pi, quando chegou e, se o pi o resolve sozinho, quando expira. */
const DialogoDoChat = z.looseObject({ em: Texto, expiraEm: Texto.optional() });

/** A Pendência como o chat a leva: `item` pelo endereço público (D09). */
const PendenciaDoChat = z.object({
  tipo: z.enum([
    "gate_humano",
    "item_bloqueado",
    "dialogo_do_agente",
    "revisao_parada",
    "acao_externa",
    "despacho_parado",
  ]),
  item: Texto,
  motivo: Texto,
  acao_esperada: z.enum(["decidir_gate", "reabrir_com_instrucao", "responder", "integrar_na_plataforma", "executar"]),
  desde: Instante,
});

const SessaoDoChat = z.object({
  sessao: Texto,
  projeto: Texto,
  modo: ModoTrabalho,
  execucao: Texto,
  modelo: Modelo.optional(),
  estado: z.enum(["rodando", "aguardando_humano", "terminada"]),
  /** A Pendência que segura a sessão enquanto ela espera o Auditor. */
  pendencia: PendenciaDoChat.optional(),
  desde: Instante,
  dialogos: z.array(DialogoDoChat),
});

/** A execução como o chat a mostra: o motivo da falha é o da Tentativa que ela abriu. */
const ExecucaoDoChat = ProcessoDoTrabalho.extend({ motivo: Texto.optional() });

/**
 * O chat de uma sessão de ticket da demanda: o cabeçalho com `origem: "demanda"` e a conversa.
 *
 * @testes a rota do chat passa a consumi-lo; o teste do contrato o confere
 */
export const DadosDoChatDemanda = z.object({
  origem: z.literal("demanda"),
  sessao: SessaoDoChat,
  demanda: Texto,
  rodada: Texto.optional(),
  ticket: Texto,
  etapa: EtapaTicket,
  /** O motivo da última Tentativa do ticket, na falha. */
  erro: Texto.optional(),
  /** As execuções da sessão, em ordem, cada uma com o motivo da Tentativa que ela abriu, se essa falhou. */
  execucoes: z.array(ExecucaoDoChat),
  pendencias: z.array(PendenciaDoChat),
  conversa: z.array(EntradaDoChat),
});
export type DadosDoChatDemanda = z.infer<typeof DadosDoChatDemanda>;

/** @testes a rota do chat passa a consumi-lo; o teste do contrato o confere */
export const NovaMensagemDoChat = z.strictObject({
  texto: z.string().trim().min(1),
  modo: z.enum(["prompt", "steer", "follow_up"]),
});

/**
 * `{ valor }`, `{ confirmado }` ou `{ cancelado: true }`, no formato do `extension_ui_response` do pi.
 *
 * @testes a rota do chat passa a consumi-lo; o teste do contrato o confere
 */
export const RespostaDoDialogo = z.union([
  z.strictObject({ valor: z.string() }).transform((r) => ({ value: r.valor })),
  z.strictObject({ confirmado: z.boolean() }).transform((r) => ({ confirmed: r.confirmado })),
  z.strictObject({ cancelado: z.literal(true) }).transform(() => ({ cancelled: true as const })),
]);
