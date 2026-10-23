// Aplicação dos comandos do F1 sobre o agregado da issue (F2 §3.3, §3.5, §6): carrega, aplica, grava a diferença.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  type Agregado,
  type ArquivoEvidencia,
  type Ator,
  type Contexto,
  Decisao,
  Evidencia,
  Execucao,
  exigirNaoCancelada,
  Issue,
  type NomeComando,
  PropostaIssue,
  Ticket,
} from "../dominio/agregado.ts";
import { encontrado } from "../dominio/erros.ts";
import * as dominio from "../dominio/issue.ts";
import * as propostas from "../dominio/propostas.ts";
import type { Fase, Id, Modelo } from "../dominio/primitivos.ts";
import { escrever, novoId } from "./banco.ts";
import { temCommit } from "./commits.ts";
import { projeto } from "./projetos.ts";

type Linha = Record<string, SQLInputValue>;

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

const colunasModelo = (m: Modelo | undefined): Linha => ({
  modelo_provedor: m?.provedor ?? null,
  modelo_nome: m?.modelo ?? null,
});

const deColunasModelo = (l: Linha) =>
  l.modelo_provedor === null ? null : { provedor: l.modelo_provedor, modelo: l.modelo_nome };

const linhaIssue = (i: Issue): Linha => ({
  id: i.id,
  projeto: i.projeto,
  titulo: i.titulo,
  tipo: i.tipo,
  descricao: i.descricao,
  fase: i.fase,
  criada_em: i.criadaEm,
  concluida_em: i.concluidaEm ?? null,
  arquivada_em: i.arquivadaEm ?? null,
  cancelada_em: i.canceladaEm ?? null,
});

const deLinhaIssue = (l: Linha, deps: Id[]): Issue =>
  Issue.parse({
    ...semNulos({ concluidaEm: l.concluida_em, arquivadaEm: l.arquivada_em, canceladaEm: l.cancelada_em }),
    id: l.id,
    projeto: l.projeto,
    titulo: l.titulo,
    tipo: l.tipo,
    descricao: l.descricao,
    fase: l.fase,
    deps,
    criadaEm: l.criada_em,
  });

const linhaTicket = (t: Ticket): Linha => ({
  id: t.id,
  issue: t.issue,
  etapa: t.etapa,
  titulo: t.titulo,
  descricao: t.descricao,
  status: t.status,
  origem: t.origem,
  origem_ticket: t.origemTicket ?? null,
  ...colunasModelo(t.modelo),
  instrucao: t.instrucao ?? null,
  devolucoes: t.devolucoes ?? null,
  erro: t.erro ?? null,
  criado_em: t.criadoEm,
  concluido_em: t.concluidoEm ?? null,
  enviado_em: t.enviadoEm ?? null,
});

const deLinhaTicket = (l: Linha): Ticket =>
  Ticket.parse(
    semNulos({
      id: l.id,
      issue: l.issue,
      etapa: l.etapa,
      titulo: l.titulo,
      descricao: l.descricao,
      status: l.status,
      origem: l.origem,
      origemTicket: l.origem_ticket,
      modelo: deColunasModelo(l),
      instrucao: l.instrucao,
      devolucoes: l.devolucoes,
      erro: l.erro,
      criadoEm: l.criado_em,
      concluidoEm: l.concluido_em,
      enviadoEm: l.enviado_em,
    }),
  );

// `pgid_pi` não é do domínio: o F4 o grava à parte, e o diff não o toca.
const linhaExecucao = (e: Execucao): Linha => ({
  id: e.id,
  ticket: e.ticket,
  modo: e.modo,
  sessao_pi: e.sessaoPi,
  ...colunasModelo(e.modelo),
  resultado: e.resultado,
  erro: e.erro ?? null,
  iniciada_em: e.iniciadaEm,
  terminada_em: e.terminadaEm ?? null,
});

