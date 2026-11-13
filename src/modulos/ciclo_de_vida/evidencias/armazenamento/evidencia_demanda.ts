// O armazenamento das Evidências (D10), o único que fala SQL com `evidencia_demanda` e `arquivo_evidencia`: as linhas
// das evidências, que o repositório do agregado lê e grava pela diferença na transação dele, e os anexos, gravados na
// transação da evidência (`comDemanda`, via `aposGravar`) por cima do armazenamento por SHA-256 de `arquivos.ts`.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { caminhoArquivo } from "../../../../shared/armazenamento/arquivos.ts";
import type { EvidenciaDemanda } from "../nucleo/evidencia_demanda.ts";

type LinhaDaEvidencia = Record<string, SQLInputValue>;

/** As colunas que identificam a linha na diferença: o `id` nasce no INSERT, então a chave inclui o `em`. */
const CHAVE_DA_EVIDENCIA: readonly string[] = ["demanda_id", "rodada_id", "ticket_id", "tipo", "em"];

/** `a IS $a AND b IS $b` (nomeados) ou `a IS ? AND b IS ?` (posicionais); `IS` casa também o dono nulo. */
const filtroDaChave = (nomeados: boolean): string =>
  CHAVE_DA_EVIDENCIA.map((coluna) => `${coluna} IS ${nomeados ? "$" + coluna : "?"}`).join(" AND ");

/** A evidência nas colunas da tabela: o Ator em `autor_*` e o dono ausente como NULL. */
const linhaDaEvidencia = ({ autor, ...evidencia }: EvidenciaDemanda): LinhaDaEvidencia => ({
  ...evidencia,
  autor_tipo: autor.tipo,
  autor_trabalho_id: autor.tipo === "agente" ? autor.trabalho_id : null,
  autor_ferramenta: autor.tipo === "externo" ? autor.ferramenta : null,
  autor_sessao: autor.tipo === "externo" ? autor.sessao : null,
  rodada_id: evidencia.rodada_id ?? null,
  ticket_id: evidencia.ticket_id ?? null,
  dados: JSON.stringify(evidencia.dados),
});

/** As linhas de `evidencias`, indexadas pelo JSON dos valores da chave, na ordem dela. */
const porChave = (evidencias: readonly EvidenciaDemanda[]): Map<string, LinhaDaEvidencia> =>
  new Map(
    evidencias
      .map(linhaDaEvidencia)
      .map((linha) => [JSON.stringify(CHAVE_DA_EVIDENCIA.map((coluna) => linha[coluna])), linha]),
  );

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (campos: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(campos).filter(([, valor]) => valor !== null));

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
    .map(({ id: _, autor_tipo, autor_trabalho_id, autor_ferramenta, autor_sessao, dados, ...evidencia }) => ({
      ...semNulos(evidencia),
      autor: semNulos({
        tipo: autor_tipo,
        trabalho_id: autor_trabalho_id,
        ferramenta: autor_ferramenta,
        sessao: autor_sessao,
      }),
      dados: JSON.parse(dados as string) as unknown,
    }));
}

/**
 * Apaga as evidências que estavam em `antes` e não estão em `depois`. A evidência é filha do ticket e da rodada (FKs
 * RESTRICT): o repositório do agregado chama isto antes de apagar as linhas dele.
 */
export function gravarRetiradaDasEvidencias(
  banco: DatabaseSync,
  antes: readonly EvidenciaDemanda[],
  depois: readonly EvidenciaDemanda[],
): void {
  const novas = porChave(depois);
  for (const chave of porChave(antes).keys()) {
    if (!novas.has(chave)) {
      banco
        .prepare(`DELETE FROM evidencia_demanda WHERE ${filtroDaChave(false)}`)
        .run(...(JSON.parse(chave) as SQLInputValue[]));
    }
  }
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
  const velhas = porChave(antes);
  for (const [chave, linha] of porChave(depois)) {
    const velha = velhas.get(chave);
    if (!velha) {
      const nova = { id: randomUUID(), ...linha };
      const colunas = Object.keys(nova);
      const valores = colunas.map((coluna) => "$" + coluna).join(", ");
      banco.prepare(`INSERT INTO evidencia_demanda (${colunas.join(", ")}) VALUES (${valores})`).run(nova);
    } else if (JSON.stringify(velha) !== JSON.stringify(linha)) {
      const alteradas = Object.keys(linha)
        .filter((coluna) => !CHAVE_DA_EVIDENCIA.includes(coluna))
        .map((coluna) => `${coluna} = $${coluna}`)
        .join(", ");
      banco.prepare(`UPDATE evidencia_demanda SET ${alteradas} WHERE ${filtroDaChave(true)}`).run(linha);
    }
  }
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
