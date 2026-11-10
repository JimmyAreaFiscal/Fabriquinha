// Repositório dos trabalhos agênticos, seus processos e usos por modelo (comparacao-sdlc §7.3). As funções puras de nucleo/trabalho_agentico.ts
// operam sobre o que foi lido; `comTrabalhosDoTicket` é a única forma de mutar e grava por upsert, nunca apaga.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { formatarTicketRef, type TicketRef } from "../nucleo/demanda.ts";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { ProcessoDoTrabalho, TrabalhoGerenciado, UsoModeloExecucao } from "../nucleo/trabalho_agentico.ts";
import { escrever } from "./banco.ts";
import { colunasDaConfiguracaoAgente, linhaComConfiguracaoAgente } from "./configuracao_agente.ts";
import { lerEmSnapshot } from "./snapshot.ts";

interface EstadoTrabalhos {
  sessoes: TrabalhoGerenciado[];
  execucoes: ProcessoDoTrabalho[];
  usos: UsoModeloExecucao[];
}

type Linha = Record<string, SQLInputValue>;

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

/** `ticketId` nulo carrega a demanda inteira. */
function carregar(banco: DatabaseSync, demandaId: string, ticketId: number | null): EstadoTrabalhos {
  const filtro = { demanda_id: demandaId, ticket_id: ticketId };
  const dasSessoes = `trabalho_id IN (SELECT id FROM trabalho_agentico WHERE demanda_id = $demanda_id AND ($ticket_id IS NULL OR ticket_id = $ticket_id))`;
  const ler = (sql: string) => banco.prepare(sql).all(filtro);
  return lerEmSnapshot(banco, () => ({
    sessoes: z
      .array(TrabalhoGerenciado)
      .parse(
        ler(
          "SELECT * FROM trabalho_agentico WHERE demanda_id = $demanda_id AND ($ticket_id IS NULL OR ticket_id = $ticket_id) ORDER BY rowid",
        ),
      ),
    execucoes: z.array(ProcessoDoTrabalho).parse(
      ler(`SELECT * FROM processo_do_trabalho WHERE ${dasSessoes} ORDER BY rowid`).map((e) => ({
        ...semNulos(linhaComConfiguracaoAgente(e)),
        fim: e.fim, // fim NULL segue como null: é execução aberta
        falha: e.falha === 1,
      })),
    ),
    usos: z.array(UsoModeloExecucao).parse(
      // custo NULL é desconhecido: volta sem a chave, nunca como zero.
      ler(
        `SELECT * FROM uso_modelo_execucao WHERE execucao_id IN (SELECT id FROM processo_do_trabalho WHERE ${dasSessoes}) ORDER BY rowid`,
      ).map(({ custo, ...u }) => (custo === null ? u : { ...u, custo })),
    ),
  }));
}

export const carregarTrabalhosDoTicket = (banco: DatabaseSync, ref: z.infer<typeof TicketRef>): EstadoTrabalhos =>
  carregar(banco, ref.demanda_id, ref.ticket_id);

export const carregarTrabalhosDaDemanda = (banco: DatabaseSync, demandaId: string): EstadoTrabalhos =>
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