const deLinhaExecucao = (l: Linha): Execucao =>
  Execucao.parse(
    semNulos({
      id: l.id,
      ticket: l.ticket,
      modo: l.modo,
      sessaoPi: l.sessao_pi,
      modelo: deColunasModelo(l),
      resultado: l.resultado,
      erro: l.erro,
      iniciadaEm: l.iniciada_em,
      terminadaEm: l.terminada_em,
    }),
  );

const bit = (b: boolean | undefined) => (b === undefined ? null : Number(b));
const deBit = (v: unknown) => (v === null ? null : v === 1);

const linhaDecisao = (d: Decisao): Linha => ({
  id: d.id,
  issue: d.issue,
  ticket: d.ticket,
  gate: d.gate,
  aprovado: bit(d.aprovado),
  motivo: d.motivo ?? null,
  nota: d.nota ?? null,
  por: d.por,
  em: d.em,
});

const deLinhaDecisao = (l: Linha): Decisao => Decisao.parse(semNulos({ ...l, aprovado: deBit(l.aprovado) }));

// Os anexos vão para `evidencia_arquivo`; a linha da evidência leva o resto, com `dados` em JSON.
const linhaEvidencia = ({ arquivos: _, ...e }: Evidencia): Linha => ({
  id: e.id,
  ticket: e.ticket,
  tipo: e.tipo,
  produtor: e.produtor,
  aprovada: bit(e.aprovada),
  dados: JSON.stringify(e.dados),
  em: e.em,
});

const deLinhaEvidencia = (l: Linha, arquivos: ArquivoEvidencia[]): Evidencia =>
  Evidencia.parse(semNulos({ ...l, aprovada: deBit(l.aprovada), dados: JSON.parse(l.dados as string), arquivos }));

const linhaProposta = (p: PropostaIssue): Linha => ({
  id: p.id,
  ticket: p.ticket,
  titulo: p.titulo,
  mensagem: p.mensagem,
  arquivos: p.arquivos,
  status: p.status,
  issue_criada: p.issueCriada ?? null,
  em: p.em,
  decidida_em: p.decididaEm ?? null,
});

const deLinhaProposta = (l: Linha): PropostaIssue =>
  PropostaIssue.parse(
    semNulos({
      id: l.id,
      ticket: l.ticket,
      titulo: l.titulo,
      mensagem: l.mensagem,
      arquivos: l.arquivos,
      status: l.status,
      issueCriada: l.issue_criada,
      em: l.em,
      decididaEm: l.decidida_em,
    }),
  );

interface Tabela {
  nome: string;
  chave: readonly string[];
  linhas: (ag: Agregado) => Linha[];
}

/**
 * Tabelas do agregado, dos pais para os filhos: insere e atualiza nessa ordem e apaga na inversa, porque as FKs
 * são RESTRICT.
 */
const TABELAS: readonly Tabela[] = [
  { nome: "issue", chave: ["id"], linhas: (ag) => [linhaIssue(ag.issue)] },
  {
    nome: "issue_dep",
    chave: ["issue", "dep"],
    linhas: (ag) => ag.issue.deps.map((dep) => ({ issue: ag.issue.id, dep })),
  },
  { nome: "ticket", chave: ["id"], linhas: (ag) => ag.tickets.map(linhaTicket) },
  { nome: "execucao", chave: ["id"], linhas: (ag) => ag.execucoes.map(linhaExecucao) },
  { nome: "decisao", chave: ["id"], linhas: (ag) => ag.decisoes.map(linhaDecisao) },
  { nome: "evidencia", chave: ["id"], linhas: (ag) => ag.evidencias.map(linhaEvidencia) },
  {
    nome: "evidencia_arquivo",
    chave: ["evidencia", "nome"],
    linhas: (ag) => ag.evidencias.flatMap((e) => e.arquivos.map((a) => ({ evidencia: e.id, ...a }))),
  },
];

/** Linhas da tabela no agregado, indexadas pelo JSON dos valores da chave primária, na ordem de `chave`. */
function porChave(tabela: Tabela, ag: Agregado | undefined): Map<string, Linha> {
  const chaveDe = (linha: Linha) => JSON.stringify(tabela.chave.map((c) => linha[c]));
  return new Map((ag ? tabela.linhas(ag) : []).map((linha) => [chaveDe(linha), linha]));
}

