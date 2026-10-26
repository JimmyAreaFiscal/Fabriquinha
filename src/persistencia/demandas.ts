// Repositório do agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4): carrega e grava só a diferença, no padrão de
// issues.ts. Não revalida ao gravar: o domínio valida a transição e o banco é a segunda barreira.
import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { encontrado } from "../dominio/erros.ts";
import { escrever } from "./banco.ts";

type Linha = Record<string, SQLInputValue>;

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

/** Um grupo de colunas opcionais que existe por inteiro ou não existe (`pr`, `integracao`, ...). */
const grupo = (campos: Record<string, unknown>) => (Object.values(campos).includes(null) ? null : campos);

const bit = (b: boolean) => Number(b);

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
    linhas: (ag) => [{ ...ag.demanda, enviada: bit(ag.demanda.enviada) }],
  },
  {
    nome: "rodada",
    chave: ["demanda_id", "rodada_id"],
    linhas: (ag) => ag.rodadas.map((r) => ({ ...r, e2e: bit(r.e2e) })),
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
      ag.tickets.map((t) => ({
        ...t,
        rodada_id: t.rodada_id ?? null,
        titulo: t.titulo ?? null,
        descricao: t.descricao ?? null,
        modelo_provedor: t.modelo_provedor ?? null,
        modelo_nome: t.modelo_nome ?? null,
        effort: t.effort ?? null,
        instrucao: t.instrucao ?? null,
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
              pr_numero: e.pr?.numero ?? null,
              pr_url: e.pr?.url ?? null,
              branch: e.branch,
              base: e.base,
              sha_verificado: e.sha_verificado ?? null,
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
    nome: "decisao_ticket",
    chave: ["demanda_id", "ticket_id", "decisao_id"],
    linhas: (ag) => ag.decisoes.map((d) => ({ ...d, nota: d.nota ?? null, motivo: d.motivo ?? null })),
  },
  {
    nome: "evidencia_demanda",
    chave: ["demanda_id", "rodada_id", "ticket_id", "tipo", "em"],
    linhas: (ag) =>
      ag.evidencias.map((e) => ({
        ...e,
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
        pr: grupo({ numero: enc.pr_numero, url: enc.pr_url }),
        branch: enc.branch,
        base: enc.base,
        sha_verificado: enc.sha_verificado,
        integracao: grupo({ sha: enc.integracao_sha }),
        limpeza_pendente: filhas("limpeza_pendente_encerramento").map((l) => l.limpeza_pendente),
        conflito_pendente: grupo({ ticket_id: enc.conflito_ticket_id }),
        falha: grupo({ etapa: enc.falha_etapa, motivo: enc.falha_motivo }),
      }),
    }),
    demanda: { ...demanda, enviada: demanda.enviada === 1 },
    rodadas: filhas("rodada").map((r) => ({ ...r, e2e: r.e2e === 1 })),
    dependencias_rodada: filhas("dependencia_rodada"),
    criterios_citados: filhas("criterio_citado_rodada"),
    tickets: filhas("ticket_demanda").map(semNulos),
    dependencias_ticket: filhas("dependencia_ticket"),
    caminhos_ticket: filhas("caminho_ticket"),
    decisoes: filhas("decisao_ticket").map(semNulos),
    evidencias: filhas("evidencia_demanda").map(({ id: _, dados, ...e }) => ({
      ...semNulos(e),
      dados: JSON.parse(dados as string) as unknown,
    })),
  });
}

const existente = (banco: DatabaseSync, id: string): AgregadoDemanda =>
  encontrado(carregar(banco, id), `a demanda ${id} não existe`, "confira o id da demanda");

/** O agregado da demanda, lido num snapshot só; demanda inexistente dá `ErroDeInexistente`. */
export function carregarDemanda(banco: DatabaseSync, id: string): AgregadoDemanda {
  banco.exec("BEGIN");
  try {
    return existente(banco, id);
  } finally {
    banco.exec("COMMIT");
  }
}

/** Grava a demanda nova com tudo o que o agregado traz, numa transação só. */
export const criarDemanda = (banco: DatabaseSync, agregado: AgregadoDemanda): AgregadoDemanda =>
  escrever(banco, () => {
    gravarDiferenca(banco, undefined, agregado);
    return agregado;
  });

/** Carrega a demanda, aplica a transição do domínio e grava a diferença numa transação só. */
export const comDemanda = (
  banco: DatabaseSync,
  id: string,
  transicao: (agregado: AgregadoDemanda) => AgregadoDemanda,
): AgregadoDemanda =>
  escrever(banco, () => {
    const antes = existente(banco, id);
    const depois = transicao(antes);
    gravarDiferenca(banco, antes, depois);
    return depois;
  });
