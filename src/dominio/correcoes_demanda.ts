// Materialização de correções (comparacao-sdlc-implementacao.md §3 e §4): tickets corretivos de uma rodada e novas
// rodadas da revisão integral. Funções puras que só acrescentam ao agregado; fases, gates e decisões ficam nas transições.
import { z } from "zod";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { branchRodada, Plano, RodadaRef } from "./demanda.ts";
import { ErroDeRegra, existe } from "./erros.ts";
import type { Instante } from "./primitivos.ts";

// A definição congelada guarda os `CA-n` em `dados.criterios[].id` (F3); o resto do payload não interessa aqui.
const DadosCriterios = z.object({ criterios: z.array(z.object({ id: z.string() })) });

function ler<T extends z.ZodType>(schema: T, valor: unknown): z.infer<T> {
  const r = schema.safeParse(valor);
  if (!r.success) {
    throw new ErroDeRegra(
      `correção inválida: ${r.error.issues.map((i) => i.message).join("; ")}`,
      "corrija e envie de novo",
    );
  }
  return r.data;
}

const maximo = (ns: number[]): number => ns.reduce((m, n) => Math.max(m, n), 0);

/** IDs locais ordenados, mapeados para `base + 1`, `base + 2`... (nunca reutiliza um ID existente). */
const renumerar = (ids: number[], base: number): Map<number, number> =>
  new Map([...ids].sort((a, b) => a - b).map((id, i) => [id, base + i + 1]));

function exigirDemanda(ag: AgregadoDemanda, demanda_id: string): void {
  if (demanda_id !== ag.demanda.id) {
    throw new ErroDeRegra(`a correção é da demanda ${demanda_id}, não da ${ag.demanda.id}`, "use o demanda_id certo");
  }
}

/** Acrescenta ao agregado os tickets `implementar` abertos do plano (e, se `novasRodadas`, as suas rodadas e vínculos). */
function acrescentar(ag: AgregadoDemanda, plano: Plano, agora: Instante, novasRodadas: boolean): AgregadoDemanda {
  const demanda_id = ag.demanda.id;
  const ticketNovo = renumerar(
    plano.tickets.map((t) => t.ticket_id),
    maximo(ag.tickets.map((t) => t.ticket_id)),
  );
  const rodadaNova = novasRodadas
    ? renumerar(
        plano.rodadas.map((r) => r.rodada_id),
        maximo(ag.rodadas.map((r) => r.rodada_id)),
      )
    : new Map(plano.rodadas.map((r) => [r.rodada_id, r.rodada_id]));
  const t = (n: number): number => existe(ticketNovo.get(n), `o ticket ${String(n)} não está na correção`, "valide");
  const r = (n: number): number => existe(rodadaNova.get(n), `a rodada ${String(n)} não está na correção`, "valide");
  const tickets = [...plano.tickets].sort((a, b) => a.ticket_id - b.ticket_id);
  const rodadas = [...plano.rodadas].sort((a, b) => a.rodada_id - b.rodada_id);
  return AgregadoDemanda.parse({
    ...ag,
    tickets: [
      ...ag.tickets,
      ...tickets.map(({ ticket_id, rodada_id, titulo, descricao, modelo_provedor, modelo_nome, effort }) => ({
        demanda_id,
        ticket_id: t(ticket_id),
        rodada_id: r(existe(rodada_id, "ticket sem rodada", "informe a rodada_id")),
        titulo,
        descricao,
        etapa: "implementar",
        status: "aberto",
        status_alterado_em: agora,
        modelo_provedor,
        modelo_nome,
        effort,
      })),
    ],
    dependencias_ticket: [
      ...ag.dependencias_ticket,
      ...tickets.flatMap((x) =>
        x.depende.map((d) => ({ demanda_id, ticket_id: t(x.ticket_id), depende_ticket_id: t(d.ticket_id) })),
      ),
    ],
    caminhos_ticket: [
      ...ag.caminhos_ticket,
      ...tickets.flatMap((x) => x.caminhos.map((caminho) => ({ demanda_id, ticket_id: t(x.ticket_id), caminho }))),
    ],
    ...(novasRodadas && {
      rodadas: [
        ...ag.rodadas,
        ...rodadas.map((x) => ({
          demanda_id,
          rodada_id: r(x.rodada_id),
          titulo: x.titulo,
          fase: "desenvolvimento",
          e2e: x.e2e,
          branch: branchRodada(demanda_id, r(x.rodada_id)),
        })),
      ],
      dependencias_rodada: [
        ...ag.dependencias_rodada,
        ...rodadas.flatMap((x) =>
          x.depende.map((d) => ({ demanda_id, rodada_id: r(x.rodada_id), depende_rodada_id: r(d.rodada_id) })),
        ),
      ],
      criterios_citados: [
        ...ag.criterios_citados,
        ...rodadas.flatMap((x) =>
          x.criterios.map((criterio_id) => ({ demanda_id, rodada_id: r(x.rodada_id), criterio_id })),
        ),
      ],
    }),
  });
}

