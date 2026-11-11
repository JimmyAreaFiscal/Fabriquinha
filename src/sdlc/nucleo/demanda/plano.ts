// Planos e arquivos previstos (CONCEITOS.md §10): o plano proposto pelo planejador, as correções dele, o leitor do que
// já está gravado e o único caminho que cria Rodadas e Tickets a partir de uma versão do Plano.
// Só importa `AgregadoDemanda` como tipo: o agregado e a evidência (que citam o plano) já dependem deste módulo.
import { z } from "zod";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { Ator, FABRIQUINHA } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ConfiguracaoAgente } from "../../../compartilhado/nucleo/configuracao_agente.ts";
import {
  branchRodada,
  CaminhoPrevisto,
  CriterioId,
  DemandaId,
  RodadaRef,
  TicketIdentidade,
  TicketRef,
} from "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import { ErroDeRegra, existe } from "../../../compartilhado/nucleo/erros.ts";
import { GrafoDeDependencias, proximoIdDeRodada, proximoIdDeTicket } from "../item_de_trabalho/item_de_trabalho.ts";
import { type Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { Id, type Instante, Markdown, Titulo } from "../../../compartilhado/nucleo/primitivos.ts";
import { etapaDoPapel } from "../../../etapas/catalogo.ts";
import { estadoDaRodadaNaEtapa, PRIMEIRA_ETAPA_DA_RODADA } from "../ciclo_de_vida/ciclos.ts";

const ArquivosPrevistos = CaminhoPrevisto.array().default([]);

const Rodada = RodadaRef.extend({
  titulo: Titulo,
  e2e: z.boolean(),
  criterios: z.array(CriterioId).default([]),
  depende: z.array(RodadaRef).default([]),
  arquivos_previstos: ArquivosPrevistos,
});
const Ticket = TicketIdentidade.extend({
  titulo: Titulo,
  descricao: Markdown,
  arquivos_previstos: ArquivosPrevistos,
  depende: z.array(TicketRef).default([]),
  configuracao_agente: ConfiguracaoAgente.optional(),
});

/**
 * Plano flat de uma demanda: `criterios` são os `CA-n` da demanda; cada rodada e ticket carrega o seu `demanda_id`.
 * Os arquivos previstos existem nos três níveis, com Ticket ⊆ Rodada ⊆ Demanda (CONCEITOS.md §10).
 */
const DadosDoPlano = z.object({
  demanda_id: DemandaId,
  criterios: z.array(CriterioId),
  arquivos_previstos: ArquivosPrevistos,
  rodadas: z.array(Rodada),
  tickets: z.array(Ticket),
});
type DadosDoPlano = z.infer<typeof DadosDoPlano>;

/** Estrutura do plano: identidades, vínculos e dependências coerentes. */
const exigirEstruturaDoPlano = (plano: DadosDoPlano, ctx: z.core.$RefinementCtx): void => {
  const erro = (message: string) => {
    ctx.addIssue({ code: "custom", message });
  };
  const { demanda_id: demanda } = plano;
  const rodadas = new Set<number>();
  for (const r of plano.rodadas) {
    if (r.demanda_id !== demanda) erro(`a rodada ${String(r.rodada_id)} é de outra demanda (${r.demanda_id})`);
    if (rodadas.has(r.rodada_id)) erro(`a rodada ${String(r.rodada_id)} se repete`);
    rodadas.add(r.rodada_id);
  }
  for (const r of plano.rodadas) {
    for (const c of r.criterios) {
      if (!plano.criterios.includes(c)) erro(`a rodada ${String(r.rodada_id)} cita o ${c}, que a demanda não tem`);
    }
    for (const d of r.depende) {
      if (d.demanda_id !== demanda)
        erro(`a rodada ${String(r.rodada_id)} depende de rodada de outra demanda (${d.demanda_id})`);
      else if (d.rodada_id === r.rodada_id) erro(`a rodada ${String(r.rodada_id)} não pode depender de si mesma`);
      else if (!rodadas.has(d.rodada_id))
        erro(`a rodada ${String(r.rodada_id)} depende da rodada ${String(d.rodada_id)}, que não existe`);
    }
  }
  const cicloDeRodadas = new GrafoDeDependencias(
    plano.rodadas.flatMap((r) => r.depende.map((d): [number, number] => [r.rodada_id, d.rodada_id])),
    "as rodadas",
  ).descreverCiclo();
  if (cicloDeRodadas) erro(cicloDeRodadas);

  const tickets = new Map<number, number | undefined>();
  for (const t of plano.tickets) {
    if (t.demanda_id !== demanda) erro(`o ticket ${String(t.ticket_id)} é de outra demanda (${t.demanda_id})`);
    if (tickets.has(t.ticket_id)) erro(`o ticket ${String(t.ticket_id)} se repete`);
    if (new Set(t.arquivos_previstos).size !== t.arquivos_previstos.length)
      erro(`o ticket ${String(t.ticket_id)} repete caminho`);
    if (t.rodada_id !== undefined && !rodadas.has(t.rodada_id))
      erro(`o ticket ${String(t.ticket_id)} está na rodada ${String(t.rodada_id)}, que não existe`);
    tickets.set(t.ticket_id, t.rodada_id);
  }
  for (const r of plano.rodadas) {
    if (!plano.tickets.some((t) => t.rodada_id === r.rodada_id))
      erro(`a rodada ${String(r.rodada_id)} não tem ticket de implementação`);
  }
  for (const t of plano.tickets) {
    for (const d of t.depende) {
      const alvo = tickets.get(d.ticket_id);
      const nome = `o ticket ${String(t.ticket_id)} depende do ${String(d.ticket_id)}`;
      if (d.demanda_id !== demanda) erro(`${nome}, de outra demanda (${d.demanda_id})`);
      else if (d.ticket_id === t.ticket_id) erro(`o ticket ${String(t.ticket_id)} não pode depender de si mesmo`);
      else if (!tickets.has(d.ticket_id)) erro(`${nome}, que não existe`);
      else if (t.rodada_id === undefined || alvo === undefined)
        erro(`${nome}: ticket sem rodada não participa de dependência`);
      else if (t.rodada_id !== alvo) erro(`${nome}, de outra rodada`);
    }
  }
  const cicloDeTickets = new GrafoDeDependencias(
    plano.tickets.flatMap((t) => t.depende.map((d): [number, number] => [t.ticket_id, d.ticket_id])),
    "os tickets",
  ).descreverCiclo();
  if (cicloDeTickets) erro(cicloDeTickets);
};

/** Ticket ⊆ Rodada ⊆ Demanda: o motivo cita o arquivo e o nível que não o prevê. */
const exigirInclusaoDosArquivos = (plano: DadosDoPlano, ctx: z.core.$RefinementCtx): void => {
  const erro = (message: string) => {
    ctx.addIssue({ code: "custom", message });
  };
  const rodadas = new Map(plano.rodadas.map((r) => [r.rodada_id, r.arquivos_previstos]));
  for (const t of plano.tickets) {
    const daRodada = t.rodada_id === undefined ? undefined : rodadas.get(t.rodada_id);
    if (daRodada === undefined) continue; // sem rodada, a estrutura já recusa
    for (const arquivo of t.arquivos_previstos.filter((a) => !daRodada.includes(a))) {
      erro(
        `o arquivo ${arquivo} do ticket ${String(t.ticket_id)} não está nos arquivos previstos da rodada ${String(t.rodada_id)}`,
      );
    }
  }
  for (const r of plano.rodadas) {
    for (const arquivo of r.arquivos_previstos.filter((a) => !plano.arquivos_previstos.includes(a))) {
      erro(
        `o arquivo ${arquivo} da rodada ${String(r.rodada_id)} não está nos arquivos previstos da demanda ${plano.demanda_id}`,
      );
    }
  }
};

export const PlanoProposto = DadosDoPlano.superRefine(exigirEstruturaDoPlano).superRefine(exigirInclusaoDosArquivos);
export type PlanoProposto = z.infer<typeof PlanoProposto>;

const unicos = (listas: string[][]): string[] => [...new Set(listas.flat())];

const PlanoGravado = z.looseObject({
  arquivos_previstos: z.array(z.string()).optional(),
  rodadas: z.array(z.looseObject({ rodada_id: z.number(), arquivos_previstos: z.array(z.string()).optional() })),
  tickets: z.array(
    z.looseObject({
      rodada_id: z.number().optional(),
      caminhos: z.array(z.string()).optional(),
      arquivos_previstos: z.array(z.string()).optional(),
    }),
  ),
});

/**
 * Completa o plano que omite arquivos previstos: o plano antigo traz `caminhos` no ticket e nada em Rodada e Demanda;
 * aqui `caminhos` vira `arquivos_previstos` e Rodada e Demanda levam a união dos de baixo, o que satisfaz a inclusão
 * por construção. O que não tem a forma de plano segue intacto, para o `PlanoProposto` recusar com o motivo.
 */
function completarArquivosPrevistos(dados: unknown): unknown {
  const gravado = PlanoGravado.safeParse(dados);
  if (!gravado.success) return dados;
  const tickets = gravado.data.tickets.map(({ caminhos, ...ticket }) => ({
    ...ticket,
    arquivos_previstos: ticket.arquivos_previstos ?? caminhos ?? [],
  }));
  const rodadas = gravado.data.rodadas.map((rodada) => ({
    ...rodada,
    arquivos_previstos:
      rodada.arquivos_previstos ??
      unicos(tickets.filter((t) => t.rodada_id === rodada.rodada_id).map((t) => t.arquivos_previstos)),
  }));
  return {
    ...gravado.data,
    rodadas,
    tickets,
    arquivos_previstos:
      gravado.data.arquivos_previstos ??
      unicos([...rodadas.map((r) => r.arquivos_previstos), ...tickets.map((t) => t.arquivos_previstos)]),
  };
}

/** Lê um plano que já está gravado (evidência aceita). Só a submissão usa o `PlanoProposto` estrito. */
export const lerPlanoGravado = (dados: unknown): PlanoProposto =>
  PlanoProposto.parse(completarArquivosPrevistos(dados));

// A sessão que ajusta o PR reprovado corrige com o nome da Etapa dela como origem.
const OrigemDaCorrecao = z.enum([
  "revisao_rodada",
  "revisao_demanda",
  etapaDoPapel("ajusta_o_pr_reprovado"),
  "conferencia_do_pr",
]);
/** De onde vem uma versão do Plano: a aprovação do planejamento (versão 1) ou uma das correções. */
export const OrigemDaVersao = z.enum(["aprovacao_do_planejamento", ...OrigemDaCorrecao.options]);

/**
 * Mudança de rumo do Plano, de qualquer origem; nunca há replanejamento. Com `rodada` são tickets corretivos dela; sem
 * `rodada` são rodadas corretivas novas (com os tickets delas). `arquivos_acrescentados` vai à demanda e, com `rodada`, à rodada.
 * @testes o teste lê de volta o que a versão grava; a produção a monta por `correcaoDosTicketsDaRodada` e `correcaoDasRodadasNovas`
 */
export const CorrecaoDoPlano = z
  .object({
    origem: OrigemDaCorrecao,
    autor: Ator,
    rodada: Id.optional(),
    rodadas_novas: z.array(Rodada),
    tickets_novos: z.array(Ticket),
    arquivos_acrescentados: ArquivosPrevistos,
  })
  .refine((c) => c.rodada === undefined || c.rodadas_novas.length === 0, {
    message: "a correção é de uma rodada existente ou de rodadas novas, não das duas",
  });
export type CorrecaoDoPlano = z.infer<typeof CorrecaoDoPlano>;

function lerOuRecusar<T extends z.ZodType>(schema: T, valor: unknown): z.infer<T> {
  const lido = schema.safeParse(valor);
  if (!lido.success) {
    throw new ErroDeRegra(
      `correção inválida: ${lido.error.issues.map((i) => i.message).join("; ")}`,
      "corrija e envie de novo",
    );
  }
  return lido.data;
}

/** Os tickets corretivos que o revisor informa para uma rodada (IDs locais, todos na rodada). */
export const correcaoDosTicketsDaRodada = (
  origem: Exclude<CorrecaoDoPlano["origem"], "revisao_demanda">,
  autor: Ator,
  rodada: number,
  tickets: unknown,
): CorrecaoDoPlano =>
  lerOuRecusar(CorrecaoDoPlano, {
    origem,
    autor,
    rodada,
    rodadas_novas: [],
    tickets_novos: tickets,
    arquivos_acrescentados: [],
  });

/** O plano corretivo que a revisão da demanda informa: rodadas novas com os tickets delas (IDs locais). */
export function correcaoDasRodadasNovas(autor: Ator, plano: unknown): CorrecaoDoPlano {
  const p = lerOuRecusar(PlanoProposto, completarArquivosPrevistos(plano));
  return {
    origem: "revisao_demanda",
    autor,
    rodadas_novas: p.rodadas,
    tickets_novos: p.tickets,
    arquivos_acrescentados: p.arquivos_previstos,
  };
}

// A definição congelada guarda os `CA-n` em `dados.criterios[].id` (F3); o resto do payload não interessa aqui.
const DadosCriterios = z.object({ criterios: z.array(z.object({ id: z.string() })) });

type Rodada = z.infer<typeof Rodada>;
type Ticket = z.infer<typeof Ticket>;

/** O que uma versão acrescenta ao agregado, com IDs locais, e como ela fica gravada depois de renumerada. */
interface Acrescimo {
  origem: z.infer<typeof OrigemDaVersao>;
  autor: Ator;
  rodada?: number;
  rodadas: Rodada[];
  /** ID local → ID na demanda, de toda rodada que os tickets citam. */
  rodadaNaDemanda: Map<number, number>;
  tickets: Ticket[];
  /** Os arquivos que a versão prevê na demanda (e, com `rodada`, nela). */
  arquivos: string[];
  gravar: (rodadas: Rodada[], tickets: Ticket[]) => object;
}

/** IDs locais ordenados, mapeados para `primeiroId`, `primeiroId + 1`... (nunca reutiliza um ID existente). */
const renumerar = (ids: number[], primeiroId: number): Map<number, number> =>
  new Map([...ids].sort((a, b) => a - b).map((id, i) => [id, primeiroId + i]));

const acrescimoDoPlano = (plano: PlanoProposto): Acrescimo => ({
  origem: "aprovacao_do_planejamento",
  autor: FABRIQUINHA,
  rodadas: plano.rodadas,
  rodadaNaDemanda: new Map(plano.rodadas.map((r) => [r.rodada_id, r.rodada_id])), // o plano já numera as rodadas
  tickets: plano.tickets,
  arquivos: plano.arquivos_previstos,
  gravar: () => plano,
});

/**
 * Valida a correção contra a demanda e a leva à forma do plano (um plano de uma rodada só, quando ela já existe), o que
 * dá a ela as mesmas regras de estrutura e a inclusão Ticket ⊆ Rodada ⊆ Demanda: arquivo fora do nível de cima sobe.
 */
function acrescimoDaCorrecao(ag: AgregadoDemanda, correcao: CorrecaoDoPlano): Acrescimo {
  const demanda_id = ag.demanda.id;
  const { rodada, tickets_novos } = correcao;
  if (rodada !== undefined && !ag.rodadas.some((x) => x.rodada_id === rodada)) {
    throw new ErroDeRegra(
      `a rodada ${String(rodada)} não existe na demanda ${demanda_id}`,
      "use uma rodada da demanda",
    );
  }
  if (rodada === undefined && correcao.rodadas_novas.length === 0) {
    throw new ErroDeRegra("o plano corretivo não tem rodadas", "informe ao menos uma rodada com um ticket");
  }
  if (tickets_novos.length === 0) {
    throw new ErroDeRegra("a lista de correções está vazia", "informe ao menos um ticket corretivo");
  }
  if (rodada === undefined) {
    const global = tickets_novos.find((t) => t.rodada_id === undefined);
    if (global) {
      throw new ErroDeRegra(
        `o ticket ${String(global.ticket_id)} não tem rodada`,
        "não há tickets globais na correção",
      );
    }
  } else {
    const alheio = tickets_novos.find((t) => t.rodada_id !== rodada);
    if (alheio) {
      throw new ErroDeRegra(
        `o ticket ${String(alheio.ticket_id)} não é da rodada ${String(rodada)}`,
        "todos os tickets devem citar a rodada indicada",
      );
    }
  }
  const rodadasNovas = correcao.rodadas_novas.map((r) => ({
    ...r,
    arquivos_previstos: unicos([
      r.arquivos_previstos,
      ...tickets_novos.filter((t) => t.rodada_id === r.rodada_id).map((t) => t.arquivos_previstos),
    ]),
  }));
  const arquivos = unicos([
    correcao.arquivos_acrescentados,
    ...rodadasNovas.map((r) => r.arquivos_previstos),
    ...tickets_novos.map((t) => t.arquivos_previstos),
  ]);
  const plano = lerOuRecusar(PlanoProposto, {
    demanda_id,
    criterios: [...new Set(rodadasNovas.flatMap((r) => r.criterios))],
    arquivos_previstos: arquivos,
    rodadas:
      rodada === undefined
        ? rodadasNovas
        : [{ demanda_id, rodada_id: rodada, titulo: "correções", e2e: false, arquivos_previstos: arquivos }],
    tickets: tickets_novos,
  });
  const definicao = ag.evidencias.find(
    (e) => e.tipo === "criterios_aceite" && e.rodada_id === undefined && e.ticket_id === undefined,
  );
  const existentes = new Set(DadosCriterios.safeParse(definicao?.dados).data?.criterios.map((c) => c.id));
  const ausentes = plano.criterios.filter((c) => !existentes.has(c));
  if (ausentes.length > 0) {
    throw new ErroDeRegra(
      `a correção cita ${ausentes.join(", ")}, que a definição da demanda ${demanda_id} não tem`,
      "cite só os CA-n da definição congelada",
    );
  }
  return {
    origem: correcao.origem,
    autor: correcao.autor,
    rodada,
    rodadas: rodada === undefined ? plano.rodadas : [],
    rodadaNaDemanda:
      rodada === undefined
        ? renumerar(
            plano.rodadas.map((r) => r.rodada_id),
            proximoIdDeRodada(ag),
          )
        : new Map([[rodada, rodada]]),
    tickets: plano.tickets,
    arquivos: plano.arquivos_previstos,
    gravar: (rodadas_novas, tickets_novos) => ({
      ...correcao,
      rodadas_novas,
      tickets_novos,
      arquivos_acrescentados: plano.arquivos_previstos,
    }),
  };
}

const DadosDaVersao = z.record(z.string(), z.json());

const caminhosQueFaltam = (existentes: string[], previstos: string[]): string[] =>
  previstos.filter((caminho) => !existentes.includes(caminho));

/**
 * O único caminho que cria Rodadas e Tickets: a aprovação do planejamento (`PlanoProposto`, versão 1) e toda correção
 * (`CorrecaoDoPlano`). Acrescenta ao agregado as rodadas novas, os tickets `implementar` abertos, os vínculos e os arquivos
 * previstos dos três níveis, e grava a versão do Plano (número seguinte, IDs já renumerados depois dos máximos atuais).
 * Estados, gates e decisões ficam nas transições; quem grava o agregado o valida.
 */
export function materializar(
  ag: AgregadoDemanda,
  versao: PlanoProposto | CorrecaoDoPlano,
  ctx: { readonly agora: Instante },
): AgregadoDemanda {
  const acrescimo = "tickets_novos" in versao ? acrescimoDaCorrecao(ag, versao) : acrescimoDoPlano(versao);
  const demanda_id = ag.demanda.id;
  const { agora } = ctx;
  const ticketNaDemanda = renumerar(
    acrescimo.tickets.map((t) => t.ticket_id),
    proximoIdDeTicket(ag),
  );
  const t = (n: number): number =>
    existe(ticketNaDemanda.get(n), `o ticket ${String(n)} não está na versão do plano`, "valide");
  const r = (n: number): number =>
    existe(acrescimo.rodadaNaDemanda.get(n), `a rodada ${String(n)} não está na versão do plano`, "valide");
  const rodadas = [...acrescimo.rodadas]
    .sort((a, b) => a.rodada_id - b.rodada_id)
    .map((x) => ({
      ...x,
      rodada_id: r(x.rodada_id),
      depende: x.depende.map((d) => ({ ...d, rodada_id: r(d.rodada_id) })),
    }));
  const tickets = [...acrescimo.tickets]
    .sort((a, b) => a.ticket_id - b.ticket_id)
    .map((x) => ({
      ...x,
      ticket_id: t(x.ticket_id),
      rodada_id: r(existe(x.rodada_id, "ticket sem rodada", "informe a rodada_id")),
      depende: x.depende.map((d) => ({ ...d, ticket_id: t(d.ticket_id) })),
    }));
  const { rodada } = acrescimo;
  return {
    ...ag,
    tickets: [
      ...ag.tickets,
      ...tickets.map(({ ticket_id, rodada_id, titulo, descricao, configuracao_agente }) => ({
        demanda_id,
        ticket_id,
        rodada_id,
        titulo,
        descricao,
        etapa: PRIMEIRA_ETAPA_DA_RODADA,
        estado: "aberto" as const,
        estado_alterado_em: agora,
        criado_por: acrescimo.autor,
        configuracao_agente,
      })),
    ],
    dependencias_ticket: [
      ...ag.dependencias_ticket,
      ...tickets.flatMap((x) =>
        x.depende.map((d) => ({ demanda_id, ticket_id: x.ticket_id, depende_ticket_id: d.ticket_id })),
      ),
    ],
    caminhos_ticket: [
      ...ag.caminhos_ticket,
      ...tickets.flatMap((x) =>
        x.arquivos_previstos.map((caminho) => ({ demanda_id, ticket_id: x.ticket_id, caminho })),
      ),
    ],
    rodadas: [
      ...ag.rodadas,
      ...rodadas.map((x) => ({
        demanda_id,
        rodada_id: x.rodada_id,
        titulo: x.titulo,
        estado: estadoDaRodadaNaEtapa(PRIMEIRA_ETAPA_DA_RODADA),
        estado_alterado_em: agora,
        e2e: x.e2e,
        branch: branchRodada(demanda_id, x.rodada_id),
      })),
    ],
    dependencias_rodada: [
      ...ag.dependencias_rodada,
      ...rodadas.flatMap((x) =>
        x.depende.map((d) => ({ demanda_id, rodada_id: x.rodada_id, depende_rodada_id: d.rodada_id })),
      ),
    ],
    criterios_citados: [
      ...ag.criterios_citados,
      ...rodadas.flatMap((x) =>
        x.criterios.map((criterio_id) => ({ demanda_id, rodada_id: x.rodada_id, criterio_id })),
      ),
    ],
    arquivos_previstos_rodada: [
      ...ag.arquivos_previstos_rodada,
      ...rodadas.flatMap((x) =>
        x.arquivos_previstos.map((caminho) => ({ demanda_id, rodada_id: x.rodada_id, caminho })),
      ),
      ...(rodada === undefined
        ? []
        : caminhosQueFaltam(
            ag.arquivos_previstos_rodada.filter((x) => x.rodada_id === rodada).map((x) => x.caminho),
            acrescimo.arquivos,
          ).map((caminho) => ({ demanda_id, rodada_id: rodada, caminho }))),
    ],
    arquivos_previstos_demanda: [
      ...ag.arquivos_previstos_demanda,
      ...caminhosQueFaltam(
        ag.arquivos_previstos_demanda.map((x) => x.caminho),
        acrescimo.arquivos,
      ).map((caminho) => ({ demanda_id, caminho })),
    ],
    versoes_plano: [
      ...ag.versoes_plano,
      {
        demanda_id,
        numero: ag.versoes_plano.reduce((maior, v) => Math.max(maior, v.numero), 0) + 1,
        origem: acrescimo.origem,
        autor: acrescimo.autor,
        rodada_id: rodada,
        criada_em: agora,
        dados: DadosDaVersao.parse(JSON.parse(JSON.stringify(acrescimo.gravar(rodadas, tickets)))), // sem undefined
      },
    ],
  };
}

/**
 * O Plano de uma demanda: o original aprovado (versão 1) e as correções, na ordem. A referência da Conformidade é
 * sempre o original; o que as correções acrescentam conta como extra.
 */
export class Plano {
  readonly original: PlanoProposto;
  readonly correcoes: CorrecaoDoPlano[];

  constructor(original: PlanoProposto, correcoes: CorrecaoDoPlano[]) {
    this.original = original;
    this.correcoes = correcoes;
  }

  /** A última versão: a correção mais recente ou, sem correção, o original. */
  versaoAtual(): PlanoProposto | CorrecaoDoPlano {
    return this.correcoes.at(-1) ?? this.original;
  }

  /**
   * Os arquivos previstos do nível (demanda, rodada ou ticket), com o que as correções acrescentaram a ele.
   * shortcut: o ID do ticket do original é o do plano e o do corretivo é o da demanda, e podem colidir; a Conformidade
   * só usa a rodada e a demanda, gravar o ID da demanda no original se o ticket passar a importar.
   */
  arquivosPrevistos(nivel: Endereco): string[] {
    const { ticket_id, rodada_id } = nivel;
    if (ticket_id !== undefined) {
      return unicos(
        [...this.original.tickets, ...this.correcoes.flatMap((c) => c.tickets_novos)]
          .filter((t) => t.ticket_id === ticket_id)
          .map((t) => t.arquivos_previstos),
      );
    }
    if (rodada_id !== undefined) {
      const daCorrecao = (c: CorrecaoDoPlano): string[] =>
        c.rodada === rodada_id
          ? c.arquivos_acrescentados
          : c.rodadas_novas.filter((r) => r.rodada_id === rodada_id).flatMap((r) => r.arquivos_previstos);
      return unicos([
        ...this.original.rodadas.filter((r) => r.rodada_id === rodada_id).map((r) => r.arquivos_previstos),
        ...this.correcoes.map(daCorrecao),
      ]);
    }
    return unicos([this.original.arquivos_previstos, ...this.correcoes.map((c) => c.arquivos_acrescentados)]);
  }

  /** O que as correções acrescentam à demanda e o original não previa. */
  extras(): string[] {
    return caminhosQueFaltam(
      this.original.arquivos_previstos,
      unicos(this.correcoes.map((c) => c.arquivos_acrescentados)),
    );
  }
}
