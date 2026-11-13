// A matriz das camadas de cada subdomínio e do shared (MELHORIAS §3 e §4, regra 4): o núcleo segue puro, só o
// armazenamento fala SQL e a aplicação coordena as três. Qualquer camada importa a fachada de outro domínio; as regras
// dos domínios (dominios/<domínio>.ts) dizem de quais. Lista de permitidos em vez de proibidos: uma dependência nova
// precisa ser liberada aqui de propósito.
import { MODULO_DAS_FACHADAS, QUALQUER_EXTERNO, type RegraDoModulo, SO_ZOD_E_PATH } from "./motor.ts";

export const MATRIZ_DAS_CAMADAS: Record<string, RegraDoModulo> = {
  nucleo: { modulosPermitidos: [MODULO_DAS_FACHADAS], externoPermitido: SO_ZOD_E_PATH },
  armazenamento: { modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS], externoPermitido: QUALQUER_EXTERNO },
  infra: { modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS], externoPermitido: QUALQUER_EXTERNO },
  aplicacao: {
    modulosPermitidos: ["nucleo", "armazenamento", "infra", MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
};