/** `a = $a, b = $b` (parâmetros nomeados) ou `a = ? AND b = ?` (posicionais). */
const atribuicoes = (colunas: readonly string[], separador: string, nomeados = true): string =>
  colunas.map((c) => c + " = " + (nomeados ? "$" + c : "?")).join(separador);

/**
 * Grava só a diferença entre `antes` e `depois`: insere o novo, atualiza o que mudou, apaga o que sumiu.
 * ponytail: comparação linha a linha por igualdade de JSON; o agregado tem dezenas de linhas. Se passar de
 * milhares, trocar por gravação dirigida por eventos do domínio (F2 §3.3).
 */
function gravarDiferenca(banco: DatabaseSync, antes: Agregado | undefined, depois: Agregado): void {
  const comparacoes = TABELAS.map((tabela) => ({
    ...tabela,
    velhas: porChave(tabela, antes),
    novas: porChave(tabela, depois),
  }));
  for (const { nome, chave, velhas, novas } of comparacoes.toReversed()) {
    const sql = `DELETE FROM ${nome} WHERE ${atribuicoes(chave, " AND ", false)}`;
    for (const k of velhas.keys()) {
      if (!novas.has(k)) banco.prepare(sql).run(...(JSON.parse(k) as SQLInputValue[]));
    }
  }
  for (const { nome, chave, velhas, novas } of comparacoes) {
    for (const [k, linha] of novas) {
      const velha = velhas.get(k);
      const colunas = Object.keys(linha);
      if (!velha) {
        const valores = colunas.map((c) => "$" + c).join(", ");
        banco.prepare(`INSERT INTO ${nome} (${colunas.join(", ")}) VALUES (${valores})`).run(linha);
      } else if (JSON.stringify(velha) !== JSON.stringify(linha)) {
        const sets = atribuicoes(
          colunas.filter((c) => !chave.includes(c)),
          ", ",
        );
        banco.prepare(`UPDATE ${nome} SET ${sets} WHERE ${atribuicoes(chave, " AND ")}`).run(linha);
      }
    }
  }
}

function carregar(banco: DatabaseSync, id: Id): Agregado | undefined {
  const linha = banco.prepare("SELECT * FROM issue WHERE id = ?").get(id);
  return linha && montar(banco, linha);
}

function montar(banco: DatabaseSync, linha: Linha): Agregado {
  const id = Number(linha.id);
  const deps = banco
    .prepare("SELECT dep FROM issue_dep WHERE issue = ? ORDER BY rowid")
    .all(id)
    .map((l) => Number(l.dep));
  const tickets = banco.prepare("SELECT * FROM ticket WHERE issue = ? ORDER BY id").all(id).map(deLinhaTicket);
  const execucoes = banco
    .prepare("SELECT e.* FROM execucao e JOIN ticket t ON t.id = e.ticket WHERE t.issue = ? ORDER BY e.id")
    .all(id)
    .map(deLinhaExecucao);
  const decisoes = banco.prepare("SELECT * FROM decisao WHERE issue = ? ORDER BY id").all(id).map(deLinhaDecisao);
  const arquivos = Map.groupBy(
    banco
      .prepare(
        `SELECT a.* FROM evidencia_arquivo a JOIN evidencia e ON e.id = a.evidencia JOIN ticket t ON t.id = e.ticket
         WHERE t.issue = ? ORDER BY a.rowid`,
      )
      .all(id),
    (a) => Number(a.evidencia),
  );
  const evidencias = banco
    .prepare("SELECT e.* FROM evidencia e JOIN ticket t ON t.id = e.ticket WHERE t.issue = ? ORDER BY e.id")
    .all(id)
    .map((e) =>
      deLinhaEvidencia(
        e,
        (arquivos.get(Number(e.id)) ?? []).map(({ evidencia: _, ...a }) => a as ArquivoEvidencia),
      ),
    );
  return { issue: deLinhaIssue(linha, deps), tickets, execucoes, decisoes, evidencias };
}

