// Anexos e sessões externas da evidência da demanda (D10): gravados na transação da evidência (`comDemanda`, via
// `aposGravar`), por cima do armazenamento por SHA-256 de `arquivos.ts`. Nada aqui toca o agregado.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import { caminhoArquivo } from "./arquivos.ts";

/** Quem é dono da evidência da demanda: rodada e ticket ausentes valem para a própria demanda. */
export interface ChaveEvidencia {
  demanda_id: string;
  rodada_id?: number;
  ticket_id?: number;
  tipo: string;
}

/** Um anexo já guardado por `arquivos.ts`: `caminho` é o nome dele. */
export interface Anexo {
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

/**
 * Regrava as sessões externas da demanda. A sessão que outra demanda já informou não muda de dona e vira aviso: não é
 * contada de novo. Não escreve em `execucao_sessao` nem em `uso_modelo_execucao`: custo externo não é execução interna.
 */
export function registrarSessoesExternas(
  banco: DatabaseSync,
  demanda_id: string,
  sessoes: readonly { ferramenta: string; sessao: string }[],
): { avisos: string[] } {
  banco.prepare("DELETE FROM sessao_externa_demanda WHERE demanda_id = ?").run(demanda_id);
  const inserir = banco.prepare(
    "INSERT INTO sessao_externa_demanda (ferramenta, sessao, demanda_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
  );
  const dona = banco.prepare("SELECT demanda_id FROM sessao_externa_demanda WHERE ferramenta = ? AND sessao = ?");
  const avisos: string[] = [];
  for (const { ferramenta, sessao } of sessoes) {
    if (inserir.run(ferramenta, sessao, demanda_id).changes === 0) {
      avisos.push(
        `a sessão ${sessao} de ${ferramenta} já consta na demanda ${String(dona.get(ferramenta, sessao)?.demanda_id)} e não é contada de novo para ${demanda_id}`,
      );
    }
  }
  return { avisos };
}
