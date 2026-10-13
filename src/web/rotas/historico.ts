// Rota das sessões (F7 §4.2; F4 §5.3): as ativas, para o Início e a navegação, e as terminadas do Histórico, cada uma
// com o título da issue, o resultado e o custo, que a lista mostra por linha. A prévia lê a sessão pela rota do chat.
import { z } from "zod";
import { Etapa } from "../../dominio/primitivos.ts";
import { noHistorico } from "../../execucao/historico.ts";
import { sessoes } from "../../execucao/sessoes.ts";
import type { Rota } from "../rotas.ts";

export type { Resultado, SessaoDoHistorico } from "../../execucao/historico.ts";

const FiltroSessoes = z.object({
  escopo: z.enum(["ativas", "historico"]),
  projeto: z.string().min(1).optional(),
  issue: z.coerce.number().int().positive().optional(),
  etapa: Etapa.optional(),
});

export const ROTAS_DO_HISTORICO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes",
    tratar: async ({ banco, query }) => {
      const filtro = FiltroSessoes.parse(Object.fromEntries(query));
      const lista = await sessoes(banco, filtro);
      return filtro.escopo === "historico" ? noHistorico(banco, lista) : lista;
    },
  },
];
