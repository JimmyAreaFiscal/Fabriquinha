// CLI do agente de uma execução da demanda (comparacao-sdlc-implementacao.md §6): resolve `FABRIQUINHA_EXECUCAO` em
// `execucao_sessao` e lê a própria demanda e o próprio ticket, sempre pelo endereço público (`I-206.T3`). Nenhuma regra
// mora aqui: o escopo é conferido na fronteira e o resto é do domínio e da persistência.
import type { DatabaseSync } from "node:sqlite";
import type { ParseArgsOptionsConfig } from "node:util";
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import { TipoEvidencia } from "../dominio/agregado.ts";
import { formatarRodadaRef, formatarTicketRef, interpretarRef } from "../dominio/demanda.ts";
import { ErroDeEscopo, ErroDeRegra, encontrado } from "../dominio/erros.ts";
import { type SchemaEvidencia, schemaDe, schemaDeEtapa, type TipoSchemaEtapa } from "../evidencias/schemas.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
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

const proprio = (a: AgenteDemanda): string => formatarTicketRef(a);

/** O ticket de `texto`, que só pode ser o do agente; `T-3` e outras formas erram mostrando o endereço certo. */
function ticketProprio(a: AgenteDemanda, texto: string): void {
  const forma = `use o endereço do seu ticket, ${proprio(a)}`;
  let ref;
  try {
    ref = interpretarRef(texto);
  } catch {
    throw new ErroDeRegra(`${texto} não é um endereço de ticket`, forma);
  }
  if (!("ticket_id" in ref)) throw new ErroDeRegra(`${texto} é uma rodada, não um ticket`, forma);
  if (formatarTicketRef(ref) !== proprio(a)) {
    throw new ErroDeEscopo("o agente só lê o próprio ticket", `leia ${proprio(a)}`);
  }
}

function demandaPropria(a: AgenteDemanda, texto: string): void {
  if (texto !== a.demanda_id) {
    throw new ErroDeEscopo("o agente só lê a própria demanda", `leia ${a.demanda_id}, a do seu ticket ${proprio(a)}`);
  }
}

const TIPOS_DA_ETAPA: readonly string[] = ["plano", "testes_estresse", "analise_seguranca"];

function schemaDoTipo(tipo: string): SchemaEvidencia | undefined {
  const legado = TipoEvidencia.safeParse(tipo);
  if (legado.success) return schemaDe(legado.data);
  return TIPOS_DA_ETAPA.includes(tipo) ? schemaDeEtapa(tipo as TipoSchemaEtapa) : undefined;
}

const publico = ({ demanda_id, ticket_id, rodada_id, ...resto }: TicketDemanda) => ({
  ticket: formatarTicketRef({ demanda_id, ticket_id }),
  ...(rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id }) }),
  ...resto,
});

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
];
