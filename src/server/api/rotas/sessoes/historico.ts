// Rota das sessões (F7 §4.2): as ativas, para a navegação, e as terminadas do Histórico, das tabelas da demanda
// (comparacao-sdlc-implementacao.md §9.1). A prévia lê a sessão pela rota do chat.
import { consultarHistorico } from "../../../consultas/sessoes/historico.ts";
import { FiltroDeSessoes, SessaoDeDemanda } from "../../../contrato/sessoes/historico.ts";
import type { Rota } from "../../rotas.ts";

export type { Resultado, SessaoDeDemanda } from "../../../consultas/sessoes/historico_demanda.ts";

export const ROTAS_DO_HISTORICO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes",
    tratar: ({ banco, query }) => consultarHistorico(banco, FiltroDeSessoes.parse(Object.fromEntries(query))),
    resposta: SessaoDeDemanda.array(),
  },
];
