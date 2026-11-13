// Regras de fronteira do Servidor, src/server/ (MELHORIAS §6): as partes dele são módulos da matriz, cada uma com o que pode
// importar. A entrega (api, cli, cli-agente, web, contrato) chama as consultas, os fluxos e as fachadas; as consultas leem
// as fachadas no formato do contrato; os fluxos coordenam as fachadas; a composição monta tudo. Dos domínios, só a
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
const MODULO_DAS_CONSULTAS_DAS_TELAS = "consultas";
const MODULO_DOS_FLUXOS = "fluxos";

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
  // Os tipos e schemas da API: só os schemas dos domínios (pelas fachadas), o núcleo e o zod. Nenhum domínio o importa
  // (as consultas das telas ficam em consultas/), e o cliente web só o importa como tipo (fora de `modulosPermitidos` dele).
  contrato: { modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS], externoPermitido: (alvo) => alvo === "zod" },
  // As consultas que montam a visão de uma tela no formato do contrato, juntando os domínios (MELHORIAS §6): só as
  // fachadas, o contrato e o shared (o núcleo e a leitura num snapshot); nem a entrega, nem os fluxos. Não falam SQL
  // (o motor cobra o `.prepare(`, e a posse das tabelas, o nome de tabela).
  [MODULO_DAS_CONSULTAS_DAS_TELAS]: {
    modulosPermitidos: ["nucleo", "armazenamento", "contrato", MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // Os fluxos que atravessam domínios (MELHORIAS §5.3): só as fachadas e o núcleo do shared; nem o contrato, nem a
  // entrega, nem as consultas.
  [MODULO_DOS_FLUXOS]: {
    modulosPermitidos: ["nucleo", MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  api: {
    modulosPermitidos: [
      "nucleo",
      MODULO_COMPARTILHADO_COM_O_NAVEGADOR,
      "contrato",
      MODULO_DAS_CONSULTAS_DAS_TELAS,
      MODULO_DOS_FLUXOS,
      MODULO_DAS_FACHADAS,
    ],
    externoPermitido: QUALQUER_EXTERNO,
  },
  cli: {
    modulosPermitidos: ["nucleo", "contrato", MODULO_DAS_CONSULTAS_DAS_TELAS, MODULO_DOS_FLUXOS, MODULO_DAS_FACHADAS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // O cliente do agente roda empacotado, sem o core: só o contrato e o Node (menos o SQLite).
  "cli-agente": { modulosPermitidos: ["contrato"], externoPermitido: SO_NODE_SEM_SQLITE },
  // Roda no navegador: de valor, só o `web/compartilhado` (o `casar` e o relógio do navegador); do contrato, do núcleo e
  // das fachadas, só `import type`; de fora, só os pacotes do navegador, servidos em /static/ pelo import map (`node:` só
  // nos testes, que a matriz não lê).
  [MODULO_CLIENTE_WEB]: {
    modulosPermitidos: [MODULO_COMPARTILHADO_COM_O_NAVEGADOR],
    modulosSoComoTipo: ["contrato", "nucleo", MODULO_DAS_FACHADAS],
    externoPermitido: (alvo) => PACOTES_DO_NAVEGADOR.has(pacoteDe(alvo)),
  },
  // A composição liga os fluxos às conduções que os pedem (a conclusão do pedido junto do encerramento do processo).
  composicao: {
    modulosPermitidos: [
      "nucleo",
      "armazenamento",
      "infra",
      "api",
      "cli",
      MODULO_DOS_FLUXOS,
      MODULO_COMPARTILHADO_COM_O_NAVEGADOR,
      "contrato",
      MODULO_CLIENTE_WEB,
      MODULO_DAS_FACHADAS,
    ],
    externoPermitido: QUALQUER_EXTERNO,
  },
};

// `server/web/compartilhado/` é um módulo à parte dentro da web; `api/`, `cli/`, `cli-agente/`, `contrato/`, `consultas/`,
// `fluxos/` e `composicao/`, cada um o seu.
export function moduloDoArquivoDoServidor(caminhoEmServer: string): string {
  const [primeiro, segundo] = caminhoEmServer.split("/");
  if (primeiro === MODULO_CLIENTE_WEB)
    return segundo === "compartilhado" ? MODULO_COMPARTILHADO_COM_O_NAVEGADOR : MODULO_CLIENTE_WEB;
  return primeiro ?? "";
}

/** A composição injeta o relógio: `new Date(` é liberado nela. */
export const PASTA_DA_COMPOSICAO = "server/composicao/";
/** As consultas das telas, que não falam SQL nem tocam tabela: leem pelas fachadas. */
export const PASTA_DAS_CONSULTAS = "server/consultas/";
/** A API do agente, que só alcança os casos de uso do agente. */
export const PASTA_DA_API_DO_AGENTE = "server/api/agente/";

// O servidor já está no destino; as partes dele são módulos da matriz, sem subdomínios.
export const REGRAS_DO_SERVIDOR: RegrasDoDominio = {
  dependeDe: ["demandas", "ciclo_de_vida", "sessoes", "repositorio", "ambiente"],
  subdominios: {},
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [], chamadoresDiretos: ["server/composicao/cli.ts"] },
};
