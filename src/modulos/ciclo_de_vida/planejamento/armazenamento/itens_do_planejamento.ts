// As tabelas de Planejamento (MELHORIAS §5.1): rodadas, tickets, dependências internas, critérios citados, arquivos
// previstos e versões do Plano. Este é o único arquivo que fala SQL com elas; o agregado da demanda as carrega e grava
// por aqui, no meio das tabelas dele (todas dependem só de `demanda`, e as do Processo dependem delas).
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Ator, ConfiguracaoAgente } from "../../etapas/publico.ts";
import {
  agruparColunasDoCampo,
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  type LinhaDaTabela,
  semNulos,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/diferenca_do_agregado.ts";
import {
  colunasDaConfiguracaoAgente,
  linhaComConfiguracaoAgente,
} from "../../../compartilhado/armazenamento/configuracao_agente.ts";

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

/** Os itens de Planejamento da demanda, como estão no banco, para o agregado validar; `preparar` reaproveita o SQL. */
export function carregarItensDoPlanejamento(preparar: (sql: string) => StatementSync, demandaId: string) {
  const filhas = (tabela: string) =>
    preparar(`SELECT * FROM ${tabela} WHERE demanda_id = ? ORDER BY rowid`).all(demandaId);
  return {
    rodadas: filhas("rodada").map((rodada) => ({ ...rodada, e2e: rodada.e2e === 1 })),
    dependencias_rodada: filhas("dependencia_rodada"),
    criterios_citados: filhas("criterio_citado_rodada"),
    tickets: filhas("ticket_demanda").map((ticket) =>
      semNulos(linhaComConfiguracaoAgente(agruparColunasDoCampo(ticket, "criado_por"))),
    ),
    dependencias_ticket: filhas("dependencia_ticket"),
    caminhos_ticket: filhas("caminho_ticket"),
    arquivos_previstos_rodada: filhas("arquivo_previsto_rodada"),
    arquivos_previstos_demanda: filhas("arquivo_previsto_demanda"),
    versoes_plano: filhas("versao_plano").map(({ dados, ...versao }) => ({
      ...semNulos(agruparColunasDoCampo(versao, "autor")),
      dados: JSON.parse(dados as string) as unknown,
    })),
  };
}
