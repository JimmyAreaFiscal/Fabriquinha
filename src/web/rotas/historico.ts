// Rota das sessões (F7 §4.2): as ativas, para a navegação, e as terminadas do Histórico, das tabelas da demanda
// (comparacao-sdlc-implementacao.md §9.1). A prévia lê a sessão pela rota do chat.
import { z } from "zod";
import { EtapaTicket } from "../../dominio/primitivos.ts";
import { sessoesDeDemanda } from "../../execucao/historico_demanda.ts";
import type { Rota } from "../rotas.ts";

export type { Resultado, SessaoDeDemanda } from "../../execucao/historico_demanda.ts";

const FiltroSessoes = z.object({
  escopo: z.enum(["ativas", "historico"]),
  projeto: z.string().min(1).optional(),
  demanda: z
    .string()
    .regex(/^I-[1-9][0-9]*$/)
    .optional(),
  etapa: EtapaTicket.optional(),
});

export const ROTAS_DO_HISTORICO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes",
    tratar: ({ banco, query }) => sessoesDeDemanda(banco, FiltroSessoes.parse(Object.fromEntries(query))),
  },
];
