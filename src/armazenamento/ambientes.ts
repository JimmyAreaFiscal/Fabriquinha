// O conjunto de Ambientes em container no banco (tabela `ambiente`): um container por linha, com o estado dele.
// Só SQL; quem cria e elimina o container de verdade é o `GeradorDeAmbientes`.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../nucleo/erros.ts";

type EstadoDoAmbiente = "livre" | "alocado" | "sujo" | "eliminado";

interface AmbienteGravado {
  id: string;
  container_id: string;
  imagem: string;
  estado: EstadoDoAmbiente;
  alocado_para: string | null;
  criado_em: string;
  liberado_em: string | null;
}

const COLUNAS_DO_AMBIENTE = "id, container_id, imagem, estado, alocado_para, criado_em, liberado_em";

// O node:sqlite devolve objetos sem protótipo; a cópia dá um objeto comum.
const comoAmbiente = (linha: Record<string, unknown> | undefined): AmbienteGravado | undefined =>
  linha && ({ ...linha } as unknown as AmbienteGravado);

/** @testes o conjunto de Ambientes a usa na demanda I-286; hoje só o teste */
export function inserirAmbienteAlocado(
  banco: DatabaseSync,
  novo: Pick<AmbienteGravado, "id" | "container_id" | "imagem" | "criado_em"> & { alocado_para: string },
): void {
  banco
    .prepare(
      "INSERT INTO ambiente (id, container_id, imagem, estado, alocado_para, criado_em) VALUES (?, ?, ?, 'alocado', ?, ?)",
    )
    .run(novo.id, novo.container_id, novo.imagem, novo.alocado_para, novo.criado_em);
}

/**
 * Aloca ao Espaço o livre mais antigo da imagem, num único UPDATE (o SQLite serializa a escrita), então dois Espaços
 * nunca recebem o mesmo container. Sem livre da imagem, devolve `undefined`.
 * @testes o conjunto de Ambientes a usa na demanda I-286; hoje só o teste
 */
export function alocarAmbienteLivreDaImagem(
  banco: DatabaseSync,
  imagem: string,
  alocadoPara: string,
): AmbienteGravado | undefined {
  return comoAmbiente(
    banco
      .prepare(
        `UPDATE ambiente SET estado = 'alocado', alocado_para = ?
         WHERE id = (SELECT id FROM ambiente WHERE estado = 'livre' AND imagem = ? ORDER BY liberado_em, rowid LIMIT 1)
         RETURNING ${COLUNAS_DO_AMBIENTE}`,
      )
      .get(alocadoPara, imagem),
  );
}

/** @testes o conjunto de Ambientes a usa na demanda I-286; hoje só o teste */
export function buscarAmbienteAlocadoPara(banco: DatabaseSync, alocadoPara: string): AmbienteGravado | undefined {
  return comoAmbiente(
    banco
      .prepare(`SELECT ${COLUNAS_DO_AMBIENTE} FROM ambiente WHERE estado = 'alocado' AND alocado_para = ?`)
      .get(alocadoPara),
  );
}

/**
 * Devolve o Ambiente ao conjunto: `livre` quando a limpeza deu certo, `sujo` quando não. Tira o Espaço dele e grava
 * quando foi liberado, que é de onde se conta a ociosidade.
 * @testes o conjunto de Ambientes a usa na demanda I-286; hoje só o teste
 */
export function liberarAmbiente(
  banco: DatabaseSync,
  id: string,
  estadoDepoisDaLiberacao: "livre" | "sujo",
  liberadoEm: string,
): void {
  const { changes } = banco
    .prepare(
      "UPDATE ambiente SET estado = ?, alocado_para = NULL, liberado_em = ? WHERE id = ? AND estado <> 'eliminado'",
    )
    .run(estadoDepoisDaLiberacao, liberadoEm, id);
  if (changes === 0) throw new ErroDeInexistente(`o ambiente ${id} não existe`, "confira o id do ambiente");
}

/** @testes o conjunto de Ambientes a usa na demanda I-286; hoje só o teste */
export function eliminarAmbiente(banco: DatabaseSync, id: string): void {
  const { changes } = banco
    .prepare("UPDATE ambiente SET estado = 'eliminado', alocado_para = NULL WHERE id = ? AND estado <> 'eliminado'")
    .run(id);
  if (changes === 0) throw new ErroDeInexistente(`o ambiente ${id} não existe`, "confira o id do ambiente");
}

/**
 * O conjunto vivo, do mais antigo ao mais novo: os eliminados ficam gravados mas não entram.
 * @testes o conjunto de Ambientes a usa na demanda I-286; hoje só o teste
 */
export function listarAmbientes(banco: DatabaseSync): AmbienteGravado[] {
  return banco
    .prepare(`SELECT ${COLUNAS_DO_AMBIENTE} FROM ambiente WHERE estado <> 'eliminado' ORDER BY criado_em, rowid`)
    .all()
    .map((linha) => ({ ...linha }) as unknown as AmbienteGravado);
}
