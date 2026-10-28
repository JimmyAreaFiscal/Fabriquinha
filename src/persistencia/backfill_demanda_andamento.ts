// Backfill das issues em andamento (comparacao-sdlc-implementacao.md §2.2, §10): mapeamento da fase legada para a
// demanda e a rodada 1, o plano derivado da aprovação do desenho e a recusa das issues que não dá para migrar em voo.
import type { DatabaseSync } from "node:sqlite";
import { Plano } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";

export interface Destino {
  demanda: string;
  /** Fase da rodada 1; sem ela a demanda ainda não tem rodada. */
  rodada?: string;
  enviada: number;
  /** Os tickets de desenvolvimento são propostas: viram o plano, não `ticket_demanda`. */
  propostas?: boolean;
}

const DESTINOS = {
  registro: { demanda: "registro", enviada: 0 },
  desenho: { demanda: "planejamento", enviada: 1, propostas: true },
  aprovacao_desenho: { demanda: "aprovacao_planejamento", enviada: 1, propostas: true },
  desenvolvimento: { demanda: "execucao", rodada: "desenvolvimento", enviada: 1 },
  revisao: { demanda: "execucao", rodada: "revisao", enviada: 1 },
  encerramento: { demanda: "execucao", rodada: "encerramento", enviada: 1 },
  aprovacao_pr: { demanda: "execucao", rodada: "aprovacao_pull_request", enviada: 1 },
  ajuste_pr: { demanda: "execucao", rodada: "sessao", enviada: 1 },
} as const satisfies Record<string, Destino>;

/** Onde a issue em andamento cai no modelo novo; vale para toda fase de issue em andamento. */
export const destinoDe = (fase: string): Destino => DESTINOS[fase as keyof typeof DESTINOS];

const EM_ANDAMENTO =
  "i.fase <> 'concluida' AND i.cancelada_em IS NULL AND NOT EXISTS (SELECT 1 FROM demanda d WHERE d.id = 'I-' || i.id)";

interface Bloqueio {
  n: number;
  tickets: string | null;
  execucoes: string | null;
}

/**
 * Tudo ou nada: reúne as issues em andamento sem demanda que não migram (ticket ou execução ativa)
 * e lança um só erro citando cada uma. O ticket de registro ou desenho já enviado espera o Auditor e não conta como ativo.
 */
export function recusarBloqueadas(banco: DatabaseSync): void {
  const bloqueios = banco
    .prepare(
      `SELECT i.id AS n,
              (SELECT group_concat('T-' || t.id, ', ') FROM ticket t
                WHERE t.issue = i.id AND t.status = 'em_execucao' AND t.enviado_em IS NULL) AS tickets,
              (SELECT group_concat('E-' || e.id, ', ') FROM execucao e JOIN ticket t ON t.id = e.ticket
                WHERE t.issue = i.id AND e.resultado = 'em_andamento') AS execucoes
       FROM issue i WHERE ${EM_ANDAMENTO} ORDER BY i.id`,
    )
    .all() as unknown as Bloqueio[];
  const motivos = bloqueios.flatMap(({ n, tickets, execucoes }) => [
    ...(tickets === null
      ? []
      : [
          `I-${String(n)}: a sessão do ticket ${tickets} está aberta; na versão anterior da Fabriquinha, envie a sessão ou cancele a issue, e suba de novo`,
        ]),
    ...(execucoes === null
      ? []
      : [
          `I-${String(n)} tem execução ativa (execução ${execucoes}): pare o serviço ou espere as execuções terminarem`,
        ]),
  ]);
  if (motivos.length > 0)
    throw new ErroDeRegra(`migração recusada, nada foi gravado: ${motivos.join("; ")}`, "suba o serviço de novo");
}

interface Proposta {
  id: number;
  titulo: string;
  descricao: string;
  modelo_provedor: string | null;
  modelo_nome: string | null;
  criado_em: string;
}

/** O plano da issue em `aprovacao_desenho` (uma rodada) a partir dos tickets de desenvolvimento propostos, como evidência do ticket de planejamento. */
export function migrarPlano(banco: DatabaseSync, id: string, n: number): void {
  const propostas = banco
    .prepare(
      "SELECT id, titulo, descricao, modelo_provedor, modelo_nome, criado_em FROM ticket WHERE issue = ? AND etapa = 'desenvolvimento' ORDER BY id",
    )
    .all(n) as unknown as Proposta[];
  const plano = Plano.safeParse({
    demanda_id: id,
    criterios: [],
    rodadas: [{ demanda_id: id, rodada_id: 1, titulo: "Rodada única migrada", e2e: false }],
    tickets: propostas.map((p) => ({
      demanda_id: id,
      ticket_id: p.id,
      rodada_id: 1,
      titulo: p.titulo,
      descricao: p.descricao,
      ...(p.modelo_provedor !== null && { modelo_provedor: p.modelo_provedor, modelo_nome: p.modelo_nome }),
    })),
  });
  if (!plano.success)
    throw new ErroDeRegra(
      `${id}: o plano das propostas é inválido: ${plano.error.issues.map((i) => i.message).join("; ")}`,
      "corrija os tickets de desenvolvimento propostos no legado",
    );
  const desenho = banco.prepare("SELECT MIN(id) AS id FROM ticket WHERE issue = ? AND etapa = 'desenho'").get(n) as {
    id: number | null;
  };
  if (desenho.id === null) throw new ErroDeRegra(`${id} não tem ticket de desenho`, "sem ele o plano não tem dono");
  banco
    .prepare(
      "INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em) VALUES (?, ?, ?, 'plano', ?, ?)",
    )
    .run(
      `plano-${id}`,
      id,
      desenho.id,
      JSON.stringify(plano.data),
      propostas.reduce((m, p) => (p.criado_em > m ? p.criado_em : m), ""),
    );
}
