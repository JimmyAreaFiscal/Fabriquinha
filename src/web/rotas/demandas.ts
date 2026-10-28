// Rotas de leitura das demandas (comparacao-sdlc §9.1): o board e a página de uma demanda, com o endereço público
// (D09) dos tickets e das rodadas, e os anexos das evidências. As ações do Auditor ficam em demandas_acoes.ts.
import { z } from "zod";
import type { AgregadoDemanda } from "../../dominio/agregado_demanda.ts";
import { satisfazDependencia } from "../../dominio/cancelamento_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../dominio/demanda.ts";
import { achadoDaDemanda } from "../../persistencia/avaliacoes.ts";
import { selecionarTrabalho } from "../../dominio/selecao_trabalho.ts";
import { carregarDemanda, listarDemandas } from "../../persistencia/demandas.ts";
import { dependentesNaoConcluidasDaDemanda, predecessorasDaDemanda } from "../../persistencia/dependencias_demanda.ts";
import { anexosDaDemanda, lerAnexo } from "../../persistencia/evidencia_demanda.ts";
import { IdDoCaminho, type Rota } from "../rotas.ts";

const ref = (demanda_id: string) => ({
  rodada: (rodada_id: number) => formatarRodadaRef({ demanda_id, rodada_id }),
  ticket: (ticket_id: number) => formatarTicketRef({ demanda_id, ticket_id }),
});

/** O PR da rodada que espera decisão ou ajustes: o da última evidência `pr_aberto` do ticket `encerrar_rodada` dela. */
function prDaRodada(ag: AgregadoDemanda, rodada_id: number): { id: string; url: string } | undefined {
  const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
  if (rodada?.fase !== "aprovacao_pull_request" && rodada?.fase !== "sessao") return undefined;
  const ticket = ag.tickets.findLast((t) => t.rodada_id === rodada_id && t.etapa === "encerrar_rodada");
  const pr = ag.evidencias.findLast((e) => e.ticket_id === ticket?.ticket_id && e.tipo === "pr_aberto")?.dados as
    { id: string; url: string } | undefined;
  return pr && { id: pr.id, url: pr.url };
}

/** Os tickets `em_execucao` da demanda, com a rodada quando têm. */
const emExecucao = (ag: AgregadoDemanda) =>
  ag.tickets
    .filter((t) => t.status === "em_execucao")
    .map((t) => ({
      ref: ref(ag.demanda.id).ticket(t.ticket_id),
      etapa: t.etapa,
      ...(t.rodada_id !== undefined && { rodada: ref(ag.demanda.id).rodada(t.rodada_id) }),
    }));

/** Os tickets `falhou` da demanda: o que bloqueia a rodada até o Auditor reabrir. */
const falhos = (ag: AgregadoDemanda) =>
  ag.tickets
    .filter((t) => t.status === "falhou")
    .map((t) => ({ ref: ref(ag.demanda.id).ticket(t.ticket_id), etapa: t.etapa }));

/** `GET /api/demandas`: as demandas fora das arquivadas e, no total, o trabalho global ativo. */
function board(pedido: Parameters<Rota["tratar"]>[0]) {
  const todas = listarDemandas(pedido.banco);
  return {
    demandas: todas.map((ag) => {
      const { id, projeto, titulo, fase } = ag.demanda;
      return {
        id,
        projeto,
        titulo,
        fase,
        rodadas: ag.rodadas.map((r) => {
          const pr = prDaRodada(ag, r.rodada_id);
          return { ref: ref(id).rodada(r.rodada_id), fase: r.fase, ...(pr && { pr }) };
        }),
        bloqueios: predecessorasDaDemanda(pedido.banco, id).filter((p) => !satisfazDependencia(p.fase)),
        falhos: falhos(ag),
      };
    }),
    trabalho: todas.flatMap(emExecucao),
  };
}

/** A classe do anexo pelo mime, para a tela escolher como mostrar. */
const classeDoMime = (mime: string): "imagem" | "video" | "html" | "texto" | "outro" => {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  if (mime === "text/html") return "html";
  return mime.startsWith("text/") || mime === "application/json" ? "texto" : "outro";
};

/** Os passos do encerramento final: feito o que o progresso já registra. */
const passosDoEncerramento = (ag: AgregadoDemanda) => {
  const e = ag.encerramento;
  return {
    passos: [
      { passo: "verificacao", feito: e?.sha_verificado !== undefined },
      { passo: "pr", feito: e?.pr !== undefined },
      { passo: "integracao", feito: e?.integracao !== undefined },
    ],
    limpeza_pendente: e?.limpeza_pendente ?? [],
    ...(e?.falha && { falha: e.falha }),
  };
};

