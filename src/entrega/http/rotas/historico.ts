// Rota das sessões (F7 §4.2): as ativas, para a navegação, e as terminadas do Histórico, das tabelas da demanda
// (comparacao-sdlc-implementacao.md §9.1). A prévia lê a sessão pela rota do chat.
import { z } from "zod";
import { ErroDeRegra } from "../../../nucleo/erros.ts";
import { Endereco } from "../../../nucleo/item_de_trabalho.ts";
import { EtapaTicket } from "../../../nucleo/primitivos.ts";
import { sessoesDeDemanda } from "../../../aplicacao/historico_demanda.ts";
import type { Rota } from "../rotas.ts";

export type { Resultado, SessaoDeDemanda } from "../../../aplicacao/historico_demanda.ts";

const FiltroSessoes = z.object({
  escopo: z.enum(["ativas", "historico"]),
  projeto: z.string().min(1).optional(),
  demanda: z.string().optional(),
  etapa: EtapaTicket.optional(),
});

/** O id da demanda do filtro, que só pode ser o endereço de uma demanda (`I-12` ou `12`). */
function demandaDoEndereco(texto: string): string {
  const endereco = Endereco.ler(texto);
  if (endereco.rodada_id !== undefined || endereco.ticket_id !== undefined) {
    throw new ErroDeRegra(`${texto} não é o endereço de uma demanda`, "use I-n, como I-206");
  }
  return endereco.demanda_id;
}

export const ROTAS_DO_HISTORICO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes",
    tratar: ({ banco, query }) => {
      const { demanda, ...filtro } = FiltroSessoes.parse(Object.fromEntries(query));
      return sessoesDeDemanda(banco, {
        ...filtro,
        ...(demanda !== undefined && { demanda: demandaDoEndereco(demanda) }),
      });
    },
  },
];
