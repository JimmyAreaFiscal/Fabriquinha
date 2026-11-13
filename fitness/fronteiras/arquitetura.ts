// A arquitetura de src/ que as fitness de fronteira cobram: a matriz das camadas e a do servidor, e as regras de cada
// domínio, cada uma no seu arquivo em dominios/. Este arquivo só as junta.
import { MATRIZ_DAS_CAMADAS } from "./camadas.ts";
import { REGRAS_DO_AMBIENTE } from "./dominios/ambiente.ts";
import { REGRAS_DO_CICLO_DE_VIDA } from "./dominios/ciclo_de_vida.ts";
import { REGRAS_DE_DEMANDAS } from "./dominios/demandas.ts";
import { REGRAS_DO_REPOSITORIO } from "./dominios/repositorio.ts";
import { MATRIZ_DO_SERVIDOR, moduloDoArquivoDoServidor, REGRAS_DO_SERVIDOR } from "./dominios/server.ts";
import { REGRAS_DE_SESSOES } from "./dominios/sessoes.ts";
import { moduloDoArquivoDoShared, REGRAS_DO_SHARED } from "./dominios/shared.ts";
import type { Arquitetura } from "./motor.ts";

export const ARQUITETURA_DE_SRC: Arquitetura = {
  matriz: { ...MATRIZ_DAS_CAMADAS, ...MATRIZ_DO_SERVIDOR },
  moduloDoArquivoDoServidor,
  moduloDoArquivoDoShared,
  dominios: {
    ambiente: REGRAS_DO_AMBIENTE,
    sessoes: REGRAS_DE_SESSOES,
    repositorio: REGRAS_DO_REPOSITORIO,
    ciclo_de_vida: REGRAS_DO_CICLO_DE_VIDA,
    demandas: REGRAS_DE_DEMANDAS,
    server: REGRAS_DO_SERVIDOR,
    shared: REGRAS_DO_SHARED,
  },
};
