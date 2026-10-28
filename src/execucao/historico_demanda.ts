// Sessões dos tickets da demanda para o Histórico e para o contador da navegação (comparacao-sdlc-implementacao.md
// §9.1): lê `sessao` e o estado que o chat calcula; as sessões migradas pelo backfill entram como as novas.
import type { DatabaseSync } from "node:sqlite";
import type { ModoExecucao } from "../dominio/agregado.ts";
import type { ExecucaoSessao } from "../dominio/sessoes.ts";
import type { EtapaTicket, Instante, Modelo } from "../dominio/primitivos.ts";
import { encontrado } from "../dominio/erros.ts";
import { cabecalhoDaDemanda, type MotivoDemanda } from "./sessoes_demanda.ts";
import type { Estado } from "./sessoes.ts";

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
  modo: ModoExecucao;
  modelo?: Modelo;
  estado: Estado;
  motivo?: MotivoDemanda;
  /** Desde quando a sessão está neste estado. */
  desde: Instante;
  inicio: Instante;
  fim?: Instante;
  /** O da última execução; sem fim, a sessão ainda roda e vale `concluida`. */
  resultado: Resultado;
}

export interface FiltroSessoesDemanda {
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
  const linhas = banco
    .prepare(
      `SELECT s.id, d.titulo FROM sessao s
         JOIN demanda d ON d.id = s.demanda_id
         JOIN ticket_demanda t ON t.demanda_id = s.demanda_id AND t.ticket_id = s.ticket_id
        WHERE ($projeto IS NULL OR d.projeto = $projeto)
          AND ($demanda IS NULL OR d.id = $demanda)
          AND ($etapa IS NULL OR t.etapa = $etapa)
        ORDER BY s.rowid`,
    )
    .all({ projeto: filtro.projeto ?? null, demanda: filtro.demanda ?? null, etapa: filtro.etapa ?? null }) as {
    id: string;
    titulo: string;
  }[];
  return linhas
    .map(({ id, titulo }): SessaoDeDemanda => {
      const { sessao, execucoes, ...resto } = encontrado(
        cabecalhoDaDemanda(banco, id),
        "a sessão não existe",
        "confira o banco",
      );
      // O cabeçalho já recusa a sessão sem execução.
      const [primeira, ultima] = [execucoes[0], execucoes.at(-1)] as [ExecucaoSessao, ExecucaoSessao];
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
        ...(sessao.motivo && { motivo: sessao.motivo }),
        desde: sessao.desde,
        inicio: primeira.inicio,
        ...(ultima.fim && { fim: ultima.fim }),
        resultado: ultima.fim && ultima.falha ? "falha" : "concluida",
      };
    })
    .filter((s) => (s.estado === "terminada") === (filtro.escopo === "historico"))
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}