/** Fatos externos do F2 §3.5, consultados na transação do comando. */
const contexto = (banco: DatabaseSync): Contexto => ({
  agora: new Date().toISOString(),
  novoId: (tipo) => novoId(banco, tipo),
  projeto: (nome) => projeto(banco, nome),
  issueExiste: (id) => banco.prepare("SELECT 1 FROM issue WHERE id = ?").get(id) !== undefined,
  alcancaveis: (id) =>
    banco
      .prepare(
        `WITH RECURSIVE alcancaveis (id) AS (
           SELECT dep FROM issue_dep WHERE issue = ?
           UNION SELECT d.dep FROM issue_dep d JOIN alcancaveis a ON d.issue = a.id
         ) SELECT id FROM alcancaveis`,
      )
      .all(id)
      .map((l) => Number(l.id)),
  depsConcluidas: (id) =>
    banco
      .prepare(
        `SELECT 1 FROM issue_dep d JOIN issue x ON x.id = d.dep WHERE d.issue = ? AND x.fase <> 'concluida' LIMIT 1`,
      )
      .get(id) === undefined,
  temCommit: (ticket) => temCommit(banco, ticket),
});

/** O agregado da issue, dentro de uma transação de escrita; issue inexistente ou cancelada recusa o comando. */
function carregarAtiva(banco: DatabaseSync, issue: Id): Agregado {
  const ag = encontrado(carregar(banco, issue), `a issue I-${String(issue)} não existe`, "confira o número da issue");
  exigirNaoCancelada(ag);
  return ag;
}

/**
 * Aplica um comando do F1 ao agregado da issue numa transação só e registra o comando em `comando` com a fase de
 * antes (F6 §5.1). Ex.: `comIssue(banco, 12, "editarIssue", ator, (ag) => editarIssue(ag, entrada, ator))`.
 */
export function comIssue(
  banco: DatabaseSync,
  issue: Id,
  nome: NomeComando,
  ator: Ator,
  comando: (agregado: Agregado, ctx: Contexto) => Agregado,
): Agregado {
  return escrever(banco, () => {
    const antes = carregarAtiva(banco, issue);
    const ctx = contexto(banco);
    const depois = comando(antes, ctx);
    gravarDiferenca(banco, antes, depois);
    gravarComando(banco, antes, nome, ator, ctx);
    return depois;
  });
}

const gravarComando = (banco: DatabaseSync, antes: Agregado, nome: NomeComando, ator: Ator, ctx: Contexto): void => {
  banco
    .prepare("INSERT INTO comando (issue, nome, ator, fase, em) VALUES (?, ?, ?, ?, ?)")
    .run(antes.issue.id, nome, ator.tipo, antes.issue.fase, ctx.agora);
};

/** C1: cria a issue e o ticket de registro. */
export const registrarIssue = (banco: DatabaseSync, entrada: unknown, ator: Ator): Agregado =>
  escrever(banco, () => {
    const ag = dominio.registrarIssue(entrada, ator, contexto(banco));
    gravarDiferenca(banco, undefined, ag);
    return ag;
  });

/** A proposta `id`, ou `ErroDeInexistente`. */
export const propostaExistente = (banco: DatabaseSync, id: Id): PropostaIssue =>
  deLinhaProposta(
    encontrado(
      banco.prepare("SELECT * FROM proposta_issue WHERE id = ?").get(id),
      `a proposta P-${String(id)} não existe`,
      "confira o número da proposta",
    ),
  );

/** C23: a IA do ticket de registro ou desenho de `issue` propõe uma issue nova; a proposta fica fora do agregado. */
export const proporIssue = (banco: DatabaseSync, issue: Id, entrada: unknown, ator: Ator): PropostaIssue =>
  escrever(banco, () => {
    const antes = carregarAtiva(banco, issue);
    const ctx = contexto(banco);
    const proposta = propostas.proporIssue(antes, entrada, ator, ctx);
    const linha = linhaProposta(proposta);
    const colunas = Object.keys(linha);
    banco
      .prepare(`INSERT INTO proposta_issue (${colunas.join(", ")}) VALUES (${colunas.map((c) => "$" + c).join(", ")})`)
      .run(linha);
    gravarComando(banco, antes, "proporIssue", ator, ctx);
    return proposta;
  });

