// O catálogo de preços dos modelos (tabela `preco_do_modelo`): cada preço com a origem e a vigência. A fonte entrega a
// lista inteira; o preço que mudou fecha a vigência do anterior, e o modelo que saiu da fonte fecha a dele.
import type { DatabaseSync } from "node:sqlite";
import { escrever, instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import type { Modelo } from "../nucleo/modelo.ts";
import type { PrecoDoCatalogo, PrecoDoModelo } from "../nucleo/preco_do_modelo.ts";

interface LinhaDoPreco {
  id: number;
  modelo_provedor: string;
  modelo_nome: string;
  usd_por_milhao_entrada: number;
  usd_por_milhao_saida: number;
  usd_por_milhao_cache_leitura: number;
  usd_por_milhao_cache_escrita: number;
  origem: string;
  vigente_de: string;
  vigente_ate: string | null;
}

const precoDaLinha = (linha: LinhaDoPreco): PrecoDoCatalogo => ({
  id: linha.id,
  modelo: { provedor: linha.modelo_provedor, nome: linha.modelo_nome },
  usd_por_milhao: {
    entrada: linha.usd_por_milhao_entrada,
    saida: linha.usd_por_milhao_saida,
    cache_leitura: linha.usd_por_milhao_cache_leitura,
    cache_escrita: linha.usd_por_milhao_cache_escrita,
  },
  origem: linha.origem,
  vigente_de: linha.vigente_de,
  ...(linha.vigente_ate !== null && { vigente_ate: linha.vigente_ate }),
});

const chaveDoModelo = ({ provedor, nome }: Modelo): string => `${provedor}/${nome}`;

const mesmoPreco = (a: PrecoDoModelo, b: PrecoDoModelo): boolean =>
  a.origem === b.origem &&
  a.usd_por_milhao.entrada === b.usd_por_milhao.entrada &&
  a.usd_por_milhao.saida === b.usd_por_milhao.saida &&
  a.usd_por_milhao.cache_leitura === b.usd_por_milhao.cache_leitura &&
  a.usd_por_milhao.cache_escrita === b.usd_por_milhao.cache_escrita;

/**
 * Leva o catálogo aos `precos` que a fonte declara em `instante`: o preço novo ou mudado abre vigência em `instante`,
 * fechando a do anterior; o igual fica; o modelo vigente que a fonte não declara mais tem a vigência fechada.
 */
export function gravarCatalogoDePrecos(banco: DatabaseSync, precos: readonly PrecoDoModelo[], instante: string): void {
  escrever(banco, () => {
    const vigentes = new Map(
      (banco.prepare("SELECT * FROM preco_do_modelo WHERE vigente_ate IS NULL").all() as unknown as LinhaDoPreco[])
        .map(precoDaLinha)
        .map((preco) => [chaveDoModelo(preco.modelo), preco]),
    );
    const fecharVigencia = banco.prepare("UPDATE preco_do_modelo SET vigente_ate = ? WHERE id = ?");
    const abrirVigencia = banco.prepare(
      `INSERT INTO preco_do_modelo (modelo_provedor, modelo_nome, usd_por_milhao_entrada, usd_por_milhao_saida,
         usd_por_milhao_cache_leitura, usd_por_milhao_cache_escrita, origem, vigente_de)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const preco of precos) {
      const chave = chaveDoModelo(preco.modelo);
      const vigente = vigentes.get(chave);
      vigentes.delete(chave);
      if (vigente && mesmoPreco(vigente, preco)) continue;
      if (vigente) fecharVigencia.run(instante, vigente.id);
      const { entrada, saida, cache_leitura, cache_escrita } = preco.usd_por_milhao;
      abrirVigencia.run(
        preco.modelo.provedor,
        preco.modelo.nome,
        entrada,
        saida,
        cache_leitura,
        cache_escrita,
        preco.origem,
        instante,
      );
    }
    for (const semFonte of vigentes.values()) fecharVigencia.run(instante, semFonte.id);
  });
}

/** O preço do `modelo` vigente em `instante`, ou `undefined` se o catálogo não tem preço dele nesse instante. */
export function lerPrecoVigente(banco: DatabaseSync, modelo: Modelo, instante: string): PrecoDoCatalogo | undefined {
  const linha = instrucaoPreparada(
    banco,
    `SELECT * FROM preco_do_modelo WHERE modelo_provedor = ? AND modelo_nome = ? AND vigente_de <= ?
       AND (vigente_ate IS NULL OR vigente_ate > ?)`,
  ).get(modelo.provedor, modelo.nome, instante, instante) as LinhaDoPreco | undefined;
  return linha && precoDaLinha(linha);
}
