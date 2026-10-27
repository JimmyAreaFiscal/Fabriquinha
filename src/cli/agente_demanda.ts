// CLI do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): resolve `FABRIQUINHA_EXECUCAO` em
// `execucao_sessao` e lê a própria demanda e o próprio ticket, sempre pelo endereço público (`I-206.T3`). Nenhuma regra
// mora aqui: o escopo é conferido na fronteira e o resto é do domínio e da persistência.
import type { DatabaseSync } from "node:sqlite";
import { text } from "node:stream/consumers";
import type { ParseArgsOptionsConfig } from "node:util";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { type Ator, TipoEvidencia } from "../dominio/agregado.ts";
import { formatarRodadaRef, formatarTicketRef, interpretarRef } from "../dominio/demanda.ts";
import { ErroDeEscopo, ErroDeRegra, encontrado, mensagem } from "../dominio/erros.ts";
import { CATALOGO_ETAPAS } from "../dominio/evidencia_etapa.ts";
import { type SchemaEvidencia, schemaDe, schemaDeEtapa, type TipoSchemaEtapa } from "../evidencias/schemas.ts";
import { registrarCorrecoesSessao, registrarRevisaoRodada } from "../dominio/transicoes_rodada.ts";
import { registrarRevisaoDemanda } from "../dominio/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { projeto } from "../persistencia/projetos.ts";

/** O agente de uma execução da demanda: a execução (id de `execucao_sessao`), a sessão e o ticket composto que ele roda. */
export interface AgenteDemanda {
  readonly execucao: string;
  readonly sessao: string;
  readonly demanda_id: string;
  readonly ticket_id: number;
  readonly projeto: string;
}

export interface ChamadaDemanda {
  readonly banco: DatabaseSync;
  readonly agente: AgenteDemanda;
  readonly stdin: NodeJS.ReadableStream;
  readonly pos: readonly string[];
  readonly op: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ComandoDemanda {
  readonly palavras: readonly string[];
  readonly argumentos: readonly string[];
  readonly opcoesDeUso?: string;
  readonly opcoes?: ParseArgsOptionsConfig;
  rodar(c: ChamadaDemanda): unknown;
}

/** O agente de `execucao`, ou `undefined` se ela não é de `execucao_sessao` (vale o agente legado); terminada é ErroDeEscopo. */
export function resolverAgenteDemanda(banco: DatabaseSync, execucao: string): AgenteDemanda | undefined {
  const linha = banco
    .prepare(
      `SELECT e.fim, s.id AS sessao, s.demanda_id, s.ticket_id, d.projeto
         FROM execucao_sessao e JOIN sessao s ON s.id = e.sessao_id JOIN demanda d ON d.id = s.demanda_id
        WHERE e.id = ?`,
    )
    .get(execucao);
  if (!linha) return undefined;
  if (linha.fim !== null) {
    throw new ErroDeEscopo(`a execução ${execucao} já terminou`, "peça ao Auditor uma nova execução");
  }
  return {
    execucao,
    sessao: String(linha.sessao),
    demanda_id: String(linha.demanda_id),
    ticket_id: Number(linha.ticket_id),
    projeto: String(linha.projeto),
  };
}

export const proprio = (a: AgenteDemanda): string => formatarTicketRef(a);

/** O ticket de `texto`, que só pode ser o do agente; `T-3` e outras formas erram mostrando o endereço certo. */
export function ticketProprio(a: AgenteDemanda, texto: string, agir = false): void {
  const forma = `use o endereço do seu ticket, ${proprio(a)}`;
  let ref;
  try {
    ref = interpretarRef(texto);
  } catch {
    throw new ErroDeRegra(`${texto} não é um endereço de ticket`, forma);
  }
  if (!("ticket_id" in ref)) throw new ErroDeRegra(`${texto} é uma rodada, não um ticket`, forma);
  if (formatarTicketRef(ref) !== proprio(a)) {
    throw agir
      ? new ErroDeEscopo("o agente só age no próprio ticket", `aja em ${proprio(a)}`)
      : new ErroDeEscopo("o agente só lê o próprio ticket", `leia ${proprio(a)}`);
  }
}

function demandaPropria(a: AgenteDemanda, texto: string): void {
  if (texto !== a.demanda_id) {
    throw new ErroDeEscopo("o agente só lê a própria demanda", `leia ${a.demanda_id}, a do seu ticket ${proprio(a)}`);
  }
}

const TIPOS_NOVOS = ["plano", "testes_estresse", "analise_seguranca"];

/** Os tipos de produtor agente do catálogo das etapas: os únicos que o agente submete. */
export const TIPOS_DA_ETAPA: readonly string[] = [
  ...new Set(CATALOGO_ETAPAS.filter((i) => i.produtor === "agente").map((i) => i.tipo)),
];

export function schemaDoTipo(tipo: string): SchemaEvidencia | undefined {
  const legado = TipoEvidencia.safeParse(tipo);
  if (legado.success) return schemaDe(legado.data);
  return TIPOS_NOVOS.includes(tipo) ? schemaDeEtapa(tipo as TipoSchemaEtapa) : undefined;
}

const publico = ({ demanda_id, ticket_id, rodada_id, ...resto }: TicketDemanda) => ({
  ticket: formatarTicketRef({ demanda_id, ticket_id }),
  ...(rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id }) }),
  ...resto,
});