/**
 * C24: o Auditor decide a proposta numa transação só. O aceite grava a issue nova antes da atual (e do desenho
 * reprovado, se o lote fechou no desenho), atualiza a proposta e registra o comando na issue atual. Devolve o `lote`
 * quando a decisão o fecha.
 */
export const decidirProposta = (
  banco: DatabaseSync,
  id: Id,
  entrada: unknown,
  ator: Ator,
): { ag: Agregado; proposta: PropostaIssue; nova?: Agregado; lote?: PropostaIssue[] } =>
  escrever(banco, () => {
    const proposta = propostaExistente(banco, id);
    const dono = banco.prepare("SELECT issue FROM ticket WHERE id = ?").get(proposta.ticket) as { issue: Id };
    const antes = carregarAtiva(banco, dono.issue);
    const ctx = contexto(banco);
    const decidida = propostas.decidirProposta(
      antes,
      proposta,
      entrada,
      ator,
      ctx,
      propostasDaIssue(banco, dono.issue),
    );
    if (decidida.nova) gravarDiferenca(banco, undefined, decidida.nova);
    gravarDiferenca(banco, antes, decidida.ag);
    const { id: _, ...campos } = linhaProposta(decidida.proposta);
    banco
      .prepare(`UPDATE proposta_issue SET ${atribuicoes(Object.keys(campos), ", ")} WHERE id = $id`)
      .run({ ...campos, id });
    gravarComando(banco, antes, "decidirProposta", ator, ctx);
    return decidida;
  });

/** As propostas dos tickets da issue, da mais antiga para a mais nova. */
export const propostasDaIssue = (banco: DatabaseSync, issue: Id): PropostaIssue[] =>
  banco
    .prepare("SELECT p.* FROM proposta_issue p JOIN ticket t ON t.id = p.ticket WHERE t.issue = ? ORDER BY p.id")
    .all(issue)
    .map(deLinhaProposta);

/**
 * C18: arquiva numa transação só as concluídas do projeto e devolve quantas arquivou.
 * ponytail: carrega todas as issues do projeto; filtrar no SQL quando o histórico pesar.
 */
export const arquivarConcluidas = (banco: DatabaseSync, nomeProjeto: string, ator: Ator): number =>
  escrever(banco, () => {
    const ags = banco
      .prepare("SELECT * FROM issue WHERE projeto = ?")
      .all(nomeProjeto)
      .map((linha) => montar(banco, linha));
    const arquivadas = new Map(
      dominio
        .arquivarConcluidas(
          ags.map((ag) => ag.issue),
          ator,
          contexto(banco),
        )
        .map((issue) => [issue.id, issue]),
    );
    for (const ag of ags) {
      const issue = arquivadas.get(ag.issue.id);
      if (issue) gravarDiferenca(banco, ag, { ...ag, issue });
    }
    return arquivadas.size;
  });

/**
 * As issues que dependem de `id`, direta ou indiretamente e de qualquer projeto, ainda não concluídas nem canceladas
 * (as que o C22 atinge junto), da menor para a maior.
 */
export const dependentes = (banco: DatabaseSync, id: Id): { id: Id; projeto: string; fase: Fase }[] =>
  banco
    .prepare(
      `WITH RECURSIVE dependentes (id) AS (
         SELECT issue FROM issue_dep WHERE dep = ?
         UNION SELECT d.issue FROM issue_dep d JOIN dependentes x ON d.dep = x.id
       ) SELECT i.id, i.projeto, i.fase FROM issue i JOIN dependentes x ON x.id = i.id
       WHERE i.fase <> 'concluida' AND i.cancelada_em IS NULL ORDER BY i.id`,
    )
    .all(id)
    .map((l) => ({ id: Number(l.id), projeto: String(l.projeto), fase: l.fase as Fase }));

