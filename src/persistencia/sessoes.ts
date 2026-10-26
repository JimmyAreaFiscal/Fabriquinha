// Repositório de sessões, execuções e usos por modelo (comparacao-sdlc §7.3). As funções puras de dominio/sessoes.ts
// operam sobre o que foi lido; `comSessoesDoTicket` é a única forma de mutar e grava por upsert, nunca apaga.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type { TicketRef } from "../dominio/demanda.ts";
import { ExecucaoSessao, Sessao, UsoModeloExecucao } from "../dominio/sessoes.ts";
import { escrever } from "./banco.ts";

export interface EstadoSessoes {
  sessoes: Sessao[];
  execucoes: ExecucaoSessao[];
  usos: UsoModeloExecucao[];
}

type Linha = Record<string, SQLInputValue>;

/** `ticketId` nulo carrega a demanda inteira. */
function carregar(banco: DatabaseSync, demandaId: string, ticketId: number | null): EstadoSessoes {
  const filtro = { demanda_id: demandaId, ticket_id: ticketId };
  const dasSessoes = `sessao_id IN (SELECT id FROM sessao WHERE demanda_id = $demanda_id AND ($ticket_id IS NULL OR ticket_id = $ticket_id))`;
  const ler = (sql: string) => banco.prepare(sql).all(filtro);
  const propria = !banco.isTransaction; // dentro de `escrever` a leitura já é parte da transação
  if (propria) banco.exec("BEGIN");
  try {
    return {
      sessoes: z
        .array(Sessao)
        .parse(
          ler(
            "SELECT * FROM sessao WHERE demanda_id = $demanda_id AND ($ticket_id IS NULL OR ticket_id = $ticket_id) ORDER BY rowid",
          ),
        ),
      execucoes: z.array(ExecucaoSessao).parse(
        ler(`SELECT * FROM execucao_sessao WHERE ${dasSessoes} ORDER BY rowid`).map((e) => ({
          ...e,
          falha: e.falha === 1,
        })),
      ),
      usos: z.array(UsoModeloExecucao).parse(
        // custo NULL é desconhecido: volta sem a chave, nunca como zero.
        ler(
          `SELECT * FROM uso_modelo_execucao WHERE execucao_id IN (SELECT id FROM execucao_sessao WHERE ${dasSessoes}) ORDER BY rowid`,
        ).map(({ custo, ...u }) => (custo === null ? u : { ...u, custo })),
      ),
    };
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}

export const carregarSessoesDoTicket = (banco: DatabaseSync, ref: z.infer<typeof TicketRef>): EstadoSessoes =>
  carregar(banco, ref.demanda_id, ref.ticket_id);

export const carregarSessoesDaDemanda = (banco: DatabaseSync, demandaId: string): EstadoSessoes =>
  carregar(banco, demandaId, null);

function upsert(banco: DatabaseSync, tabela: string, chave: readonly string[], linhas: Linha[]): void {
  for (const linha of linhas) {
    const colunas = Object.keys(linha);
    const sets = colunas.filter((c) => !chave.includes(c)).map((c) => `${c} = excluded.${c}`);
    banco
      .prepare(
        `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map((c) => "$" + c).join(", ")})
         ON CONFLICT (${chave.join(", ")}) DO UPDATE SET ${sets.join(", ")}`,
      )
      .run(linha);
  }
}

/** Carrega as sessões do ticket, aplica a transição pura e grava o resultado numa transação só (erro desfaz tudo). */
export const comSessoesDoTicket = (
  banco: DatabaseSync,
  ref: z.infer<typeof TicketRef>,
  transicao: (estado: EstadoSessoes) => EstadoSessoes,
): EstadoSessoes =>
  escrever(banco, () => {
    const depois = transicao(carregarSessoesDoTicket(banco, ref));
    upsert(banco, "sessao", ["id"], depois.sessoes);
    upsert(
      banco,
      "execucao_sessao",
      ["id"],
      depois.execucoes.map((e) => ({ ...e, fim: e.fim ?? null, falha: Number(e.falha) })),
    );
    upsert(
      banco,
      "uso_modelo_execucao",
      ["execucao_id", "modelo_provedor", "modelo_nome"],
      depois.usos.map((u) => ({ ...u, custo: u.custo ?? null })),
    );
    return depois;
  });
