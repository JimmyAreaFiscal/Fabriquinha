// Sessões dos tickets da demanda para o Histórico e para o contador da navegação (comparacao-sdlc-implementacao.md
// §9.1): lê `sessao` e o estado que o chat calcula; as sessões migradas pelo backfill entram como as novas.
import type { DatabaseSync } from "node:sqlite";
import type { ProcessoDoTrabalho } from "../../../modulos/trabalho_agentico/nucleo/trabalho_agentico.ts";
import type { EtapaTicket } from "../../../modulos/etapas/catalogo.ts";
import { encontrado } from "../../../modulos/compartilhado/nucleo/erros.ts";
import type { Resultado, SessaoDeDemanda } from "../../contrato/sessoes/historico.ts";
import { trabalhosComTituloDaDemanda } from "../../../modulos/trabalho_agentico/armazenamento/historico_demanda.ts";
import { cabecalhoDaSessao } from "../../../modulos/sdlc/aplicacao/sessoes/sessoes_demanda.ts";

export type { Resultado, SessaoDeDemanda };

interface FiltroSessoesDemanda {
  escopo: "ativas" | "historico";
  projeto?: string;
  demanda?: string;
  etapa?: EtapaTicket;
}

/**
 * As sessões do escopo (terminadas no `historico`, as demais em `ativas`), da que está assim há mais tempo para a
 * mais recente.
 * ponytail: calcula o estado de cada sessão pelo mesmo caminho do chat; filtrar o histórico no SQL quando pesar.
 */
export function sessoesDeDemanda(banco: DatabaseSync, filtro: FiltroSessoesDemanda): SessaoDeDemanda[] {
  const linhas = trabalhosComTituloDaDemanda(banco, filtro);
  return linhas
    .map(({ id, titulo }): SessaoDeDemanda => {
      const { sessao, execucoes, ...resto } = encontrado(
        cabecalhoDaSessao(banco, id),
        "a sessão não existe",
        "confira o banco",
      );
      // O cabeçalho já recusa a sessão sem execução.
      const [primeira, ultima] = [execucoes[0], execucoes.at(-1)] as [ProcessoDoTrabalho, ProcessoDoTrabalho];
      return {
        sessao: id,
        projeto: sessao.projeto,
        demanda: resto.demanda,
        titulo,
        ...(resto.rodada && { rodada: resto.rodada }),
        ticket: resto.ticket,
        etapa: resto.etapa,
        modo: sessao.modo,
        ...(sessao.modelo && { modelo: sessao.modelo }),
        estado: sessao.estado,
        ...(sessao.pendencia && { pendencia: sessao.pendencia }),
        desde: sessao.desde,
        inicio: primeira.inicio,
        ...(ultima.fim && { fim: ultima.fim }),
        resultado: ultima.fim && ultima.falha ? "falha" : "concluida",
      };
    })
    .filter((s) => (s.estado === "terminada") === (filtro.escopo === "historico"))
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}
