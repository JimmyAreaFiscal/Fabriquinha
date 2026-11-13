// As tabelas de Planejamento (MELHORIAS §5.1): rodadas, tickets, dependências internas, critérios citados, arquivos
// previstos e versões do Plano. Este é o único arquivo que fala SQL com elas; o agregado da demanda as carrega e grava
// por aqui, no meio das tabelas dele (todas dependem só de `demanda`, e as do Processo dependem delas).
import type { DatabaseSync } from "node:sqlite";
import {
  type Ator,
  type ConfiguracaoAgente,
  type EtapaTicket,
  colunasDaConfiguracaoAgente,
  linhaComConfiguracaoAgente,
} from "../../etapas/publico.ts";
import {
  agruparColunasDoCampo,
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  type LinhaDaTabela,
  semNulos,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/diferenca_do_agregado.ts";
import { CorrecaoDoPlano, lerPlanoGravado, Plano } from "../nucleo/plano.ts";
import { instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import type { LinhasDoAgregado } from "../../../../shared/armazenamento/linhas_do_agregado.ts";

interface VinculoDaRodada {
  readonly demanda_id: string;
  readonly rodada_id: number;
}
interface VinculoDoTicket {
  readonly demanda_id: string;
  readonly ticket_id: number;
}

/** Os itens de Planejamento como o agregado da demanda os guarda. */
interface ItensDoPlanejamento {
  readonly rodadas: readonly (VinculoDaRodada & {
    readonly titulo: string;
    readonly estado: string;
    readonly estado_alterado_em: string;
    readonly e2e: boolean;
    readonly branch: string;
  })[];
  readonly dependencias_rodada: readonly (VinculoDaRodada & { readonly depende_rodada_id: number })[];
  readonly criterios_citados: readonly (VinculoDaRodada & { readonly criterio_id: string })[];
  readonly tickets: readonly (VinculoDoTicket & {
    readonly etapa: string;
    readonly estado: string;
    readonly estado_alterado_em: string;
    readonly criado_por: Ator;
    readonly rodada_id?: number;
    readonly titulo?: string;
    readonly descricao?: string;
    readonly configuracao_agente?: ConfiguracaoAgente;
    readonly instrucao?: string;
  })[];
  readonly dependencias_ticket: readonly (VinculoDoTicket & { readonly depende_ticket_id: number })[];
  readonly caminhos_ticket: readonly (VinculoDoTicket & { readonly caminho: string })[];
  readonly arquivos_previstos_rodada: readonly (VinculoDaRodada & { readonly caminho: string })[];
  readonly arquivos_previstos_demanda: readonly { readonly demanda_id: string; readonly caminho: string }[];
  readonly versoes_plano: readonly {
    readonly demanda_id: string;
    readonly numero: number;
    readonly origem: string;
    readonly autor: Ator;
    readonly rodada_id?: number;
    readonly criada_em: string;
    readonly dados: Record<string, unknown>;
  }[];
}

/** O Ator nas colunas `<prefixo>_tipo` e `<prefixo>_trabalho_id`; a ferramenta e a sessão do externo só a versão guarda. */
const colunasDoAtor = (prefixo: string, ator: Ator): LinhaDaTabela => ({
  [`${prefixo}_tipo`]: ator.tipo,
  [`${prefixo}_trabalho_id`]: ator.tipo === "agente" ? ator.trabalho_id : null,
});

const bit = (valor: boolean) => Number(valor);

/** `dependencia_ticket.rodada_id` é derivado da rodada do ticket; sem rodada vira NULL e o banco recusa. */
const rodadaDoTicket = (itens: ItensDoPlanejamento, ticketId: number) =>
  itens.tickets.find((ticket) => ticket.ticket_id === ticketId)?.rodada_id ?? null;

/**
 * As tabelas, dos pais para os filhos: insere e atualiza nessa ordem e apaga na inversa (as FKs são RESTRICT). A cópia
 * rasa de cada item dá à linha a assinatura de índice que a `interface` não tem.
 */
const TABELAS_DO_PLANEJAMENTO: readonly TabelaDoAgregado<ItensDoPlanejamento>[] = [
  {
    nome: "rodada",
    chave: ["demanda_id", "rodada_id"],
    linhas: (itens) => itens.rodadas.map((rodada) => ({ ...rodada, e2e: bit(rodada.e2e) })),
  },
  {
    nome: "dependencia_rodada",
    chave: ["demanda_id", "rodada_id", "depende_rodada_id"],
    linhas: (itens) => itens.dependencias_rodada.map((dependencia) => ({ ...dependencia })),
  },
  {
    nome: "criterio_citado_rodada",
    chave: ["demanda_id", "rodada_id", "criterio_id"],
    linhas: (itens) => itens.criterios_citados.map((criterio) => ({ ...criterio })),
  },
  {
    nome: "ticket_demanda",
    chave: ["demanda_id", "ticket_id"],
    linhas: (itens) =>
      itens.tickets.map(({ criado_por, configuracao_agente, ...ticket }) => ({
        ...ticket,
        ...colunasDoAtor("criado_por", criado_por),
        rodada_id: ticket.rodada_id ?? null,
        titulo: ticket.titulo ?? null,
        descricao: ticket.descricao ?? null,
        ...colunasDaConfiguracaoAgente(configuracao_agente),
        instrucao: ticket.instrucao ?? null,
      })),
  },
  {
    nome: "dependencia_ticket",
    chave: ["demanda_id", "ticket_id", "depende_ticket_id"],
    linhas: (itens) =>
      itens.dependencias_ticket.map((dependencia) => ({
        ...dependencia,
        rodada_id: rodadaDoTicket(itens, dependencia.ticket_id),
      })),
  },
  {
    nome: "caminho_ticket",
    chave: ["demanda_id", "ticket_id", "caminho"],
    linhas: (itens) => itens.caminhos_ticket.map((caminho) => ({ ...caminho })),
  },
  {
    nome: "arquivo_previsto_rodada",
    chave: ["demanda_id", "rodada_id", "caminho"],
    linhas: (itens) => itens.arquivos_previstos_rodada.map((arquivo) => ({ ...arquivo })),
  },
  {
    nome: "arquivo_previsto_demanda",
    chave: ["demanda_id", "caminho"],
    linhas: (itens) => itens.arquivos_previstos_demanda.map((arquivo) => ({ ...arquivo })),
  },
  {
    nome: "versao_plano",
    chave: ["demanda_id", "numero"],
    linhas: (itens) =>
      itens.versoes_plano.map(({ autor, ...versao }) => ({
        ...versao,
        ...colunasDoAtor("autor", autor),
        autor_ferramenta: autor.tipo === "externo" ? autor.ferramenta : null,
        autor_sessao: autor.tipo === "externo" ? autor.sessao : null,
        rodada_id: versao.rodada_id ?? null,
        dados: JSON.stringify(versao.dados),
      })),
  },
];

/** Apaga os itens que sumiram entre `antes` e `depois`; vem depois de apagar o que depende deles. */
export const apagarItensQueSumiram = (
  banco: DatabaseSync,
  antes: ItensDoPlanejamento | undefined,
  depois: ItensDoPlanejamento,
): void => {
  apagarLinhasQueSumiram(banco, TABELAS_DO_PLANEJAMENTO, antes, depois);
};

/** Insere os itens novos e atualiza os que mudaram; vem depois de gravar a demanda e antes do que depende deles. */
export const gravarItensNovosEMudados = (
  banco: DatabaseSync,
  antes: ItensDoPlanejamento | undefined,
  depois: ItensDoPlanejamento,
): void => {
  gravarLinhasNovasEMudadas(banco, TABELAS_DO_PLANEJAMENTO, antes, depois);
};

/**
 * Os itens de Planejamento que as listagens das demandas pedem, como estão no banco: as rodadas, os tickets e as
 * dependências entre eles, sem os critérios citados, os arquivos previstos e as versões do Plano.
 */
export function carregarResumoDosItensDoPlanejamento(linhasDaDemanda: LinhasDoAgregado) {
  return {
    rodadas: linhasDaDemanda("rodada").map((rodada) => ({ ...rodada, e2e: rodada.e2e === 1 })),
    dependencias_rodada: linhasDaDemanda("dependencia_rodada"),
    tickets: linhasDaDemanda("ticket_demanda").map((ticket) =>
      semNulos(linhaComConfiguracaoAgente(agruparColunasDoCampo(ticket, "criado_por"))),
    ),
    dependencias_ticket: linhasDaDemanda("dependencia_ticket"),
  };
}

/** Os itens de Planejamento da demanda, como estão no banco, para o agregado validar. */
export function carregarItensDoPlanejamento(linhasDaDemanda: LinhasDoAgregado) {
  return {
    ...carregarResumoDosItensDoPlanejamento(linhasDaDemanda),
    criterios_citados: linhasDaDemanda("criterio_citado_rodada"),
    caminhos_ticket: linhasDaDemanda("caminho_ticket"),
    arquivos_previstos_rodada: linhasDaDemanda("arquivo_previsto_rodada"),
    arquivos_previstos_demanda: linhasDaDemanda("arquivo_previsto_demanda"),
    versoes_plano: linhasDaDemanda("versao_plano").map(({ dados, ...versao }) => ({
      ...semNulos(agruparColunasDoCampo(versao, "autor")),
      dados: JSON.parse(dados as string) as unknown,
    })),
  };
}

/** Um ticket lido em lote, só com a Etapa, a rodada (`null` em ticket de demanda), o estado e os instantes dele. */
export interface ResumoDoTicket {
  demanda_id: string;
  ticket_id: number;
  etapa: string;
  rodada_id: number | null;
  estado: string;
  estado_alterado_em: string;
  /** Só o backfill grava `criado_em` e `concluido_em`: o ticket novo os tem `null`. */
  criado_em: string | null;
  concluido_em: string | null;
}

const DAS_DEMANDAS = "demanda_id IN (SELECT value FROM json_each(?))";

/** Os tickets das demandas, em lote e sem carregar o agregado, na ordem em que foram criados. */
export const ticketsDasDemandas = (banco: DatabaseSync, demandaIds: readonly string[]): ResumoDoTicket[] =>
  instrucaoPreparada(
    banco,
    `SELECT demanda_id, ticket_id, etapa, rodada_id, estado, estado_alterado_em, criado_em, concluido_em
       FROM ticket_demanda WHERE ${DAS_DEMANDAS} ORDER BY rowid`,
  )
    .all(JSON.stringify(demandaIds))
    .map((linha) => ({
      demanda_id: linha.demanda_id as string,
      ticket_id: linha.ticket_id as number,
      etapa: linha.etapa as string,
      rodada_id: linha.rodada_id as number | null,
      estado: linha.estado as string,
      estado_alterado_em: linha.estado_alterado_em as string,
      criado_em: linha.criado_em as string | null,
      concluido_em: linha.concluido_em as string | null,
    }));

/**
 * O Plano de cada demanda, montado das versões gravadas: o original é a da aprovação do planejamento, as outras são as
 * correções. Fica de fora a demanda sem plano aprovado, como a antiga sem evidência `plano` que recebeu correção depois.
 */
export function planosDasDemandas(banco: DatabaseSync, demandaIds: readonly string[]): Map<string, Plano> {
  const versoes = instrucaoPreparada(
    banco,
    `SELECT demanda_id, origem, dados FROM versao_plano WHERE ${DAS_DEMANDAS} ORDER BY demanda_id, numero`,
  )
    .all(JSON.stringify(demandaIds))
    .map((linha) => ({
      demanda_id: String(linha.demanda_id),
      origem: linha.origem,
      dados: JSON.parse(String(linha.dados)) as unknown,
    }));
  const planos = new Map<string, Plano>();
  for (const [demandaId, [original, ...correcoes]] of Map.groupBy(versoes, (versao) => versao.demanda_id)) {
    if (original?.origem !== "aprovacao_do_planejamento") continue;
    const plano = new Plano(
      lerPlanoGravado(original.dados),
      correcoes.map((correcao) => CorrecaoDoPlano.parse(correcao.dados)),
    );
    planos.set(demandaId, plano);
  }
  return planos;
}

/**
 * Os tickets `em_execucao` das Etapas de `sempre` e, das Etapas de `noEstadoDaRodada`, só os da rodada que ainda está no
 * estado da própria Etapa.
 */
export const ticketsEmExecucaoDasEtapas = (
  banco: DatabaseSync,
  etapas: { sempre: readonly EtapaTicket[]; noEstadoDaRodada: readonly EtapaTicket[] },
): VinculoDoTicket[] =>
  banco
    .prepare(
      `SELECT demanda_id, ticket_id FROM ticket_demanda t WHERE estado = 'em_execucao' AND (
         etapa IN (SELECT value FROM json_each(?))
         OR (etapa IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM rodada r
           WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id AND r.estado = t.etapa)))`,
    )
    .all(JSON.stringify(etapas.sempre), JSON.stringify(etapas.noEstadoDaRodada))
    .map((linha) => ({ ...linha }) as unknown as VinculoDoTicket);

/** Na remoção do projeto: os itens de Planejamento das `demandas`, dos filhos para os pais. */
export function apagarItensDasDemandas(banco: DatabaseSync, demandaIds: readonly string[]): void {
  for (const tabela of [
    "dependencia_ticket",
    "caminho_ticket",
    "arquivo_previsto_rodada",
    "arquivo_previsto_demanda",
    "versao_plano",
    "ticket_demanda",
    "criterio_citado_rodada",
    "dependencia_rodada",
    "rodada",
  ])
    banco.prepare(`DELETE FROM ${tabela} WHERE ${DAS_DEMANDAS}`).run(JSON.stringify(demandaIds));
}
