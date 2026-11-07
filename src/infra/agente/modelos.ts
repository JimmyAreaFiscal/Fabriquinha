// Conferência de modelos (F4 §9): o par provedor + nome precisa existir no pi, para ser recusado no formulário
// e não no meio de uma execução. A mesma tabela alimenta os seletores do web (F7 §4.2, `GET /api/modelos`).
import { ErroDeRegra } from "../../nucleo/erros.ts";
import type { Modelo } from "../../nucleo/configuracao_agente.ts";
import { executar } from "../processo.ts";

/** Os pares da tabela de `pi --list-models [busca]`; a busca do pi é aproximada. */
async function modelosDoPi(...busca: string[]): Promise<Modelo[]> {
  const pi = process.env.FABRIQUINHA_PI || "pi";
  const lista = await executar(pi, ["--list-models", ...busca]);
  if (lista.codigo !== 0) {
    throw new ErroDeRegra(
      `o pi falhou ao listar os modelos: ${lista.erro.trim()}`,
      "confira o pi rodando pi --list-models",
    );
  }
  // A saída é uma tabela com cabeçalho e colunas separadas por dois ou mais espaços: provedor, modelo, contexto…
  // ponytail: um nome de modelo com dois espaços seguidos não casaria; nenhum provedor usa isso.
  return lista.saida
    .split("\n")
    .slice(1)
    .flatMap((linha) => {
      const [provedor, nome] = linha.trim().split(/\s{2,}/);
      return provedor && nome ? [{ provedor, nome }] : [];
    });
}

/** Todos os pares que o pi conhece. */
export const listarModelos = (): Promise<Modelo[]> => modelosDoPi();

/** Recusa o par que `pi --list-models "<provedor>/<nome>"` não lista exatamente. */
export async function conferirModelo({ provedor, nome }: Modelo): Promise<void> {
  const par = `${provedor}/${nome}`;
  if (!(await modelosDoPi(par)).some((m) => m.provedor === provedor && m.nome === nome)) {
    throw new ErroDeRegra(`o modelo ${par} não existe no pi`, "escolha um par listado por pi --list-models");
  }
}
