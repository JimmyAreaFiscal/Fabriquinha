// O contrato da API do Histórico: o filtro das sessões de demanda e o corpo da resposta.
// São só tipos e schemas: quem monta o valor é a consulta, quem o valida na saída é o teste de rota.
import { z } from "zod";
import { Modelo } from "../../execucao/nucleo/configuracao_agente.ts";
import { EtapaTicket, Instante } from "../../compartilhado/nucleo/primitivos.ts";
import { ModoTrabalho } from "../../execucao/nucleo/trabalho_agentico.ts";

/** O escopo escolhe as ativas ou as terminadas; `demanda` é o endereço de uma demanda (`I-12` ou `12`). */
export const FiltroDeSessoes = z.object({
  escopo: z.enum(["ativas", "historico"]),
  projeto: z.string().min(1).optional(),
  demanda: z.string().optional(),
  etapa: EtapaTicket.optional(),
});
export type FiltroDeSessoes = z.infer<typeof FiltroDeSessoes>;

const ResultadoDaSessao = z.enum(["concluida", "falha"]);
export type Resultado = z.infer<typeof ResultadoDaSessao>;

/** A Pendência que segura a sessão enquanto ela espera o Auditor, com o item pelo endereço público. */
const PendenciaDaSessao = z.object({
  tipo: z.enum([
    "gate_humano",
    "item_bloqueado",
    "dialogo_do_agente",
    "revisao_parada",
    "acao_externa",
    "despacho_parado",
  ]),
  item: z.string(),
  motivo: z.string(),
  acao_esperada: z.enum(["decidir_gate", "reabrir_com_instrucao", "responder", "integrar_na_plataforma", "executar"]),
  desde: Instante,
});

/** Uma sessão de demanda com o estado calculado; demanda, rodada e ticket pelo endereço público. */
export const SessaoDeDemanda = z.object({
  sessao: z.string(),
  projeto: z.string(),
  demanda: z.string(),
  titulo: z.string(),
  rodada: z.string().optional(),
  ticket: z.string(),
  etapa: EtapaTicket,
  modo: ModoTrabalho,
  modelo: Modelo.optional(),
  estado: z.enum(["rodando", "aguardando_humano", "terminada"]),
  pendencia: PendenciaDaSessao.optional(),
  /** Desde quando a sessão está neste estado. */
  desde: Instante,
  inicio: Instante,
  fim: Instante.optional(),
  /** O da última execução; sem fim, a sessão ainda roda e vale `concluida`. */
  resultado: ResultadoDaSessao,
});
export type SessaoDeDemanda = z.infer<typeof SessaoDeDemanda>;
