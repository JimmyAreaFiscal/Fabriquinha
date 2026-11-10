// Repositório do agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4): carrega e grava só a diferença.
// Não revalida ao gravar: o domínio valida a transição e o banco é a segunda barreira.
import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import type { Ator } from "../nucleo/ator.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclos.ts";
import { encontrado, ErroDeRegra } from "../nucleo/erros.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import type { ResultadoDaTentativa } from "../nucleo/tentativa.ts";
import { escrever, novoId } from "./banco.ts";
import { colunasDaConfiguracaoAgente, linhaComConfiguracaoAgente } from "./configuracao_agente.ts";

type Linha = Record<string, SQLInputValue>;

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

/** Um grupo de colunas opcionais que existe por inteiro ou não existe (`integracao`, `falha`, ...). */
const grupo = (campos: Record<string, unknown>) => (Object.values(campos).includes(null) ? null : campos);

const bit = (b: boolean) => Number(b);

/** O Ator nas colunas `<prefixo>_tipo` e `<prefixo>_trabalho_id`; a ferramenta e a sessão do externo só a evidência guarda. */
const colunasDoAtor = (prefixo: string, ator: Ator): Linha => ({
  [`${prefixo}_tipo`]: ator.tipo,
  [`${prefixo}_trabalho_id`]: ator.tipo === "agente" ? ator.trabalho_id : null,
});

/** Troca as colunas `<campo>_*` da linha pelo Ator `campo`; a coluna nula não entra nele. */
function comAtor(linha: Record<string, unknown>, campo: string): Record<string, unknown> {
  const ator: Record<string, unknown> = {};
  const resto: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(linha)) {
    if (!coluna.startsWith(`${campo}_`)) resto[coluna] = valor;
    else if (valor !== null) ator[coluna.slice(campo.length + 1)] = valor;
  }
  return { ...resto, [campo]: ator };
}

/**
 * O resultado da Tentativa nas colunas `resultado_tipo`, `causa` e `motivo`. A `causa` é a da falha de infraestrutura
 * ou, em `interrompida`, o tipo do Ator que interrompeu.
 */
