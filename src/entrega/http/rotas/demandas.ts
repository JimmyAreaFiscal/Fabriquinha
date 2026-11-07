// Rotas de leitura das demandas (comparacao-sdlc §9.1): o board e a página de uma demanda, com o endereço público
// (D09) dos tickets e das rodadas, e os anexos das evidências. As ações do Auditor ficam em demandas_acoes.ts.
import { z } from "zod";
import type { AgregadoDemanda } from "../../../nucleo/agregado_demanda.ts";
import { satisfazDependencia } from "../../../nucleo/cancelamento_demanda.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET } from "../../../nucleo/ciclos.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../../nucleo/demanda.ts";
import { ticketAtualDaEtapa } from "../../../nucleo/item_de_trabalho.ts";
import { achadoDaDemanda } from "../../../armazenamento/avaliacoes.ts";
import { EtapaTicket } from "../../../nucleo/primitivos.ts";
import { selecionarTrabalho } from "../../../nucleo/selecao_trabalho.ts";
import { carregarDemanda, listarDemandas } from "../../../armazenamento/demandas.ts";
import {
  dependentesNaoConcluidasDaDemanda,
  predecessorasDaDemanda,
} from "../../../armazenamento/dependencias_demanda.ts";
import { anexosDaDemanda, lerAnexo } from "../../../armazenamento/evidencia_demanda.ts";
import { ticketsComPiAtivo } from "../../../armazenamento/sessoes.ts";
import { IdDoCaminho, type Rota } from "../rotas.ts";

const ref = (demanda_id: string) => ({
  rodada: (rodada_id: number) => formatarRodadaRef({ demanda_id, rodada_id }),
  ticket: (ticket_id: number) => formatarTicketRef({ demanda_id, ticket_id }),
});

/** O PR da rodada que espera decisão ou ajustes: o da última evidência `pr_aberto` do ticket `encerrar_rodada` dela. */
export function prDaRodada(ag: AgregadoDemanda, rodada_id: number): { id: string; url: string } | undefined {
  const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
  if (rodada?.estado !== "gate_pr" && rodada?.estado !== "ajustar_resultado") return undefined;
  const ticket = ticketAtualDaEtapa(ag, "encerrar_rodada", rodada_id);
  const pr = ag.evidencias.findLast((e) => e.ticket_id === ticket?.ticket_id && e.tipo === "pr_aberto")?.dados as
    { id: string; url: string } | undefined;
  return pr && { id: pr.id, url: pr.url };
}

/** Os tickets `em_execucao` da demanda, com a rodada quando têm e `pi_ativo` quando é o pi que roda. */
const emExecucao = (ag: AgregadoDemanda, comPiAtivo: ReadonlySet<string>) =>
  ag.tickets
    .filter((t) => t.estado === "em_execucao")
    .map((t) => {
      const ticketRef = ref(ag.demanda.id).ticket(t.ticket_id);
      return {
        ref: ticketRef,
        etapa: t.etapa,
        ...(t.rodada_id !== undefined && { rodada: ref(ag.demanda.id).rodada(t.rodada_id) }),
        ...(comPiAtivo.has(ticketRef) && { pi_ativo: true }),
      };
    });

/** Os tickets `falhou` da demanda: o que bloqueia a rodada até o Auditor reabrir. */
const falhos = (ag: AgregadoDemanda) =>
  ag.tickets
    .filter((t) => t.estado === "falhou")
    .map((t) => ({ ref: ref(ag.demanda.id).ticket(t.ticket_id), etapa: t.etapa }));

