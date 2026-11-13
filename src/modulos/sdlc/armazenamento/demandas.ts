// Repositório do agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4): carrega e grava só a diferença.
// Não revalida ao gravar: o domínio valida a transição e o banco é a segunda barreira. As tabelas dos itens de
// Planejamento (rodadas, tickets, vínculos e versões do Plano) passam pela API dele.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { AgregadoDemanda } from "../nucleo/demanda/agregado_demanda.ts";
import type { Ator } from "../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclo_de_vida/ciclos.ts";
import { encontrado, ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import type { EstadoDemanda } from "../nucleo/ciclo_de_vida/ciclos.ts";
import type { ResultadoDaTentativa } from "../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import { escrever, novoId } from "../../compartilhado/armazenamento/banco.ts";
import { lerEmSnapshot } from "../../compartilhado/armazenamento/snapshot.ts";
import {
  agruparColunasDoCampo,
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  type LinhaDaTabela,
  semNulos,
  type TabelaDoAgregado,
} from "../../../shared/armazenamento/diferenca_do_agregado.ts";
import {
  apagarItensQueSumiram,
  carregarItensDoPlanejamento,
  gravarItensNovosEMudados,
} from "../../ciclo_de_vida/publico.ts";

/** Um grupo de colunas opcionais que existe por inteiro ou não existe (`integracao`, `falha`, ...). */
const grupo = (campos: Record<string, unknown>) => (Object.values(campos).includes(null) ? null : campos);

const bit = (b: boolean) => Number(b);

/** O Ator nas colunas `<prefixo>_tipo` e `<prefixo>_trabalho_id`; a ferramenta e a sessão do externo só a evidência guarda. */
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

/** Decisão do Agente gravada antes da migração 37, sem execução: o `trabalho_id` não existe, mas o Ator exige um. */
const TRABALHO_ANTERIOR_A_MIGRACAO = "anterior-a-migracao-37";

/** A linha única da demanda: a mãe de todas as tabelas do agregado. */
const TABELA_DA_DEMANDA: TabelaDoAgregado<AgregadoDemanda> = {
  nome: "demanda",
  chave: ["id"],
  linhas: ({ demanda: { criada_por, ...demanda } }) => [
    {
      ...demanda,
      criada_por_ferramenta: criada_por.ferramenta,
      criada_por_sessao: criada_por.sessao,
      enviada: bit(demanda.enviada),
    },
  ],
};

/**
 * As tabelas do agregado que dependem dos itens de Planejamento, dos pais para os filhos: insere e atualiza nessa ordem
 * e apaga na inversa, porque as FKs são RESTRICT. A evidência não tem `id` aqui: ele nasce no INSERT e a chave da
 * diferença inclui o `em`.
 */
const TABELAS_QUE_DEPENDEM_DOS_ITENS: readonly TabelaDoAgregado<AgregadoDemanda>[] = [
  {
    nome: "pull_request",
    chave: ["demanda_id", "rodada_id"],
    linhas: (ag) =>
      ag.pull_requests.map((pr) => ({ ...pr, demanda_id: ag.demanda.id, rodada_id: pr.rodada_id ?? null })),
  },
  {
    nome: "tentativa",
    chave: ["demanda_id", "ticket_id", "numero"],
    linhas: (ag) =>
      ag.tentativas.map(({ ticket, resultado, ...t }) => ({
        demanda_id: ticket.demanda_id,
        ticket_id: Number(ticket.ticket_id),
        numero: t.numero,
        processo_id: t.processo_id ?? null,
        inicio: t.inicio,
        fim: t.fim ?? null,
        ...colunasDoResultado(resultado),
        instrucao: t.instrucao ?? null,
        migrada: bit(t.migrada === true),
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
    linhas: (ag) =>
      ag.decisoes.map(({ por, ...d }) => ({
        ...d,
        ...colunasDoAtor("por", por),
        nota: d.nota ?? null,
        motivo: d.motivo ?? null,
      })),
  },
  {
    nome: "evidencia_demanda",
    idNasceNoInsert: true,
    chave: ["demanda_id", "rodada_id", "ticket_id", "tipo", "em"],
    linhas: (ag) =>
      ag.evidencias.map(({ autor, ...e }) => ({
        ...e,
        ...colunasDoAtor("autor", autor),
        autor_ferramenta: autor.tipo === "externo" ? autor.ferramenta : null,
        autor_sessao: autor.tipo === "externo" ? autor.sessao : null,
        rodada_id: e.rodada_id ?? null,
        ticket_id: e.ticket_id ?? null,
        dados: JSON.stringify(e.dados),
      })),
  },
];

/**
 * Grava só a diferença entre `antes` e `depois`: insere o novo, atualiza o que mudou, apaga o que sumiu. Os itens de
 * Planejamento ficam no meio: dependem só da demanda, e as demais tabelas dependem deles.
 */
function gravarDiferenca(banco: DatabaseSync, antes: AgregadoDemanda | undefined, depois: AgregadoDemanda): void {
  apagarLinhasQueSumiram(banco, TABELAS_QUE_DEPENDEM_DOS_ITENS, antes, depois);
  apagarItensQueSumiram(banco, antes, depois);
  apagarLinhasQueSumiram(banco, [TABELA_DA_DEMANDA], antes, depois);
  gravarLinhasNovasEMudadas(banco, [TABELA_DA_DEMANDA], antes, depois);
  gravarItensNovosEMudados(banco, antes, depois);
  gravarLinhasNovasEMudadas(banco, TABELAS_QUE_DEPENDEM_DOS_ITENS, antes, depois);
}

function carregar(
  banco: DatabaseSync,
  id: string,
  preparar: (sql: string) => StatementSync = (sql) => banco.prepare(sql),
): AgregadoDemanda | undefined {
  const demanda = preparar("SELECT * FROM demanda WHERE id = ?").get(id);
  if (!demanda) return undefined;
  const filhas = (tabela: string) => preparar(`SELECT * FROM ${tabela} WHERE demanda_id = ? ORDER BY rowid`).all(id);
  const enc = preparar("SELECT * FROM encerramento_demanda WHERE demanda_id = ?").get(id);
  return AgregadoDemanda.parse({
    ...(enc && {
      encerramento: semNulos({
        demanda_id: id,
        branch: enc.branch,
        base: enc.base,
        sha_verificado: enc.sha_verificado,
        aguardando_merge_humano: enc.aguardando_merge_humano === 1 || null,
        integracao: grupo({ sha: enc.integracao_sha }),
        limpeza_pendente: filhas("limpeza_pendente_encerramento").map((l) => l.limpeza_pendente),
        conflito_pendente: grupo({ ticket_id: enc.conflito_ticket_id }),
        falha: grupo({ etapa: enc.falha_etapa, motivo: enc.falha_motivo }),
      }),
    }),
    demanda: {
      ...demanda,
      criada_por: { tipo: "externo", ferramenta: demanda.criada_por_ferramenta, sessao: demanda.criada_por_sessao },
      enviada: demanda.enviada === 1,
    },
    ...carregarItensDoPlanejamento(preparar, id),
    pull_requests: preparar("SELECT * FROM pull_request WHERE demanda_id = ? ORDER BY rowid").all(id).map(semNulos),
    tentativas: filhas("tentativa").map((t) => ({
      ...semNulos({
        numero: t.numero,
        processo_id: t.processo_id,
        inicio: t.inicio,
        fim: t.fim,
        instrucao: t.instrucao,
        migrada: t.migrada === 1 || null,
        resultado: resultadoDaLinha(t),
      }),
      ticket: Endereco.doTicket(String(t.demanda_id), Number(t.ticket_id)),
    })),
    decisoes: filhas("decisao_ticket").map((d) =>
      semNulos(
        agruparColunasDoCampo(
          {
            ...d,
            por_trabalho_id: d.por_tipo === "agente" ? (d.por_trabalho_id ?? TRABALHO_ANTERIOR_A_MIGRACAO) : null,
          },
          "por",
        ),
      ),
    ),
    evidencias: filhas("evidencia_demanda").map(({ id: _, dados, ...e }) => ({
      ...semNulos(agruparColunasDoCampo(e, "autor")),
      dados: JSON.parse(dados as string) as unknown,
    })),
  });
}

const existente = (banco: DatabaseSync, id: string): AgregadoDemanda =>
  encontrado(carregar(banco, id), `a demanda ${id} não existe`, "confira o id da demanda");

/** O agregado da demanda, lido num snapshot só; demanda inexistente dá `ErroDeInexistente`. */
export function carregarDemanda(banco: DatabaseSync, id: string): AgregadoDemanda {
  return lerEmSnapshot(banco, () => existente(banco, id));
}

/**
 * Os agregados de `ids`, na ordem pedida, lidos num snapshot só e com cada SQL preparado uma vez, não uma por demanda;
 * demanda inexistente dá `ErroDeInexistente`.
 * @testes o teste exercita direto; a produção a usa só dentro do módulo (a consulta que a usa vem em seguida)
 */
export function carregarDemandas(banco: DatabaseSync, ids: readonly string[]): AgregadoDemanda[] {
  const preparados = new Map<string, StatementSync>();
  const preparar = (sql: string) => {
    const preparado = preparados.get(sql) ?? banco.prepare(sql);
    preparados.set(sql, preparado);
    return preparado;
  };
  return lerEmSnapshot(banco, () =>
    ids.map((id) => encontrado(carregar(banco, id, preparar), `a demanda ${id} não existe`, "confira o id da demanda")),
  );
}

/**
 * As demandas em ordem de criação; as arquivadas só com `arquivadas: true` (o board não as mostra) e, com
 * `soNaoTerminadas`, só as que não terminaram (o Início).
 */
export function listarDemandas(
  banco: DatabaseSync,
  { arquivadas = false, soNaoTerminadas = false }: { arquivadas?: boolean; soNaoTerminadas?: boolean } = {},
): AgregadoDemanda[] {
  return lerEmSnapshot(banco, () => {
    const filtro = soNaoTerminadas
      ? `WHERE NOT ${CICLO_DA_DEMANDA.sqlDosTerminais("estado")}`
      : arquivadas
        ? ""
        : "WHERE estado <> 'arquivada'";
    const ids = banco.prepare(`SELECT id FROM demanda ${filtro} ORDER BY rowid`).all();
    return carregarDemandas(
      banco,
      ids.map((l) => String(l.id)),
    );
  });
}

/** As demandas do projeto, das mais novas para as mais antigas, só com o id e o estado. */
export const situacaoDasDemandas = (banco: DatabaseSync, projeto: string): { id: string; estado: EstadoDemanda }[] =>
  banco.prepare("SELECT id, estado FROM demanda WHERE projeto = ? ORDER BY rowid DESC").all(projeto) as {
    id: string;
    estado: EstadoDemanda;
  }[];

/**
 * Demanda nova: a persistência só aloca o ID da sequência `issue` (D09); `montar` monta o agregado com ele. Erro em
 * `montar`, no ID devolvido ou na gravação desfaz a transação, sequência incluída.
 */
export const criarDemandaNova = (banco: DatabaseSync, montar: (id: string) => AgregadoDemanda): AgregadoDemanda =>
  escrever(banco, () => {
    const id = `I-${String(novoId(banco, "demanda"))}`;
    const agregado = montar(id);
    if (agregado.demanda.id !== id) {
      throw new ErroDeRegra(
        `o agregado montado tem o ID ${agregado.demanda.id}, mas a sequência alocou ${id}`,
        `monte a demanda com o id recebido (${id})`,
      );
    }
    gravarDiferenca(banco, undefined, agregado);
    return agregado;
  });

/**
 * Carrega a demanda, aplica a transição do domínio e grava a diferença numa transação só. `aposGravar` roda ainda
 * dentro dela, depois da diferença (é como anexos e sessões externas entram junto da evidência).
 */
export const comDemanda = (
  banco: DatabaseSync,
  id: string,
  transicao: (agregado: AgregadoDemanda) => AgregadoDemanda,
  aposGravar?: (depois: AgregadoDemanda) => void,
): AgregadoDemanda =>
  escrever(banco, () => {
    const antes = existente(banco, id);
    const depois = transicao(antes);
    gravarDiferenca(banco, antes, depois);
    aposGravar?.(depois);
    return depois;
  });

/** A execução do agente com o trabalho, o ticket e o projeto dela; `fim` é nulo enquanto a execução está aberta. */
interface EscopoDoProcessoNoBanco {
  readonly fim: string | null;
  readonly sessao: string;
  readonly demanda_id: string;
  readonly ticket_id: number;
  readonly projeto: string;
}

/** O escopo de `execucao`, aberta ou terminada, ou `undefined` se ela não está em `processo_do_trabalho`. */
export function carregarEscopoDoProcesso(banco: DatabaseSync, execucao: string): EscopoDoProcessoNoBanco | undefined {
  const linha = banco
    .prepare(
      `SELECT e.fim, s.id AS sessao, s.demanda_id, s.ticket_id, d.projeto
         FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id JOIN demanda d ON d.id = s.demanda_id
        WHERE e.id = ?`,
    )
    .get(execucao);
  return (
    linha && {
      fim: linha.fim === null ? null : String(linha.fim),
      sessao: String(linha.sessao),
      demanda_id: String(linha.demanda_id),
      ticket_id: Number(linha.ticket_id),
      projeto: String(linha.projeto),
    }
  );
}

/** O achado de avaliação que originou a demanda (a avaliação o liga à demanda que ele virou), ou `undefined`. */
export const achadoDaDemanda = (banco: DatabaseSync, demandaId: string) =>
  banco.prepare("SELECT avaliacao_id, achado_id, titulo FROM achado_avaliacao WHERE demanda_id = ?").get(demandaId) as
    { avaliacao_id: string; achado_id: number; titulo: string } | undefined;
