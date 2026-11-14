// Rotas de leitura das demandas (comparacao-sdlc §9.1): o board e a página de uma demanda, com o endereço público
// (D09) dos tickets e das rodadas, e os anexos das evidências. As ações do Auditor ficam em demandas_acoes.ts.
import { z } from "zod";
import { consultarBoardDeDemandas } from "./leituras/board_de_demandas.ts";
import { consultarDemanda } from "./leituras/demanda.ts";
import { BoardDeDemandas, PaginaDaDemanda } from "../contrato/demanda.ts";
import { IdDoCaminho, SemCorpoEmJson, type Rota } from "../rotas.ts";

const DonoDoAnexo = z.object({
  tipo: z.string().min(1),
  rodada: IdDoCaminho.optional(),
  ticket: IdDoCaminho.optional(),
});

/** RFC 5987: além do que o `encodeURIComponent` codifica, `'`, `(`, `)` e `*`, que não são attr-char. */
const rfc5987 = (texto: string): string =>
  encodeURIComponent(texto).replaceAll(/['()*]/g, (c) => `%${Number(c.codePointAt(0)).toString(16).toUpperCase()}`);

/** `GET /api/demandas/:id/anexos/:sha256`: o arquivo inteiro; o HTML roda numa origem opaca, sem alcançar a API. */
function anexo({ cicloDeVida, params, query, resposta }: Parameters<Rota["tratar"]>[0]): void {
  const dono = DonoDoAnexo.parse(Object.fromEntries(query));
  const arquivo = cicloDeVida.anexo(
    { demanda_id: String(params.id), tipo: dono.tipo, rodada_id: dono.rodada, ticket_id: dono.ticket },
    String(params.sha256),
  );
  resposta
    .writeHead(200, {
      "Content-Type": arquivo.mime,
      "Content-Security-Policy": "sandbox allow-scripts",
      ...(query.has("baixar") && { "Content-Disposition": `attachment; filename*=UTF-8''${rfc5987(arquivo.caminho)}` }),
    })
    .end(arquivo.conteudo);
}

export const ROTAS_DAS_DEMANDAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/demandas",
    tratar: ({ banco, cicloDeVida, demandas, relogio }) =>
      consultarBoardDeDemandas(banco, cicloDeVida, demandas, relogio),
    resposta: BoardDeDemandas,
  },
  {
    metodo: "GET",
    caminho: "/api/demandas/:id",
    tratar: ({ banco, cicloDeVida, demandas, params, relogio }) =>
      consultarDemanda(banco, cicloDeVida, demandas, String(params.id), relogio),
    resposta: PaginaDaDemanda,
  },
  { metodo: "GET", caminho: "/api/demandas/:id/anexos/:sha256", tratar: anexo, resposta: SemCorpoEmJson },
];
