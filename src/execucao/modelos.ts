// Conferência de modelos (F4 §9): o par provedor + modelo precisa existir no pi, para ser recusado no formulário
// e não no meio de uma execução.
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Modelo } from "../dominio/primitivos.ts";
import { executar } from "../processo.ts";

/** Recusa o par que `pi --list-models "<provedor>/<modelo>"` não lista exatamente (a busca do pi é aproximada). */
export async function conferirModelo({ provedor, modelo }: Modelo): Promise<void> {
  const pi = process.env.FABRIQUINHA_PI || "pi";
  const par = `${provedor}/${modelo}`;
  const lista = await executar(pi, ["--list-models", par]);
  if (lista.codigo !== 0) {
    throw new ErroDeRegra(
      `o pi falhou ao listar os modelos: ${lista.erro.trim()}`,
      "confira o pi rodando pi --list-models",
    );
  }
  // A saída é uma tabela com cabeçalho e colunas separadas por dois ou mais espaços: provedor, modelo, contexto…
  // ponytail: um nome de modelo com dois espaços seguidos não casaria; nenhum provedor usa isso.
  const existe = lista.saida
    .split("\n")
    .slice(1)
    .some((linha) => {
      const [p, m] = linha.trim().split(/\s{2,}/);
      return p === provedor && m === modelo;
    });
  if (!existe) {
    throw new ErroDeRegra(`o modelo ${par} não existe no pi`, "escolha um par listado por pi --list-models");
  }
}