/**
 * Tickets corretivos de uma rodada existente. `tickets` segue `Plano.shape.tickets` com IDs locais (renumerados depois do
 * maior ticket_id atual); dependências só entre eles e todos na rodada indicada. Status e etapa são sempre aberto/implementar.
 */
export function materializarCorrecoesRodada(
  ag: AgregadoDemanda,
  rodadaRef: unknown,
  tickets: unknown,
  agora: Instante,
): AgregadoDemanda {
  const ref = RodadaRef.parse(rodadaRef);
  exigirDemanda(ag, ref.demanda_id);
  if (!ag.rodadas.some((x) => x.rodada_id === ref.rodada_id)) {
    throw new ErroDeRegra(
      `a rodada ${String(ref.rodada_id)} não existe na demanda ${ref.demanda_id}`,
      "use uma rodada da demanda",
    );
  }
  const lista = ler(Plano.shape.tickets, tickets);
  if (lista.length === 0) {
    throw new ErroDeRegra("a lista de correções está vazia", "informe ao menos um ticket corretivo");
  }
  const alheio = lista.find((t) => t.rodada_id !== ref.rodada_id);
  if (alheio) {
    throw new ErroDeRegra(
      `o ticket ${String(alheio.ticket_id)} não é da rodada ${String(ref.rodada_id)}`,
      "todos os tickets devem citar a rodada indicada",
    );
  }
  const plano = ler(Plano, {
    demanda_id: ref.demanda_id,
    criterios: [],
    rodadas: [{ ...ref, titulo: "correções", e2e: false }],
    tickets: lista,
  });
  return acrescentar(ag, plano, agora, false);
}

/**
 * Novas rodadas corretivas da revisão integral, a partir de um plano separado: IDs locais viram IDs depois dos máximos
 * atuais, com vínculos remapeados; cita só `CA-n` da definição congelada. Rodadas e plano anteriores ficam intactos.
 */
export function materializarRodadasCorretivas(ag: AgregadoDemanda, plano: unknown, agora: Instante): AgregadoDemanda {
  const p = ler(Plano, plano);
  exigirDemanda(ag, p.demanda_id);
  if (p.rodadas.length === 0) {
    throw new ErroDeRegra("o plano corretivo não tem rodadas", "informe ao menos uma rodada com um ticket");
  }
  const global = p.tickets.find((t) => t.rodada_id === undefined);
  if (global) {
    throw new ErroDeRegra(`o ticket ${String(global.ticket_id)} não tem rodada`, "não há tickets globais na correção");
  }
  const definicao = ag.evidencias.find(
    (e) => e.tipo === "criterios_aceite" && e.rodada_id === undefined && e.ticket_id === undefined,
  );
  const existentes = new Set(DadosCriterios.safeParse(definicao?.dados).data?.criterios.map((c) => c.id));
  const ausentes = p.criterios.filter((c) => !existentes.has(c));
  if (ausentes.length > 0) {
    throw new ErroDeRegra(
      `a correção cita ${ausentes.join(", ")}, que a definição da demanda ${ag.demanda.id} não tem`,
      "cite só os CA-n da definição congelada",
    );
  }
  return acrescentar(ag, p, agora, true);
}