/** O JSON de uma opção, do argumento ou do stdin com `-`. */
async function lerJson(opcao: string, valor: string, stdin: NodeJS.ReadableStream): Promise<unknown> {
  try {
    return JSON.parse(valor === "-" ? await text(stdin) : valor);
  } catch (error_) {
    throw new ErroDeRegra(`${opcao} não é um JSON válido: ${mensagem(error_)}`, `passe ${opcao} <json|->`);
  }
}

/** Grava `transicao` na demanda do agente, reconferindo dentro da transação que a execução segue aberta. */
const gravar = (banco: DatabaseSync, a: AgenteDemanda, transicao: (ag: AgregadoDemanda) => AgregadoDemanda) =>
  comDemanda(banco, a.demanda_id, (ag) => {
    resolverAgenteDemanda(banco, a.execucao);
    return transicao(ag);
  });

/** A lista {titulo, descricao} do agente, completada com a demanda, a rodada e o ticket local (1, 2, ...). */
const completar = (lista: unknown, demanda_id: string, rodada_id: number | undefined): unknown =>
  Array.isArray(lista) ? lista.map((c: object, i) => ({ ...c, demanda_id, rodada_id, ticket_id: i + 1 })) : lista;

const exigir = (valor: unknown, opcao: string, veredito: string): void => {
  if (valor === undefined) throw new ErroDeRegra(`${veredito} exige ${opcao}`, `passe ${opcao}`);
};