/** `GET /api/demandas/:id`: a página da demanda. */
function pagina({ banco, params }: Parameters<Rota["tratar"]>[0]) {
  const ag = carregarDemanda(banco, String(params.id));
  const { id } = ag.demanda;
  const { demanda } = ag;
  const { ticket, rodada } = ref(id);
  const anexos = anexosDaDemanda(banco, id);
  const achado = achadoDaDemanda(banco, id);
  // Uma leitura por demanda; com mais de uma sessão no ticket, vale a mais recente.
  const sessoes = new Map(
    (
      banco.prepare("SELECT ticket_id, id FROM sessao WHERE demanda_id = ? ORDER BY rowid").all(id) as {
        ticket_id: number;
        id: string;
      }[]
    ).map((s) => [s.ticket_id, s.id]),
  );
  const predecessoras = predecessorasDaDemanda(banco, id);
  const elegiveis = new Set(
    selecionarTrabalho(
      ag,
      predecessoras.every((p) => satisfazDependencia(p.fase)),
    ).map((t) => t.ticket_id),
  );
  return {
    ...(achado && { origem: { avaliacao: achado.avaliacao_id, achado: achado.achado_id, titulo: achado.titulo } }),
    demanda: { id, projeto: demanda.projeto, titulo: demanda.titulo, fase: demanda.fase },
    rodadas: ag.rodadas.map((r) => ({ ref: rodada(r.rodada_id), titulo: r.titulo, fase: r.fase })),
    tickets: ag.tickets.map((t) => ({
      ref: ticket(t.ticket_id),
      etapa: t.etapa,
      status: t.status,
      elegivel: elegiveis.has(t.ticket_id),
      ...(sessoes.has(t.ticket_id) && { sessao: sessoes.get(t.ticket_id) }),
      ...(t.rodada_id !== undefined && { rodada: rodada(t.rodada_id) }),
      ...(t.titulo !== undefined && { titulo: t.titulo }),
      ...(t.instrucao !== undefined && { instrucao: t.instrucao }),
      ...(t.motivo_falha !== undefined && { motivo_falha: t.motivo_falha }),
    })),
    decisoes: ag.decisoes.map(({ ticket_id, decisao_id: _, demanda_id: __, ...d }) => ({
      ticket: ticket(ticket_id),
      ...d,
    })),
    evidencias: ag.evidencias.map((e) => ({
      tipo: e.tipo,
      ...(e.rodada_id !== undefined && { rodada: rodada(e.rodada_id) }),
      ...(e.ticket_id !== undefined && { ticket: ticket(e.ticket_id) }),
      em: e.em,
      dados: e.dados,
      anexos: anexos
        .filter((a) => a.tipo === e.tipo && a.rodada_id === e.rodada_id && a.ticket_id === e.ticket_id)
        .map((a) => {
          const dono = new URLSearchParams({ tipo: a.tipo });
          if (a.rodada_id !== undefined) dono.set("rodada", String(a.rodada_id));
          if (a.ticket_id !== undefined) dono.set("ticket", String(a.ticket_id));
          return {
            nome: a.nome,
            classe: classeDoMime(a.mime),
            mime: a.mime,
            bytes: a.bytes,
            link: `/api/demandas/${id}/anexos/${a.sha256}?${dono.toString()}`,
          };
        }),
    })),
    encerramento: passosDoEncerramento(ag),
    dependencias: predecessoras,
    // As que o cancelamento leva junto (diretas e indiretas, ainda não terminadas).
    dependentes: dependentesNaoConcluidasDaDemanda(banco, id).map((d) => {
      const { titulo, fase } = carregarDemanda(banco, d).demanda;
      return { demanda_id: d, titulo, fase };
    }),
  };
}

const DonoDoAnexo = z.object({
  tipo: z.string().min(1),
  rodada: IdDoCaminho.optional(),
  ticket: IdDoCaminho.optional(),
});

/** RFC 5987: além do que o `encodeURIComponent` codifica, `'`, `(`, `)` e `*`, que não são attr-char. */
const rfc5987 = (texto: string): string =>
  encodeURIComponent(texto).replaceAll(/['()*]/g, (c) => `%${Number(c.codePointAt(0)).toString(16).toUpperCase()}`);

/** `GET /api/demandas/:id/anexos/:sha256`: o arquivo inteiro; o HTML roda numa origem opaca, sem alcançar a API. */
function anexo({ banco, params, query, resposta }: Parameters<Rota["tratar"]>[0]): void {
  const dono = DonoDoAnexo.parse(Object.fromEntries(query));
  const arquivo = lerAnexo(
    banco,
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
  { metodo: "GET", caminho: "/api/demandas", tratar: board },
  { metodo: "GET", caminho: "/api/demandas/:id", tratar: pagina },
  { metodo: "GET", caminho: "/api/demandas/:id/anexos/:sha256", tratar: anexo },
];
