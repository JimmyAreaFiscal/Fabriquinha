// Repositório de sessões, execuções e usos por modelo (comparacao-sdlc §7.3). As funções puras de dominio/sessoes.ts
// operam sobre o que foi lido; `comSessoesDoTicket` é a única forma de mutar e grava por upsert, nunca apaga.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type { TicketRef } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { ExecucaoSessao, Sessao, UsoModeloExecucao } from "../dominio/sessoes.ts";
import { escrever } from "./banco.ts";

export interface EstadoSessoes {
  sessoes: Sessao[];
  execucoes: ExecucaoSessao[];
  usos: UsoModeloExecucao[];
}

type Linha = Record<string, SQLInputValue>;

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

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
          ...semNulos(e),
          fim: e.fim, // fim NULL segue como null: é execução aberta
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

/** Linha já carregada (chave em `existentes`) é atualizada; linha nova é INSERT simples, então id de outro ticket falha por PK. */
function gravar(
  banco: DatabaseSync,
  tabela: string,
  chave: readonly string[],
  linhas: Linha[],
  existentes: Set<string>,
): void {
  for (const linha of linhas) {
    const colunas = Object.keys(linha);
    const insert = `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map((c) => "$" + c).join(", ")})`;
    const sets = colunas.filter((c) => !chave.includes(c)).map((c) => `${c} = excluded.${c}`);
    const existe = existentes.has(JSON.stringify(chave.map((c) => linha[c])));
    banco
      .prepare(existe ? `${insert} ON CONFLICT (${chave.join(", ")}) DO UPDATE SET ${sets.join(", ")}` : insert)
      .run(linha);
  }
}

const chaves = (chave: readonly string[], linhas: readonly object[]): Set<string> =>
  new Set(linhas.map((l) => JSON.stringify(chave.map((c) => (l as Linha)[c]))));

function validar(ref: z.infer<typeof TicketRef>, { sessoes, execucoes, usos }: EstadoSessoes): void {
  const s = sessoes.find((s) => s.demanda_id !== ref.demanda_id || s.ticket_id !== ref.ticket_id);
  if (s) throw new ErroDeRegra(`sessão ${s.id} não é do ticket ${ref.demanda_id}/${String(ref.ticket_id)}`);
  const ids = new Set(sessoes.map((s) => s.id));
  const e = execucoes.find((e) => !ids.has(e.sessao_id));
  if (e) throw new ErroDeRegra(`execução ${e.id} não é de uma sessão do ticket`);
  for (const x of execucoes) {
    const r = ExecucaoSessao.safeParse(x);
    if (!r.success)
      throw new ErroDeRegra(
        `execução ${x.id} inválida: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
  }
  const execIds = new Set(execucoes.map((e) => e.id));
  const u = usos.find((u) => !execIds.has(u.execucao_id));
  if (u) throw new ErroDeRegra(`uso da execução ${u.execucao_id} não é de uma execução do ticket`);
}

/** Carrega as sessões do ticket, aplica a transição pura e grava o resultado numa transação só (erro desfaz tudo). */
export const comSessoesDoTicket = (
  banco: DatabaseSync,
  ref: z.infer<typeof TicketRef>,
  transicao: (estado: EstadoSessoes) => EstadoSessoes,
): EstadoSessoes =>
  escrever(banco, () => {
    const antes = carregarSessoesDoTicket(banco, ref);
    const depois = transicao(antes);
    validar(ref, depois);
    gravar(banco, "sessao", ["id"], depois.sessoes, chaves(["id"], antes.sessoes));
    gravar(
      banco,
      "execucao_sessao",
      ["id"],
      depois.execucoes.map((e) => ({
        ...e,
        fim: e.fim ?? null,
        falha: Number(e.falha),
        grupo_processo: e.grupo_processo ?? null,
        erro: e.erro ?? null,
        modelo_provedor: e.modelo_provedor ?? null,
        modelo_nome: e.modelo_nome ?? null,
        effort: e.effort ?? null,
      })),
      chaves(["id"], antes.execucoes),
    );
    const chaveUso = ["execucao_id", "modelo_provedor", "modelo_nome"];
    gravar(
      banco,
      "uso_modelo_execucao",
      chaveUso,
      depois.usos.map((u) => ({ ...u, custo: u.custo ?? null })),
      chaves(chaveUso, antes.usos),
    );
    return depois;
  });