function validar(ref: z.infer<typeof TicketRef>, { sessoes, execucoes, usos }: EstadoTrabalhos): void {
  const s = sessoes.find((s) => s.demanda_id !== ref.demanda_id || s.ticket_id !== ref.ticket_id);
  if (s) throw new ErroDeRegra(`sessão ${s.id} não é do ticket ${ref.demanda_id}/${String(ref.ticket_id)}`);
  const ids = new Set(sessoes.map((s) => s.id));
  const e = execucoes.find((e) => !ids.has(e.trabalho_id));
  if (e) throw new ErroDeRegra(`execução ${e.id} não é de uma sessão do ticket`);
  for (const x of execucoes) {
    const r = ProcessoDoTrabalho.safeParse(x);
    if (!r.success)
      throw new ErroDeRegra(
        `execução ${x.id} inválida: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
  }
  const execIds = new Set(execucoes.map((e) => e.id));
  const u = usos.find((u) => !execIds.has(u.execucao_id));
  if (u) throw new ErroDeRegra(`uso da execução ${u.execucao_id} não é de uma execução do ticket`);
}

/** Carrega os trabalhos do ticket, aplica a transição pura e grava o resultado numa transação só (erro desfaz tudo). */
export const comTrabalhosDoTicket = (
  banco: DatabaseSync,
  ref: z.infer<typeof TicketRef>,
  transicao: (estado: EstadoTrabalhos) => EstadoTrabalhos,
): EstadoTrabalhos =>
  escrever(banco, () => {
    const antes = carregarTrabalhosDoTicket(banco, ref);
    const depois = transicao(antes);
    validar(ref, depois);
    gravar(banco, "trabalho_agentico", ["id"], depois.sessoes, chaves(["id"], antes.sessoes));
    gravar(
      banco,
      "processo_do_trabalho",
      ["id"],
      depois.execucoes.map(({ configuracao_agente, ...e }) => ({
        ...e,
        fim: e.fim ?? null,
        falha: Number(e.falha),
        grupo_processo: e.grupo_processo ?? null,
        ...colunasDaConfiguracaoAgente(configuracao_agente),
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

interface ProcessoAberto {
  id: string;
  trabalho_id: string;
  demanda_id: string;
  ticket_id: number;
  grupo_processo: number | null;
}

/** As execuções sem fim de qualquer ticket: no reinício do serviço, todas são de uma instância anterior. */
export const processosAbertos = (banco: DatabaseSync): ProcessoAberto[] =>
  banco
    .prepare(
      `SELECT e.id, e.trabalho_id, s.demanda_id, s.ticket_id, e.grupo_processo
         FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id WHERE e.fim IS NULL ORDER BY e.rowid`,
    )
    .all()
    .map((l) => ({ ...l }) as unknown as ProcessoAberto);

/**
 * Os tickets (`I-n.Tm`) com o pi no ar: execução aberta e com o grupo do pi gravado. A execução abre antes da preparação
 * da worktree e o grupo só é gravado quando o pi sobe; a coleta de evidências roda depois que ela fecha.
 */
export const ticketsComPiAtivo = (banco: DatabaseSync): Set<string> =>
  new Set(
    processosAbertos(banco)
      .filter((e) => e.grupo_processo !== null)
      .map(({ demanda_id, ticket_id }) => formatarTicketRef({ demanda_id, ticket_id })),
  );

/** O ticket do trabalho do processo, ou `undefined` se a execução não existe. */
export const ticketDoProcesso = (banco: DatabaseSync, execucao: string): z.infer<typeof TicketRef> | undefined =>
  banco
    .prepare(
      "SELECT s.demanda_id, s.ticket_id FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id WHERE e.id = ?",
    )
    .get(execucao) as z.infer<typeof TicketRef> | undefined;

/** O ticket dono do trabalho; `undefined` se o id não é de um trabalho agêntico. */
export const ticketDoTrabalho = (banco: DatabaseSync, trabalhoId: string): z.infer<typeof TicketRef> | undefined =>
  banco.prepare("SELECT demanda_id, ticket_id FROM trabalho_agentico WHERE id = ?").get(trabalhoId) as
    z.infer<typeof TicketRef> | undefined;

/** Os trabalhos da demanda, cada um com o ticket dono. */
export const trabalhosComTicketDaDemanda = (
  banco: DatabaseSync,
  demandaId: string,
): (z.infer<typeof TicketRef> & { id: string })[] =>
  banco
    .prepare("SELECT id, demanda_id, ticket_id FROM trabalho_agentico WHERE demanda_id = ?")
    .all(demandaId)
    .map((l) => ({ ...l }) as unknown as z.infer<typeof TicketRef> & { id: string });

/**
 * Os tickets `em_execucao` que nenhuma execução aberta segura: etapas cujo fechamento roda depois que a execução fecha
 * (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também).
 */
export const ticketsEmExecucaoSemProcesso = (banco: DatabaseSync): z.infer<typeof TicketRef>[] =>
  banco
    .prepare(
      `SELECT demanda_id, ticket_id FROM ticket_demanda t WHERE estado = 'em_execucao' AND (
         etapa IN ('implementar', 'resolver_conflito', 'encerrar_demanda', 'revisar_rodada', 'revisar_demanda')
         OR (etapa = 'encerrar_rodada' AND EXISTS (SELECT 1 FROM rodada r
           WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id AND r.estado = 'encerrar_rodada')))`,
    )
    .all()
    .map((l) => ({ ...l }) as unknown as z.infer<typeof TicketRef>);

/**
 * O id da sessão de cada ticket de cada demanda de `ids`; com mais de uma no ticket, vale a mais recente.
 */
export function sessaoDeCadaTicketDasDemandas(
  banco: DatabaseSync,
  ids: readonly string[],
): Map<string, Map<number, string>> {
  const linhas = banco
    .prepare(
      "SELECT demanda_id, ticket_id, id FROM trabalho_agentico WHERE demanda_id IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    )
    .all(JSON.stringify(ids));
  // shortcut: filtra as linhas por demanda (ids × linhas), agrupar num passe só se passar de milhares de sessões.
  return new Map(
    ids.map((id) => [
      id,
      new Map(linhas.filter((l) => l.demanda_id === id).map((l) => [Number(l.ticket_id), String(l.id)])),
    ]),
  );
}

/** O id da sessão de cada ticket da demanda; com mais de uma no ticket, vale a mais recente. */
export const sessaoDeCadaTicketDaDemanda = (banco: DatabaseSync, id: string): Map<number, string> =>
  new Map(sessaoDeCadaTicketDasDemandas(banco, [id]).get(id));