/** `GET /api/demandas`: as demandas fora das arquivadas e, no total, o trabalho global ativo. */
function board(pedido: Parameters<Rota["tratar"]>[0]) {
  const todas = listarDemandas(pedido.banco);
  const comPiAtivo = ticketsComPiAtivo(pedido.banco);
  return {
    demandas: todas.map((ag) => {
      const { id, projeto, titulo, estado } = ag.demanda;
      return {
        id,
        projeto,
        titulo,
        estado,
        terminal: CICLO_DA_DEMANDA.ehTerminal(estado),
        rodadas: ag.rodadas.map((r) => {
          const pr = prDaRodada(ag, r.rodada_id);
          return { ref: ref(id).rodada(r.rodada_id), estado: r.estado, ...(pr && { pr }) };
        }),
        bloqueios: predecessorasDaDemanda(pedido.banco, id).filter((p) => !satisfazDependencia(p.estado)),
        falhos: falhos(ag),
        aguarda_merge: ag.encerramento?.aguardando_merge_humano === true,
      };
    }),
    trabalho: todas.flatMap((ag) => emExecucao(ag, comPiAtivo)),
  };
}

/** A classe do anexo pelo mime, para a tela escolher como mostrar. */
const classeDoMime = (mime: string): "imagem" | "video" | "html" | "texto" | "outro" => {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/html")) return "html";
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
    ...(e?.aguardando_merge_humano && e.pr && { aguardando_merge: { url: e.pr.url } }),
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
  const comPiAtivo = ticketsComPiAtivo(banco);
  const predecessoras = predecessorasDaDemanda(banco, id);
  const elegiveis = new Set(
    selecionarTrabalho(
      ag,
      predecessoras.every((p) => satisfazDependencia(p.estado)),
    ).map((t) => t.ticket_id),
  );
  return {
    ...(achado && { origem: { avaliacao: achado.avaliacao_id, achado: achado.achado_id, titulo: achado.titulo } }),
    demanda: {
      id,
      projeto: demanda.projeto,
      titulo: demanda.titulo,
      tipo: demanda.tipo,
      descricao: demanda.descricao,
      estado: demanda.estado,
      terminal: CICLO_DA_DEMANDA.ehTerminal(demanda.estado),
      arquivavel: CICLO_DA_DEMANDA.transicoes[demanda.estado].includes("arquivada"),
    },
    rodadas: ag.rodadas.map((r) => ({
      ref: rodada(r.rodada_id),
      titulo: r.titulo,
      estado: r.estado,
      ticket_atual_por_etapa: Object.fromEntries(
        EtapaTicket.options.flatMap((etapa) => {
          const atual = ticketAtualDaEtapa(ag, etapa, r.rodada_id);
          return atual ? [[etapa, ticket(atual.ticket_id)]] : [];
        }),
      ),
    })),
    tickets: ag.tickets.map((t) => ({
      ref: ticket(t.ticket_id),
      etapa: t.etapa,
      estado: t.estado,
      satisfaz_dependencia: CICLO_DO_TICKET.satisfazDependencia(t.estado),
      // O encerrar_demanda à espera do merge humano não pede execução ao Auditor: pede o merge na plataforma.
      elegivel:
        elegiveis.has(t.ticket_id) && !(t.etapa === "encerrar_demanda" && ag.encerramento?.aguardando_merge_humano),
      ...(sessoes.has(t.ticket_id) && { sessao: sessoes.get(t.ticket_id) }),
      ...(comPiAtivo.has(ticket(t.ticket_id)) && { pi_ativo: true }),
      ...(t.rodada_id !== undefined && { rodada: rodada(t.rodada_id) }),
      ...(t.titulo !== undefined && { titulo: t.titulo }),
      ...(t.instrucao !== undefined && { instrucao: t.instrucao }),
      ...(t.motivo_falha !== undefined && { motivo_falha: t.motivo_falha }),
    })),
    // A tela mostra `por` em texto: o tipo do Ator, como era antes do Ator único.
    decisoes: ag.decisoes.map(({ ticket_id, decisao_id: _, demanda_id: __, por, ...d }) => ({
      ticket: ticket(ticket_id),
      ...d,
      por: por.tipo,
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
      const { titulo, estado } = carregarDemanda(banco, d).demanda;
      return { demanda_id: d, titulo, estado };
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
