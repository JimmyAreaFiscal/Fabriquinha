// O apoio de teste do Ciclo de Vida: a liberação dos pedidos por Demandas, na forma que o Despacho pede, e a recuperação da
// subida do serviço, com que os testes chamam o Despacho e a condução direto, sem o agendador da montagem.
import type { DatabaseSync } from "node:sqlite";
import { type CicloDeVida, montarCicloDeVida } from "../../src/modulos/ciclo_de_vida/publico.ts";
import {
  type MontagemDasSessoesDeAgente,
  montarSessoesDeAgente,
  type SessoesDeAgente,
} from "../../src/modulos/sessoes/publico.ts";
import { existe } from "../../src/shared/nucleo/erros.ts";
import { montarRepositorio } from "../../src/modulos/repositorio/publico.ts";
import { noLog } from "../../src/shared/infra/registro.ts";
import { relogioFixo } from "../../src/shared/nucleo/relogio.ts";
import { cicloDeVidaDeTeste } from "../falsos/ambiente_falso.ts";
export { CATALOGO as CATALOGO_DO_CICLO_DE_VIDA } from "../../src/modulos/ciclo_de_vida/coordenacao/aplicacao/leituras_do_ciclo_de_vida.ts";
import { demandasDoCicloDeVida } from "../../src/server/system/banco_da_fabriquinha.ts";

/** As predecessoras pendentes de cada pedido, pelas Dependências de Demandas: a mesma liberação do serviço. */
export const liberacaoDasDemandas =
  (banco: DatabaseSync) =>
  (ids: readonly string[]): ReadonlyMap<string, readonly string[]> =>
    demandasDoCicloDeVida(banco).predecessorasPendentes(ids);

/**
 * A subida do serviço sem o agendador: as Sessões montadas por `montagem` matam os processos da instância anterior, e o
 * Ciclo de Vida falha os tickets que ficaram sem processo. Devolve as Sessões da subida.
 */
export async function recuperarAposReinicio(
  banco: DatabaseSync,
  montagem: Omit<MontagemDasSessoesDeAgente, "banco"> = {},
): Promise<SessoesDeAgente> {
  let sessoesDaSubida: SessoesDeAgente | undefined;
  const cicloDeVida = await montarCicloDeVida({
    banco,
    demandas: demandasDoCicloDeVida,
    repositorio: montarRepositorio({ banco }),
    ...(montagem.ambientes && { ambientes: montagem.ambientes }),
    registrarErro: noLog,
    subirSessoes: async (subida) => {
      const sessoes = await montarSessoesDeAgente({ ...montagem, banco, subida });
      sessoesDaSubida = sessoes;
      return sessoes;
    },
  });
  await cicloDeVida.parar();
  return existe(sessoesDaSubida, "a subida não montou as Sessões", "confira a montagem");
}

/** O Ciclo de Vida do teste (o de {@link cicloDeVidaDeTeste}) parado no instante de `contexto`. */
export const cicloDeVidaNoContexto = (banco: DatabaseSync, contexto: { agora: string }): CicloDeVida =>
  cicloDeVidaDeTeste(banco, relogioFixo(contexto.agora));
