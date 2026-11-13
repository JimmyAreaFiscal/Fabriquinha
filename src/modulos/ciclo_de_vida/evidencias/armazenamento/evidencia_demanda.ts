// O armazenamento das Evidências (D10), o único que fala SQL com `evidencia_demanda` e `arquivo_evidencia`: as linhas
// das evidências, que o repositório do agregado lê e grava pela diferença na transação dele, e os anexos, gravados na
// transação da evidência (`comDemanda`, via `aposGravar`) por cima do armazenamento por SHA-256 de `arquivos.ts`.
import { readFileSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { caminhoArquivo } from "../../../../shared/armazenamento/arquivos.ts";
import {
  agruparColunasDoCampo,
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  semNulos,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/diferenca_do_agregado.ts";
import type { EvidenciaDemanda } from "../nucleo/evidencia_demanda.ts";
import { instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";

/** As evidências registradas de uma demanda, como a diferença do agregado as compara. */
interface EvidenciasRegistradas {
  readonly evidencias: readonly EvidenciaDemanda[];
}

/** A tabela das evidências: o `id` nasce no INSERT, então a chave da diferença inclui o `em`. */
const TABELA_DAS_EVIDENCIAS: TabelaDoAgregado<EvidenciasRegistradas> = {
  nome: "evidencia_demanda",
  idNasceNoInsert: true,
  chave: ["demanda_id", "rodada_id", "ticket_id", "tipo", "em"],
  linhas: ({ evidencias }) =>
    evidencias.map(({ autor, ...evidencia }) => ({
      ...evidencia,
      autor_tipo: autor.tipo,
      autor_trabalho_id: autor.tipo === "agente" ? autor.trabalho_id : null,
      autor_ferramenta: autor.tipo === "externo" ? autor.ferramenta : null,
      autor_sessao: autor.tipo === "externo" ? autor.sessao : null,
      rodada_id: evidencia.rodada_id ?? null,
      ticket_id: evidencia.ticket_id ?? null,
      dados: JSON.stringify(evidencia.dados),
    })),
};

/**
 * As evidências da demanda como o banco as guarda, para o agregado validar: o Ator em `autor`, sem o `id` e sem as
 * colunas nulas. `preparar` é o de quem carrega, que prepara cada SQL uma vez só ao carregar várias demandas.
 */
export function lerEvidenciasDaDemanda(
  demandaId: string,
  preparar: (sql: string) => StatementSync,
): Record<string, unknown>[] {
  return preparar("SELECT * FROM evidencia_demanda WHERE demanda_id = ? ORDER BY rowid")
    .all(demandaId)
    .map(({ id: _, dados, ...evidencia }) => ({
      ...semNulos(agruparColunasDoCampo(evidencia, "autor")),
      dados: JSON.parse(dados as string) as unknown,
    }));
}

/** O instante da primeira evidência de cada demanda que tem alguma, em lote. */
export const primeiraEvidenciaDasDemandas = (banco: DatabaseSync, demandaIds: readonly string[]): Map<string, string> =>
  new Map(
    instrucaoPreparada(
      banco,
      `SELECT demanda_id, MIN(em) AS em FROM evidencia_demanda
         WHERE demanda_id IN (SELECT value FROM json_each(?)) GROUP BY demanda_id`,
    )
      .all(JSON.stringify(demandaIds))
      .map((linha) => [String(linha.demanda_id), String(linha.em)]),
  );

/** Onde e quando cada evidência do `tipo` das demandas foi registrada, em lote e sem os dados dela. */
export const evidenciasDoTipoDasDemandas = (
  banco: DatabaseSync,
  filtro: { demandas: readonly string[]; tipo: string },
): { demanda_id: string; rodada_id: number | null; ticket_id: number | null; em: string }[] =>
  instrucaoPreparada(
    banco,
    `SELECT demanda_id, rodada_id, ticket_id, em FROM evidencia_demanda
       WHERE tipo = $tipo AND demanda_id IN (SELECT value FROM json_each($demandas)) ORDER BY rowid`,
  )
    .all({ tipo: filtro.tipo, demandas: JSON.stringify(filtro.demandas) })
    .map((linha) => ({
      demanda_id: String(linha.demanda_id),
      rodada_id: linha.rodada_id === null ? null : Number(linha.rodada_id),
      ticket_id: linha.ticket_id === null ? null : Number(linha.ticket_id),
      em: String(linha.em),
    }));

/**
 * Apaga as evidências que estavam em `antes` e não estão em `depois`. A evidência é filha do ticket e da rodada (FKs
 * RESTRICT): o repositório do agregado chama isto antes de apagar as linhas dele.
 */
export function gravarRetiradaDasEvidencias(
  banco: DatabaseSync,
  antes: readonly EvidenciaDemanda[],
  depois: readonly EvidenciaDemanda[],
): void {
  apagarLinhasQueSumiram(banco, [TABELA_DAS_EVIDENCIAS], { evidencias: antes }, { evidencias: depois });
}

/**
 * Insere as evidências novas de `depois` e atualiza as que mudaram; o repositório do agregado chama isto depois de
 * inserir as linhas dele, de que a evidência é filha.
 */
export function gravarEvidenciasNovasEAlteradas(
  banco: DatabaseSync,
  antes: readonly EvidenciaDemanda[],
  depois: readonly EvidenciaDemanda[],
): void {
  gravarLinhasNovasEMudadas(banco, [TABELA_DAS_EVIDENCIAS], { evidencias: antes }, { evidencias: depois });
}

/** Quem é dono da evidência da demanda: rodada e ticket ausentes valem para a própria demanda. */
interface ChaveEvidencia {
  demanda_id: string;
  rodada_id?: number;
  ticket_id?: number;
  tipo: string;
}

/** Um anexo já guardado por `arquivos.ts`: `caminho` é o nome dele. */
interface Anexo {
  caminho: string;
  sha256: string;
  mime: string;
  bytes: number;
}

const idDaEvidencia = (banco: DatabaseSync, chave: ChaveEvidencia): string => {
  const linha = banco
    .prepare("SELECT id FROM evidencia_demanda WHERE demanda_id = ? AND rodada_id IS ? AND ticket_id IS ? AND tipo = ?")
    .get(chave.demanda_id, chave.rodada_id ?? null, chave.ticket_id ?? null, chave.tipo);
  if (!linha) {
    throw new ErroDeRegra(
      `a evidência ${chave.tipo} da demanda ${chave.demanda_id} não está gravada`,
      "grave a evidência antes dos anexos, na mesma transação",
    );
  }
  return String(linha.id);
};

/** Registra os anexos da evidência, ordem 1..n, no lugar dos que ela já tinha. Chamar dentro da transação que grava a evidência. */
export function gravarAnexos(banco: DatabaseSync, chave: ChaveEvidencia, anexos: readonly Anexo[]): void {
  const id = idDaEvidencia(banco, chave);
  // Resubmissão com o mesmo `em` atualiza a linha em vez de trocá-la (o CASCADE não age): os anexos antigos saem aqui.
  banco.prepare("DELETE FROM arquivo_evidencia WHERE evidencia_id = ?").run(id);
  const inserir = banco.prepare(
    "INSERT INTO arquivo_evidencia (evidencia_id, ordem, caminho, sha256, mime, bytes) VALUES (?, ?, ?, ?, ?, ?)",
  );
  anexos.forEach((a, i) => inserir.run(id, i + 1, a.caminho, a.sha256, a.mime, a.bytes));
}

/** Um anexo com o dono (demanda, rodada ou ticket) e o tipo da evidência que o registra. */
export interface AnexoDaDemanda extends Omit<Anexo, "caminho"> {
  nome: string;
  rodada_id?: number;
  ticket_id?: number;
  tipo: string;
}

/** Todos os anexos das evidências da demanda, na ordem de gravação da evidência e do anexo. */
export function anexosDaDemanda(banco: DatabaseSync, id: string): AnexoDaDemanda[] {
  const linhas = banco
    .prepare(
      `SELECT a.caminho, a.mime, a.bytes, a.sha256, e.rodada_id, e.ticket_id, e.tipo
       FROM arquivo_evidencia a JOIN evidencia_demanda e ON e.id = a.evidencia_id
       WHERE e.demanda_id = ? ORDER BY e.rowid, a.ordem`,
    )
    .all(id);
  return linhas.map((l) => ({
    nome: String(l.caminho),
    mime: String(l.mime),
    bytes: Number(l.bytes),
    sha256: String(l.sha256),
    ...(l.rodada_id !== null && { rodada_id: Number(l.rodada_id) }),
    ...(l.ticket_id !== null && { ticket_id: Number(l.ticket_id) }),
    tipo: String(l.tipo),
  }));
}

/** O conteúdo do anexo com esse hash, se a evidência o registra; nunca lê um caminho que não seja do armazenamento. */
export function lerAnexo(banco: DatabaseSync, chave: ChaveEvidencia, sha256: string): Anexo & { conteudo: Buffer } {
  const arquivo = caminhoArquivo(banco, sha256);
  const linha = banco
    .prepare("SELECT caminho, mime, bytes FROM arquivo_evidencia WHERE evidencia_id = ? AND sha256 = ? ORDER BY ordem")
    .get(idDaEvidencia(banco, chave), sha256);
  if (!linha) {
    throw new ErroDeRegra(`a evidência não registra o anexo ${sha256}`, "use um anexo registrado na evidência");
  }
  return {
    caminho: String(linha.caminho),
    sha256,
    mime: String(linha.mime),
    bytes: Number(linha.bytes),
    conteudo: readFileSync(arquivo),
  };
}

/** O SHA-256 de cada anexo das evidências das `demandas`, sem repetir. */
export const anexosDasDemandasEmLote = (banco: DatabaseSync, demandaIds: readonly string[]): string[] =>
  banco
    .prepare(
      `SELECT DISTINCT sha256 FROM arquivo_evidencia WHERE evidencia_id IN
         (SELECT id FROM evidencia_demanda WHERE demanda_id IN (SELECT value FROM json_each(?)))`,
    )
    .all(JSON.stringify(demandaIds))
    .map((linha) => String(linha.sha256));

/** Dos anexos `sha256s`, os que alguma evidência ainda cita. */
export const anexosCitadosPorEvidencia = (banco: DatabaseSync, sha256s: readonly string[]): Set<string> =>
  new Set(
    banco
      .prepare("SELECT sha256 FROM arquivo_evidencia WHERE sha256 IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(sha256s))
      .map((linha) => String(linha.sha256)),
  );

/** Na remoção do projeto: as evidências das `demandas`; os anexos e o histórico delas saem em cascata. */
export function apagarEvidenciasDasDemandas(banco: DatabaseSync, demandaIds: readonly string[]): void {
  banco
    .prepare("DELETE FROM evidencia_demanda WHERE demanda_id IN (SELECT value FROM json_each(?))")
    .run(JSON.stringify(demandaIds));
}