export const COMANDOS_DEMANDA: readonly ComandoDemanda[] = [
  {
    palavras: ["projeto", "ver"],
    argumentos: [],
    rodar: ({ banco, agente }) =>
      encontrado(projeto(banco, agente.projeto), `o projeto ${agente.projeto} não existe`, "confira a execução"),
  },
  {
    palavras: ["demanda", "ver"],
    argumentos: ["I-<n>"],
    rodar({ banco, agente, pos }) {
      demandaPropria(agente, String(pos[0]));
      const ag = carregarDemanda(banco, agente.demanda_id);
      return {
        demanda: ag.demanda,
        rodadas: ag.rodadas.map(({ demanda_id, rodada_id, ...r }) => ({
          rodada: formatarRodadaRef({ demanda_id, rodada_id }),
          ...r,
        })),
        // A rodada vem do ticket decidido: a decisão não a guarda.
        decisoes: ag.decisoes.map(({ demanda_id, ticket_id, decisao_id, ...d }) => {
          const rodada_id = ag.tickets.find((t) => t.ticket_id === ticket_id)?.rodada_id;
          return {
            ticket: formatarTicketRef({ demanda_id, ticket_id }),
            ...(rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id }) }),
            ...d,
          };
        }),
        tickets: ag.tickets.map((t) => ({
          ...publico(t),
          // Só o próprio ticket mostra evidências: o nome, quando foi e a `aprovada` que o schema do tipo deriva.
          ...(t.ticket_id === agente.ticket_id && {
            evidencias: ag.evidencias
              .filter((e) => e.ticket_id === t.ticket_id)
              .map((e) => ({ tipo: e.tipo, em: e.em, aprovada: schemaDoTipo(e.tipo)?.aprovada?.(e.dados) })),
          }),
        })),
      };
    },
  },
  {
    palavras: ["ticket", "ver"],
    argumentos: ["I-<n>.T<m>"],
    rodar({ banco, agente, pos }) {
      ticketProprio(agente, String(pos[0]));
      const { tickets } = carregarDemanda(banco, agente.demanda_id);
      return publico(
        encontrado(
          tickets.find((t) => t.ticket_id === agente.ticket_id),
          `o ticket ${proprio(agente)} não existe`,
          "confira a execução",
        ),
      );
    },
  },
  {
    palavras: ["ticket", "criar"],
    argumentos: ["I-<n>.R<m>"],
    opcoesDeUso: "--titulo <texto>",
    opcoes: { titulo: { type: "string" } },
    rodar({ banco, agente, pos, op }) {
      const texto = String(pos[0]);
      let ref;
      try {
        ref = interpretarRef(texto);
      } catch {
        throw new ErroDeRegra(`${texto} não é um endereço de rodada`, "use a rodada do seu ticket, como I-206.R2");
      }
      if (!("rodada_id" in ref)) {
        throw new ErroDeRegra(`${texto} é um ticket, não uma rodada`, "use a rodada do seu ticket, como I-206.R2");
      }
      const titulo = op.titulo as string | undefined;
      if (titulo === undefined) throw new ErroDeRegra("falta o título do ticket corretivo", "passe --titulo <texto>");
      const { demanda_id } = agente;
      const antes = new Set(carregarDemanda(banco, demanda_id).tickets.map((t) => t.ticket_id));
      const depois = gravar(banco, agente, (ag) =>
        registrarCorrecoesSessao(
          ag,
          {
            demanda_id,
            rodada_id: ref.rodada_id,
            ticket_id: agente.ticket_id,
            // A descrição repete o título: o agente só dá o título; o Auditor detalha no web.
            correcoes: [{ demanda_id, rodada_id: ref.rodada_id, ticket_id: 1, titulo, descricao: titulo }],
          },
          paraDominio(agente),
          { agora: new Date().toISOString() },
        ),
      );
      const novo = depois.tickets.filter((t) => !antes.has(t.ticket_id));
      return { rodada: texto, tickets: novo.map((t) => formatarTicketRef(t)) };
    },
  },
  {
    palavras: ["revisao", "decidir"],
    argumentos: ["I-<n>.T<m>", "aprovar|reprovar"],
    opcoesDeUso: "[--motivo <texto>] [--correcoes <json|->] [--plano <json|->]",
    opcoes: {
      motivo: { type: "string" },
      correcoes: { type: "string" },
      plano: { type: "string" },
    },
    async rodar({ banco, agente, pos, op, stdin }) {
      const veredito = String(pos[1]);
      if (veredito !== "aprovar" && veredito !== "reprovar") {
        throw new ErroDeRegra(`veredito ${JSON.stringify(veredito)} inválido`, "use aprovar ou reprovar");
      }
      ticketProprio(agente, String(pos[0]), true);
      const aprovado = veredito === "aprovar";
      const { demanda_id, ticket_id } = agente;
      const ticket = encontrado(
        carregarDemanda(banco, demanda_id).tickets.find((t) => t.ticket_id === ticket_id),
        `o ticket ${proprio(agente)} não existe`,
        "confira a execução",
      );
      const rodada = ticket.rodada_id;
      const campo = ticket.etapa === "revisar_rodada" ? "correcoes" : "plano";
      if (ticket.etapa !== "revisar_rodada" && ticket.etapa !== "revisar_demanda") {
        throw new ErroDeRegra(
          `o ticket ${proprio(agente)} é de ${ticket.etapa}, não de revisão`,
          "só ticket de revisão decide",
        );
      }
      let extra: object = {};
      if (aprovado) {
        const sobra = [op.motivo, op.correcoes, op.plano].some((v) => v !== undefined);
        if (sobra) throw new ErroDeRegra("aprovar não leva --motivo, --correcoes nem --plano", "omita as opções");
      } else {
        exigir(op.motivo, "--motivo", "reprovar");
        exigir(op[campo], `--${campo}`, "reprovar");
        const valor = await lerJson(`--${campo}`, op[campo] as string, stdin);
        extra = {
          exigencias: op.motivo,
          [campo]: campo === "correcoes" ? completar(valor, demanda_id, rodada) : valor,
        };
      }
      const entrada = { demanda_id, ticket_id, aprovado, ...extra };
      const agora = new Date().toISOString();
      gravar(banco, agente, (ag) =>
        ticket.etapa === "revisar_rodada"
          ? registrarRevisaoRodada(ag, { ...entrada, rodada_id: rodada }, paraDominio(agente), { agora })
          : registrarRevisaoDemanda(ag, entrada, paraDominio(agente), { agora }),
      );
      return {
        ticket: proprio(agente),
        ...(rodada !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id: rodada }) }),
        resultado: aprovado ? "aprovado" : "recusado",
      };
    },
  },
];

/**
 * O ator que as transições da demanda pedem. Elas leem só `tipo` e `ticket`, mas o tipo `Ator` exige `execucao`
 * numérico, que a execução da demanda (id texto) não tem: o campo fica ausente, nunca 0.
 * shortcut: cast até o domínio aceitar `Ator` sem `execucao`; some quando quem mexe em src/dominio trocar o tipo.
 */
export const paraDominio = (a: AgenteDemanda): Ator => ({ tipo: "agente", ticket: a.ticket_id }) as unknown as Ator;