function colunasDoResultado(resultado: ResultadoDaTentativa | undefined): Linha {
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

interface Tabela {
  nome: string;
  chave: readonly string[];
  linhas: (ag: AgregadoDemanda) => Linha[];
}

/** `dependencia_ticket.rodada_id` é derivado da rodada do ticket; sem rodada vira NULL e o banco recusa. */
const rodadaDoTicket = (ag: AgregadoDemanda, ticketId: number) =>
  ag.tickets.find((t) => t.ticket_id === ticketId)?.rodada_id ?? null;

/**
 * Tabelas do agregado, dos pais para os filhos: insere e atualiza nessa ordem e apaga na inversa, porque as FKs
 * são RESTRICT. A evidência não tem `id` aqui: ele nasce no INSERT e a chave da diferença inclui o `em`.
 */
const TABELAS: readonly Tabela[] = [
  {
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
  },
  {
    nome: "rodada",
    chave: ["demanda_id", "rodada_id"],
    linhas: (ag) => ag.rodadas.map((r) => ({ ...r, e2e: bit(r.e2e) })),
  },
  {
    nome: "pull_request",
    chave: ["demanda_id", "rodada_id"],
    linhas: (ag) =>
      ag.pull_requests.map((pr) => ({ ...pr, demanda_id: ag.demanda.id, rodada_id: pr.rodada_id ?? null })),
  },
  {
    nome: "dependencia_rodada",
    chave: ["demanda_id", "rodada_id", "depende_rodada_id"],
    linhas: (ag) => ag.dependencias_rodada,
  },
  {
    nome: "criterio_citado_rodada",
    chave: ["demanda_id", "rodada_id", "criterio_id"],
    linhas: (ag) => ag.criterios_citados,
  },
  {
    nome: "ticket_demanda",
    chave: ["demanda_id", "ticket_id"],
    linhas: (ag) =>
      ag.tickets.map(({ criado_por, configuracao_agente, ...t }) => ({
        ...t,
        ...colunasDoAtor("criado_por", criado_por),
        rodada_id: t.rodada_id ?? null,
        titulo: t.titulo ?? null,
        descricao: t.descricao ?? null,
        ...colunasDaConfiguracaoAgente(configuracao_agente),
        instrucao: t.instrucao ?? null,
      })),
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
    nome: "dependencia_ticket",
    chave: ["demanda_id", "ticket_id", "depende_ticket_id"],
    linhas: (ag) => ag.dependencias_ticket.map((d) => ({ ...d, rodada_id: rodadaDoTicket(ag, d.ticket_id) })),
  },
  { nome: "caminho_ticket", chave: ["demanda_id", "ticket_id", "caminho"], linhas: (ag) => ag.caminhos_ticket },
  {
    nome: "arquivo_previsto_rodada",
    chave: ["demanda_id", "rodada_id", "caminho"],
    linhas: (ag) => ag.arquivos_previstos_rodada,
  },
  { nome: "arquivo_previsto_demanda", chave: ["demanda_id", "caminho"], linhas: (ag) => ag.arquivos_previstos_demanda },
  {
    nome: "versao_plano",
    chave: ["demanda_id", "numero"],
    linhas: (ag) =>
      ag.versoes_plano.map(({ autor, ...v }) => ({
        ...v,
        ...colunasDoAtor("autor", autor),
        autor_ferramenta: autor.tipo === "externo" ? autor.ferramenta : null,
        autor_sessao: autor.tipo === "externo" ? autor.sessao : null,
        rodada_id: v.rodada_id ?? null,
        dados: JSON.stringify(v.dados),
      })),
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

/** Linhas da tabela no agregado, indexadas pelo JSON dos valores da chave, na ordem de `chave`. */
function porChave(tabela: Tabela, ag: AgregadoDemanda | undefined): Map<string, Linha> {
  const chaveDe = (linha: Linha) => JSON.stringify(tabela.chave.map((c) => linha[c]));
  return new Map((ag ? tabela.linhas(ag) : []).map((linha) => [chaveDe(linha), linha]));
}

/** `a IS $a AND b IS $b` (nomeados) ou `a IS ? AND b IS ?` (posicionais); `IS` casa também o dono nulo. */
const atribuicoes = (colunas: readonly string[], separador: string, operador: string, nomeados = true): string =>
  colunas.map((c) => `${c} ${operador} ${nomeados ? "$" + c : "?"}`).join(separador);

/**
 * Grava só a diferença entre `antes` e `depois`: insere o novo, atualiza o que mudou, apaga o que sumiu.
 * ponytail: comparação linha a linha por igualdade de JSON; o agregado tem dezenas de linhas. Se passar de
 * milhares, trocar por gravação dirigida por eventos do domínio.
 */
function gravarDiferenca(banco: DatabaseSync, antes: AgregadoDemanda | undefined, depois: AgregadoDemanda): void {
  const comparacoes = TABELAS.map((tabela) => ({
    ...tabela,
    velhas: porChave(tabela, antes),
    novas: porChave(tabela, depois),
  }));
  for (const { nome, chave, velhas, novas } of comparacoes.toReversed()) {
    const sql = `DELETE FROM ${nome} WHERE ${atribuicoes(chave, " AND ", "IS", false)}`;
    for (const k of velhas.keys()) {
      if (!novas.has(k)) banco.prepare(sql).run(...(JSON.parse(k) as SQLInputValue[]));
    }
  }
  for (const { nome, chave, velhas, novas } of comparacoes) {
    for (const [k, linha] of novas) {
      const velha = velhas.get(k);
      if (!velha) {
        const nova = nome === "evidencia_demanda" ? { id: randomUUID(), ...linha } : linha;
        const colunas = Object.keys(nova);
        const valores = colunas.map((c) => "$" + c).join(", ");
        banco.prepare(`INSERT INTO ${nome} (${colunas.join(", ")}) VALUES (${valores})`).run(nova);
      } else if (JSON.stringify(velha) !== JSON.stringify(linha)) {
        const sets = atribuicoes(
          Object.keys(linha).filter((c) => !chave.includes(c)),
          ", ",
          "=",
        );
        banco.prepare(`UPDATE ${nome} SET ${sets} WHERE ${atribuicoes(chave, " AND ", "IS")}`).run(linha);
      }
    }
  }
}

function carregar(banco: DatabaseSync, id: string): AgregadoDemanda | undefined {
  const demanda = banco.prepare("SELECT * FROM demanda WHERE id = ?").get(id);
  if (!demanda) return undefined;
  const filhas = (tabela: string) =>
    banco.prepare(`SELECT * FROM ${tabela} WHERE demanda_id = ? ORDER BY rowid`).all(id);
  const enc = banco.prepare("SELECT * FROM encerramento_demanda WHERE demanda_id = ?").get(id);
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
    rodadas: filhas("rodada").map((r) => ({ ...r, e2e: r.e2e === 1 })),
    pull_requests: banco
      .prepare("SELECT * FROM pull_request WHERE demanda_id = ? ORDER BY rowid")
      .all(id)
      .map(semNulos),
    dependencias_rodada: filhas("dependencia_rodada"),
    criterios_citados: filhas("criterio_citado_rodada"),
    tickets: filhas("ticket_demanda").map((t) => semNulos(linhaComConfiguracaoAgente(comAtor(t, "criado_por")))),
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
    dependencias_ticket: filhas("dependencia_ticket"),
    caminhos_ticket: filhas("caminho_ticket"),
    arquivos_previstos_rodada: filhas("arquivo_previsto_rodada"),
    arquivos_previstos_demanda: filhas("arquivo_previsto_demanda"),
    versoes_plano: filhas("versao_plano").map(({ dados, ...v }) => ({
      ...semNulos(comAtor(v, "autor")),
      dados: JSON.parse(dados as string) as unknown,
    })),
    decisoes: filhas("decisao_ticket").map((d) =>
      semNulos(
        comAtor(
          {
            ...d,
            por_trabalho_id: d.por_tipo === "agente" ? (d.por_trabalho_id ?? TRABALHO_ANTERIOR_A_MIGRACAO) : null,
          },
          "por",
        ),
      ),
    ),
    evidencias: filhas("evidencia_demanda").map(({ id: _, dados, ...e }) => ({
      ...semNulos(comAtor(e, "autor")),
      dados: JSON.parse(dados as string) as unknown,
    })),
  });
}

const existente = (banco: DatabaseSync, id: string): AgregadoDemanda =>
  encontrado(carregar(banco, id), `a demanda ${id} não existe`, "confira o id da demanda");

/** O agregado da demanda, lido num snapshot só; demanda inexistente dá `ErroDeInexistente`. */
export function carregarDemanda(banco: DatabaseSync, id: string): AgregadoDemanda {
  const propria = !banco.isTransaction; // dentro de `escrever` a leitura já é parte da transação
  if (propria) banco.exec("BEGIN");
  try {
    return existente(banco, id);
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}

/**
 * As demandas em ordem de criação; as arquivadas só com `arquivadas: true` (o board não as mostra) e, com
 * `soNaoTerminadas`, só as que não terminaram (o Início).
 */
export function listarDemandas(
  banco: DatabaseSync,
  { arquivadas = false, soNaoTerminadas = false }: { arquivadas?: boolean; soNaoTerminadas?: boolean } = {},
): AgregadoDemanda[] {
  const propria = !banco.isTransaction;
  if (propria) banco.exec("BEGIN");
  try {
    const filtro = soNaoTerminadas
      ? `WHERE NOT ${CICLO_DA_DEMANDA.sqlDosTerminais("estado")}`
      : arquivadas
        ? ""
        : "WHERE estado <> 'arquivada'";
    const ids = banco.prepare(`SELECT id FROM demanda ${filtro} ORDER BY rowid`).all();
    return ids.map((l) => existente(banco, String(l.id)));
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}

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
