// As tabelas do Processo (MELHORIAS §5.1): as Tentativas, as Decisões dos gates, o progresso do encerramento e as
// históricas da iteração e da proposta. Este é o único arquivo que fala SQL com elas; o agregado da demanda as carrega e
// grava por aqui, depois dos itens de Planejamento e do PR final, de que dependem.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { z } from "zod";
import { type Ator, Endereco, type ResultadoDaTentativa } from "../../etapas/publico.ts";
import {
  agruparColunasDoCampo,
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  type LinhaDaTabela,
  semNulos,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/diferenca_do_agregado.ts";
import type { Decisao } from "../nucleo/gate.ts";
import type { ProgressoEncerramento } from "../nucleo/progresso_do_encerramento.ts";
import { Tentativa } from "../nucleo/tentativa.ts";

/** O estado do desenvolvimento que o Processo grava, como o agregado da demanda o guarda. */
interface EstadoDoProcesso {
  readonly tentativas: readonly Tentativa[];
  readonly decisoes: readonly Decisao[];
  readonly encerramento?: ProgressoEncerramento;
}

/** Um grupo de colunas opcionais que existe por inteiro ou não existe (`integracao`, `falha`, ...). */
const grupo = (campos: Record<string, unknown>) => (Object.values(campos).includes(null) ? null : campos);

const bit = (valor: boolean) => Number(valor);

/** O Ator nas colunas `<prefixo>_tipo` e `<prefixo>_trabalho_id`; a ferramenta e a sessão do externo a Decisão não guarda. */
const colunasDoAtor = (prefixo: string, ator: Ator): LinhaDaTabela => ({
  [`${prefixo}_tipo`]: ator.tipo,
  [`${prefixo}_trabalho_id`]: ator.tipo === "agente" ? ator.trabalho_id : null,
});

/**
 * O resultado da Tentativa nas colunas `resultado_tipo`, `causa` e `motivo`. A `causa` é a da falha de infraestrutura
 * ou, em `interrompida`, o tipo do Ator que interrompeu.
 */
function colunasDoResultado(resultado: ResultadoDaTentativa | undefined): LinhaDaTabela {
  return {
    resultado_tipo: resultado?.tipo ?? null,
    causa:
      resultado?.tipo === "falha_infraestrutura"
        ? resultado.causa
        : resultado?.tipo === "interrompida"
          ? resultado.por.tipo
          : null,
    motivo: resultado && "motivo" in resultado ? (resultado.motivo ?? null) : null,
  };
}

/** O inverso de `colunasDoResultado`, para o domínio validar. */
function resultadoDaLinha({ resultado_tipo, causa, motivo }: Record<string, unknown>): unknown {
  if (resultado_tipo === null) return null;
  const semCausa = semNulos({ tipo: resultado_tipo, motivo });
  if (resultado_tipo === "interrompida") return { ...semCausa, por: { tipo: causa } };
  return causa === null ? semCausa : { ...semCausa, causa };
}

/** A linha de `tentativa` como o domínio a lê: o endereço do ticket e o resultado montados das colunas. */
const tentativaDaLinha = (linha: Record<string, unknown>) => ({
  ...semNulos({
    numero: linha.numero,
    processo_id: linha.processo_id,
    inicio: linha.inicio,
    fim: linha.fim,
    instrucao: linha.instrucao,
    migrada: linha.migrada === 1 || null,
    resultado: resultadoDaLinha(linha),
  }),
  ticket: Endereco.doTicket(String(linha.demanda_id), Number(linha.ticket_id)),
});

/** Decisão do Agente gravada antes da migração 37, sem execução: o `trabalho_id` não existe, mas o Ator exige um. */
const TRABALHO_ANTERIOR_A_MIGRACAO = "anterior-a-migracao-37";

/**
 * As tabelas, dos pais para os filhos: insere e atualiza nessa ordem e apaga na inversa (as FKs são RESTRICT). Todas
 * dependem da demanda e dos tickets, e a integração do encerramento, do PR final.
 */
const TABELAS_DO_PROCESSO: readonly TabelaDoAgregado<EstadoDoProcesso>[] = [
  {
    nome: "tentativa",
    chave: ["demanda_id", "ticket_id", "numero"],
    linhas: (estado) =>
      estado.tentativas.map(({ ticket, resultado, ...tentativa }) => ({
        demanda_id: ticket.demanda_id,
        ticket_id: Number(ticket.ticket_id),
        numero: tentativa.numero,
        processo_id: tentativa.processo_id ?? null,
        inicio: tentativa.inicio,
        fim: tentativa.fim ?? null,
        ...colunasDoResultado(resultado),
        instrucao: tentativa.instrucao ?? null,
        migrada: bit(tentativa.migrada === true),
      })),
  },
  {
    nome: "encerramento_demanda",
    chave: ["demanda_id"],
    linhas: ({ encerramento: e }) =>
      e
        ? [
            {
              demanda_id: e.demanda_id,
              branch: e.branch,
              base: e.base,
              sha_verificado: e.sha_verificado ?? null,
              aguardando_merge_humano: bit(e.aguardando_merge_humano === true),
              integracao_sha: e.integracao?.sha ?? null,
              conflito_ticket_id: e.conflito_pendente?.ticket_id ?? null,
              falha_etapa: e.falha?.etapa ?? null,
              falha_motivo: e.falha?.motivo ?? null,
            },
          ]
        : [],
  },
  {
    nome: "limpeza_pendente_encerramento",
    chave: ["demanda_id", "limpeza_pendente"],
    linhas: ({ encerramento: e }) =>
      e?.limpeza_pendente.map((limpeza_pendente) => ({ demanda_id: e.demanda_id, limpeza_pendente })) ?? [],
  },
  {
    nome: "decisao_ticket",
    chave: ["demanda_id", "ticket_id", "decisao_id"],
    linhas: (estado) =>
      estado.decisoes.map(({ por, ...decisao }) => ({
        ...decisao,
        ...colunasDoAtor("por", por),
        nota: decisao.nota ?? null,
        motivo: decisao.motivo ?? null,
      })),
  },
];

/** Apaga o estado que sumiu entre `antes` e `depois`; vem antes de apagar os PRs e os itens de Planejamento. */
export const apagarEstadoQueSumiu = (
  banco: DatabaseSync,
  antes: EstadoDoProcesso | undefined,
  depois: EstadoDoProcesso,
): void => {
  apagarLinhasQueSumiram(banco, TABELAS_DO_PROCESSO, antes, depois);
};

/** Insere o estado novo e atualiza o que mudou; vem depois de gravar os itens de Planejamento e os PRs. */
export const gravarEstadoNovoEMudado = (
  banco: DatabaseSync,
  antes: EstadoDoProcesso | undefined,
  depois: EstadoDoProcesso,
): void => {
  gravarLinhasNovasEMudadas(banco, TABELAS_DO_PROCESSO, antes, depois);
};

/** O estado do Processo da demanda, como está no banco, para o agregado validar; `preparar` reaproveita o SQL. */
export function carregarEstadoDoProcesso(preparar: (sql: string) => StatementSync, demandaId: string) {
  const filhas = (tabela: string) =>
    preparar(`SELECT * FROM ${tabela} WHERE demanda_id = ? ORDER BY rowid`).all(demandaId);
  const encerramento = preparar("SELECT * FROM encerramento_demanda WHERE demanda_id = ?").get(demandaId);
  return {
    ...(encerramento && {
      encerramento: semNulos({
        demanda_id: demandaId,
        branch: encerramento.branch,
        base: encerramento.base,
        sha_verificado: encerramento.sha_verificado,
        aguardando_merge_humano: encerramento.aguardando_merge_humano === 1 || null,
        integracao: grupo({ sha: encerramento.integracao_sha }),
        limpeza_pendente: filhas("limpeza_pendente_encerramento").map((limpeza) => limpeza.limpeza_pendente),
        conflito_pendente: grupo({ ticket_id: encerramento.conflito_ticket_id }),
        falha: grupo({ etapa: encerramento.falha_etapa, motivo: encerramento.falha_motivo }),
      }),
    }),
    tentativas: filhas("tentativa").map(tentativaDaLinha),
    decisoes: filhas("decisao_ticket").map((decisao) =>
      semNulos(
        agruparColunasDoCampo(
          {
            ...decisao,
            por_trabalho_id:
              decisao.por_tipo === "agente" ? (decisao.por_trabalho_id ?? TRABALHO_ANTERIOR_A_MIGRACAO) : null,
          },
          "por",
        ),
      ),
    ),
  };
}

/**
 * As Tentativas das demandas, em lote e sem carregar o agregado: na ordem em que aconteceram, cada uma com o endereço
 * do ticket dela.
 */
export const lerTentativasDasDemandas = (banco: DatabaseSync, demandaIds: readonly string[]): Tentativa[] =>
  z
    .array(Tentativa)
    .parse(
      banco
        .prepare("SELECT * FROM tentativa WHERE demanda_id IN (SELECT value FROM json_each(?)) ORDER BY rowid")
        .all(JSON.stringify(demandaIds))
        .map(tentativaDaLinha),
    );

/**
 * Apaga todo o estado do Processo das demandas (a remoção do projeto), antes dos itens de Planejamento e das próprias
 * demandas; a proposta sai também quando foi ela que criou uma das demandas.
 */
export function apagarEstadoDoProcessoDasDemandas(banco: DatabaseSync, demandaIds: readonly string[]): void {
  const dasDemandas = "(SELECT value FROM json_each($demandas))";
  const apagar = (tabela: string, onde = `demanda_id IN ${dasDemandas}`) =>
    banco.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run({ demandas: JSON.stringify(demandaIds) });
  apagar("iteracao_demanda");
  apagar("proposta_demanda", `demanda_id IN ${dasDemandas} OR demanda_criada_id IN ${dasDemandas}`);
  apagar("decisao_ticket");
  apagar("limpeza_pendente_encerramento");
  apagar("encerramento_demanda");
  apagar("tentativa");
}
