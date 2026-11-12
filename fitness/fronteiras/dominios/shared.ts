// Regras de fronteira do Shared, src/shared/ (MELHORIAS §7): não importa domínio nem servidor (o motor, ../motor.ts, já
// cobra), e cada arquivo dele tem a camada que diz quem pode importá-lo. O ticket 04 muda só este arquivo.
import type { RegrasDoDominio } from "../motor.ts";

const CAMADAS_DO_SHARED = new Set(["nucleo", "armazenamento", "infra"]);

// A camada é a primeira pasta (`shared/nucleo/erros.ts` → `nucleo`), como em `modulos/compartilhado/`. Arquivo fora delas
// não tem módulo, e a matriz o acusa: quem o criar declara aqui a camada dele.
export function moduloDoArquivoDoShared(caminhoEmShared: string): string {
  const [primeiro, ...resto] = caminhoEmShared.split("/");
  return primeiro !== undefined && CAMADAS_DO_SHARED.has(primeiro) && resto.length > 0 ? primeiro : "";
}

/** O relógio: `new Date(` só nele (e na composição). */
export const ARQUIVO_DO_RELOGIO = "modulos/compartilhado/nucleo/relogio.ts";
/** O executor de comandos no host. */
export const ARQUIVO_DO_PROCESSO = "modulos/compartilhado/infra/processo.ts";
/** As migrações congeladas: guardam o esquema do passado de todas as tabelas, fora da posse e da catraca de nomes de Etapa. */
export const PASTA_DO_HISTORICO_DO_ESQUEMA = "modulos/compartilhado/armazenamento/migracoes/";

// O shared já está no destino (a pasta nasce no ticket 04); não tem subdomínios.
export const REGRAS_DO_SHARED: RegrasDoDominio = {
  migrado: true,
  dependeDe: [],
  subdominios: {},
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [ARQUIVO_DO_PROCESSO], chamadoresDiretos: [] },
};
