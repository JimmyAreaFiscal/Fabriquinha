// Regras de fronteira do Servidor, src/server/ (MELHORIAS §6): as partes dele são módulos da matriz, cada uma com o que pode
// importar (PROPOSTA §3): a API e o CLI do system chamam as fachadas, uma função por rota e por comando; a web só fala
// com a API (dela, só os tipos do contrato); a montagem monta tudo. Dos domínios, só a
// fachada; do shared, a camada do arquivo (nucleo, armazenamento, infra). O motor (../motor.ts) explica os campos.
import {
  MODULO_DAS_FACHADAS,
  QUALQUER_EXTERNO,
  type RegraDoModulo,
  type RegrasDoDominio,
  SO_NODE_SEM_SQLITE,
} from "../motor.ts";

const MODULO_CLIENTE_WEB = "web";
const MODULO_COMPARTILHADO_COM_O_NAVEGADOR = "web/compartilhado";
const MODULO_DO_CONTRATO = "contrato";
const MODULO_DA_API = "api";
const MODULO_DO_CLI = "cli";
const MODULO_DO_CLI_DO_AGENTE = "cli-agente";
const MODULO_DA_MONTAGEM = "montagem";

// O pacote de um especificador externo: `react-dom/client` → `react-dom`, `@assistant-ui/react/x` → `@assistant-ui/react`.
const pacoteDe = (alvo: string): string =>
  alvo
    .split("/")
    .slice(0, alvo.startsWith("@") ? 2 : 1)
    .join("/");
const PACOTES_DO_NAVEGADOR = new Set(["react-dom", "@assistant-ui/react", "markdown-it"]);

export const MATRIZ_DO_SERVIDOR: Record<string, RegraDoModulo> = {
  // Puro: importável pelo servidor e pelo navegador.
  [MODULO_COMPARTILHADO_COM_O_NAVEGADOR]: { modulosPermitidos: [], externoPermitido: () => false },
  // Os tipos e schemas da API (system/api/contrato/): só os schemas dos domínios (pelas fachadas), o núcleo e o zod.
  // Nenhum domínio o importa, e o cliente web só o importa como tipo (fora de `modulosPermitidos` dele).
  [MODULO_DO_CONTRATO]: {
    modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS],
    externoPermitido: (alvo) => alvo === "zod",
  },
  // Uma função por rota (system/api/ e a API do agente, system/cli/api_do_agente/), com as leituras das telas ao lado:
  // as fachadas, o contrato e o shared (o núcleo e a leitura num snapshot); nem o CLI, nem a composição. Não fala SQL
  // (o motor cobra o `.prepare(`, e a posse das tabelas, o nome de tabela).
  [MODULO_DA_API]: {
    modulosPermitidos: [
      "nucleo",
      "armazenamento",
      MODULO_COMPARTILHADO_COM_O_NAVEGADOR,
      MODULO_DO_CONTRATO,
      MODULO_DAS_FACHADAS,
    ],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // Uma função por comando do `fabriquinha` (system/cli/): o contrato, o núcleo e as fachadas.
  [MODULO_DO_CLI]: {
    modulosPermitidos: ["nucleo", MODULO_DO_CONTRATO, MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // O cliente do agente (system/cli/agente/) roda empacotado, sem o core: só o contrato e o Node (menos o SQLite).
  [MODULO_DO_CLI_DO_AGENTE]: { modulosPermitidos: [MODULO_DO_CONTRATO], externoPermitido: SO_NODE_SEM_SQLITE },
  // Roda no navegador: de valor, só o `web/compartilhado` (o `casar` e o relógio do navegador); do contrato, do núcleo e
  // das fachadas, só `import type`; de fora, só os pacotes do navegador, servidos em /static/ pelo import map (`node:` só
  // nos testes, que a matriz não lê).
  [MODULO_CLIENTE_WEB]: {
    modulosPermitidos: [MODULO_COMPARTILHADO_COM_O_NAVEGADOR],
    modulosSoComoTipo: [MODULO_DO_CONTRATO, "nucleo", MODULO_DAS_FACHADAS],
    externoPermitido: (alvo) => PACOTES_DO_NAVEGADOR.has(pacoteDe(alvo)),
  },
  // A montagem (os arquivos direto em system/) monta os módulos e liga a API, o CLI e a web.
  [MODULO_DA_MONTAGEM]: {
    modulosPermitidos: [
      "nucleo",
      "armazenamento",
      "infra",
      MODULO_DA_API,
      MODULO_DO_CLI,
      MODULO_COMPARTILHADO_COM_O_NAVEGADOR,
      MODULO_DO_CONTRATO,
      MODULO_CLIENTE_WEB,
      MODULO_DAS_FACHADAS,
    ],
    externoPermitido: QUALQUER_EXTERNO,
  },
};

// `web/compartilhado/` é um módulo à parte dentro da web. Em `system/`: os arquivos direto nele são a montagem;
// `api/contrato/` é o contrato; o resto de `api/` e `cli/api_do_agente/` são a API; `cli/agente/` é o cliente do agente;
// o resto de `cli/`, o CLI.
export function moduloDoArquivoDoServidor(caminhoEmServer: string): string {
  const [primeiro, segundo, terceiro] = caminhoEmServer.split("/");
  if (primeiro === MODULO_CLIENTE_WEB)
    return segundo === "compartilhado" ? MODULO_COMPARTILHADO_COM_O_NAVEGADOR : MODULO_CLIENTE_WEB;
  if (primeiro !== "system") return primeiro ?? "";
  if (terceiro === undefined) return MODULO_DA_MONTAGEM;
  if (segundo === "api") return terceiro === "contrato" ? MODULO_DO_CONTRATO : MODULO_DA_API;
  if (segundo === "cli" && terceiro === "agente") return MODULO_DO_CLI_DO_AGENTE;
  if (segundo === "cli" && terceiro === "api_do_agente") return MODULO_DA_API;
  return segundo === "cli" ? MODULO_DO_CLI : (segundo ?? "");
}

/** A montagem injeta o relógio: `new Date(` é liberado nela (os arquivos direto em system/). */
export const PASTA_DA_MONTAGEM = "server/system";
/** O system inteiro (rotas, leituras das telas, comandos e montagem), que não toca tabela: lê pelas fachadas. */
export const PASTA_DO_SYSTEM = "server/system/";
/** A API das telas, que não fala SQL nem toca tabela: lê pelas fachadas. */
export const PASTA_DA_API = "server/system/api/";
/** A API do agente, que só alcança os casos de uso do agente. */
export const PASTA_DA_API_DO_AGENTE = "server/system/cli/api_do_agente/";

// O servidor já está no destino; as partes dele são módulos da matriz, sem subdomínios.
export const REGRAS_DO_SERVIDOR: RegrasDoDominio = {
  dependeDe: ["demandas", "ciclo_de_vida", "sessoes", "repositorio", "ambiente"],
  subdominios: {},
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: ["server/system/executar_fabriquinha.ts"],
  },
};