/**
 * C22: cancela a issue e as dependentes dela numa transação só, uma linha `cancelarIssue` em `comando` por issue.
 * Devolve as issues canceladas (a pedida primeiro) e as execuções que estavam em andamento e terminaram.
 */
export const cancelarIssues = (banco: DatabaseSync, issue: Id, ator: Ator): { issues: Id[]; execucoes: Execucao[] } =>
  escrever(banco, () => {
    const carregada = (id: Id) =>
      encontrado(carregar(banco, id), `a issue I-${String(id)} não existe`, "confira o número da issue");
    const ctx = contexto(banco);
    const alvos = [issue, ...dependentes(banco, issue).map((d) => d.id)].map(carregada);
    const execucoes: Execucao[] = [];
    for (const antes of alvos) {
      const depois = dominio.cancelarIssue(antes, ator, ctx);
      gravarDiferenca(banco, antes, depois);
      gravarComando(banco, antes, "cancelarIssue", ator, ctx);
      execucoes.push(
        ...depois.execucoes.filter((e) => antes.execucoes.some((a) => a.id === e.id && a.resultado === "em_andamento")),
      );
    }
    return { issues: alvos.map((a) => a.issue.id), execucoes };
  });

/** Agregado da issue, lido num snapshot só (transação de leitura). */
export function agregado(banco: DatabaseSync, issue: Id): Agregado | undefined {
  banco.exec("BEGIN");
  try {
    return carregar(banco, issue);
  } finally {
    banco.exec("COMMIT");
  }
}

/** Agregado da issue; issue inexistente dá `ErroDeInexistente`. */
export const agregadoExistente = (banco: DatabaseSync, issue: Id): Agregado =>
  encontrado(agregado(banco, issue), `a issue I-${String(issue)} não existe`, "confira o número da issue");

/** Agregado da issue do `ticket`, ou `undefined` se o ticket não existe. */
export function agregadoDoTicket(banco: DatabaseSync, ticket: Id): Agregado | undefined {
  const linha = banco.prepare("SELECT issue FROM ticket WHERE id = ?").get(ticket);
  return linha && agregado(banco, Number(linha.issue));
}

/** A issue do ticket `id`, para aplicar o comando do F1 ao agregado dela; ticket inexistente dá `ErroDeInexistente`. */
export const issueDoTicket = (banco: DatabaseSync, id: Id): Id =>
  encontrado(agregadoDoTicket(banco, id), `o ticket T-${String(id)} não existe`, "confira o número do ticket").issue.id;

/**
 * As fases em que a issue já esteve, na ordem em que entrou nelas: as da tabela `comando` (a fase de antes de cada
 * comando, F6 §7), porque toda transição passa por `comIssue`. A fase atual só aparece depois do primeiro comando nela.
 */
export const fasesPercorridas = (banco: DatabaseSync, issue: Id): Fase[] =>
  banco
    .prepare("SELECT fase FROM comando WHERE issue = ? GROUP BY fase ORDER BY MIN(id)")
    .all(issue)
    .map((l) => l.fase as Fase);

/** As issues não concluídas de todos os projetos, da mais nova para a mais antiga (o board do Início, F7 §5). */
export const issuesEmAndamento = (banco: DatabaseSync): Id[] =>
  banco
    .prepare("SELECT id FROM issue WHERE fase <> 'concluida' AND cancelada_em IS NULL ORDER BY id DESC")
    .all()
    .map((l) => Number(l.id));

/** As issues do projeto, da mais nova para a mais antiga, com o que a página do projeto filtra e conta (F7 §5). */
export const situacaoDasIssues = (
  banco: DatabaseSync,
  nomeProjeto: string,
): { id: Id; concluida: boolean; arquivada: boolean; cancelada: boolean }[] =>
  banco
    .prepare("SELECT id, fase, arquivada_em, cancelada_em FROM issue WHERE projeto = ? ORDER BY id DESC")
    .all(nomeProjeto)
    .map((l) => ({
      id: Number(l.id),
      concluida: l.fase === "concluida",
      arquivada: l.arquivada_em !== null,
      cancelada: l.cancelada_em !== null,
    }));
