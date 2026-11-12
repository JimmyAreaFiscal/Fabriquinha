// A matriz das camadas dos módulos antigos de src/modulos/ (os que ainda não migraram para um domínio de destino) e a
// classificação dos arquivos deles. As camadas valem também dentro dos subdomínios migrados e do shared: o núcleo segue
// puro, só o armazenamento fala SQL. Sai no ticket 22, com os módulos antigos; os tickets 04 a 21 não editam este arquivo.
// Lista de permitidos em vez de proibidos: uma dependência nova precisa ser liberada aqui de propósito.
import { MODULO_DAS_FACHADAS, QUALQUER_EXTERNO, type RegraDoModulo, SO_ZOD_E_PATH } from "./motor.ts";

export const MODULO_DO_HARNESS = "harness";
const MODULO_DO_ADAPTER_PI = "harness/pi";

export const MATRIZ_DO_LEGADO: Record<string, RegraDoModulo> = {
  // A fachada de um domínio migrado, em todas as camadas: os caminhos antigos reexportam dela (provisório: remover no
  // ticket 22, com os caminhos antigos).
  nucleo: { modulosPermitidos: [MODULO_DAS_FACHADAS], externoPermitido: SO_ZOD_E_PATH },
  armazenamento: { modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS], externoPermitido: QUALQUER_EXTERNO },
  infra: { modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS], externoPermitido: QUALQUER_EXTERNO },
  aplicacao: {
    modulosPermitidos: ["nucleo", "armazenamento", "infra", MODULO_DO_HARNESS, MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // A interface do Harness: só tipos, que o adapter implementa e o condutor usa.
  [MODULO_DO_HARNESS]: {
    modulosPermitidos: [],
    modulosSoComoTipo: ["nucleo", "infra", MODULO_DAS_FACHADAS],
    externoPermitido: () => false,
  },
  // O adapter pi é infra do harness; só a composição o importa (o resto do serviço pede o harness ao condutor).
  [MODULO_DO_ADAPTER_PI]: {
    modulosPermitidos: ["nucleo", "infra", MODULO_DO_HARNESS, MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
};

// `<domínio>/<camada>/…`: o domínio agrupa por conceito, e a regra de dependência é a da camada.
const DOMINIOS_DO_LEGADO = new Set([
  "sdlc",
  "trabalho_agentico",
  "sandbox",
  "repositorio",
  "projeto",
  "verificacao",
  "metricas",
  "compartilhado",
]);

// `src/modulos/etapas/` não tem pasta por camada: a pasta é a Etapa, ou o que é comum a elas. O que a Etapa declara é valor puro,
// com a regra do núcleo, para o motor ler o catálogo sem trazer condução nem banco: o catálogo, `definicao/` e, em cada
// Etapa, `definicao.ts` e a regra do Gate dela (`gate.ts`, agregado → agregado). O resto (a condução e os registros das
// conduções e dos Gates, a montagem do prompt, a decisão dos Gates e os casos de uso), a da aplicação.
const DOMINIO_DAS_ETAPAS = "etapas";
const VALOR_PURO_DAS_ETAPAS = /^etapas\/(catalogo\.ts|definicao\/.+|[^/]+\/(definicao|gate)\.ts)$/;

// `src/modulos/harness/<arquivo>` é a interface; `src/modulos/harness/<adapter>/…`, um módulo por adapter.
// Fora de um domínio antigo, a primeira pasta é o módulo (a matriz acusa a que não conhece).
export function moduloDoArquivoDoLegado(caminhoEmModulos: string): string {
  const [primeiro, segundo] = caminhoEmModulos.split("/");
  if (primeiro === DOMINIO_DAS_ETAPAS) return VALOR_PURO_DAS_ETAPAS.test(caminhoEmModulos) ? "nucleo" : "aplicacao";
  if (primeiro === MODULO_DO_HARNESS)
    return segundo === undefined || segundo.endsWith(".ts") ? MODULO_DO_HARNESS : `${MODULO_DO_HARNESS}/${segundo}`;
  if (primeiro !== undefined && DOMINIOS_DO_LEGADO.has(primeiro)) return segundo ?? "";
  return primeiro ?? "";
}

// O que as Etapas declaram (o catálogo, `definicao/` e o `definicao.ts` de cada uma) conta como um domínio à parte, embaixo
// do motor: todo o serviço lê os nomes das Etapas e o que cada uma declara, e a declaração só depende de `compartilhado`.
// O resto de `etapas/` (as conduções, os Gates, o prompt, a API do agente) é o domínio `etapas`, em cima do motor.
// Os demais arquivos ficam no domínio das duas primeiras pastas (`modulos/sdlc`, `server/api`...).
const DECLARACOES_DAS_ETAPAS = /^modulos\/etapas\/(catalogo\.ts|definicao\/.+|[^/]+\/definicao\.ts)$/;
const DOMINIO_DAS_DECLARACOES_DAS_ETAPAS = "modulos/etapas/definicao";

export function dominioDoArquivoDoLegadoNosCiclos(caminhoRelativoASrc: string): string {
  if (DECLARACOES_DAS_ETAPAS.test(caminhoRelativoASrc)) return DOMINIO_DAS_DECLARACOES_DAS_ETAPAS;
  return caminhoRelativoASrc.split("/").slice(0, 2).join("/");
}
