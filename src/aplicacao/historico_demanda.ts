// Sessões dos tickets da demanda para o Histórico e para o contador da navegação (comparacao-sdlc-implementacao.md
// §9.1): lê `sessao` e o estado que o chat calcula; as sessões migradas pelo backfill entram como as novas.
import type { DatabaseSync } from "node:sqlite";
import type { ModoTrabalho } from "../nucleo/trabalho_agentico.ts";
import type { ProcessoDoTrabalho } from "../nucleo/trabalho_agentico.ts";
import type { Modelo } from "../nucleo/configuracao_agente.ts";
import type { EtapaTicket, Instante } from "../nucleo/primitivos.ts";
import { encontrado } from "../nucleo/erros.ts";
import { trabalhosComTituloDaDemanda } from "../armazenamento/historico_demanda.ts";
import { cabecalhoDaSessao, type Estado, type PendenciaDoChat } from "./sessoes_demanda.ts";

export type Resultado = "concluida" | "falha";

/** Uma sessão de demanda com o estado calculado; demanda, rodada e ticket pelo endereço público. */
export interface SessaoDeDemanda {
  sessao: string;
  projeto: string;
  demanda: string;
  titulo: string;
  rodada?: string;
  ticket: string;
  etapa: EtapaTicket;
  modo: ModoTrabalho;
  modelo?: Modelo;
  estado: Estado;
  /** A Pendência que segura a sessão enquanto ela espera o Auditor. */
  pendencia?: PendenciaDoChat;
  /** Desde quando a sessão está neste estado. */
  desde: Instante;
  inicio: Instante;
  fim?: Instante;
  /** O da última execução; sem fim, a sessão ainda roda e vale `concluida`. */
  resultado: Resultado;
}

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
