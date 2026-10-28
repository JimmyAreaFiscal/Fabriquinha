// Avaliação de melhoria do SDLC sobre demandas (D12, I-240): o pi só de leitura que lê as sessões, evidências e métricas
// das demandas do escopo (projeto, período e, se o Auditor quiser, demandas específicas), registra os achados com a
// ferramenta `registrar_achado` e conversa com o Auditor; o Auditor encaminha um achado como demanda nova. Reaproveita
// a condução da Auditoria do Histórico; nada na pasta da avaliação sai dela, e o custo não entra nas métricas das demandas.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeRegra, ErroExterno } from "../dominio/erros.ts";
import { metricasDaDemanda } from "../metricas/demanda.ts";
import { somar } from "../metricas/uso.ts";
import { raizDo, escrever } from "../persistencia/banco.ts";
import {
  abrirAvaliacao,
  apagarAvaliacao,
  criarAvaliacao,
  demandasComSessaoNoPeriodo,
  importarAchados,
  projetoDaDemanda,
  regravarUso,
  sessoesDaDemandaNoPeriodo,
  vincularAchado,
} from "../persistencia/avaliacoes.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
import { arquivoDaSessao } from "../persistencia/execucoes.ts";
import { abortar, assinar as assinarSessao } from "./gerente.ts";
import {
  causaDaFalha,
  type Conducao,
  enviarNaConversa,
  estadoDaAuditoria,
  type OpcoesDaAuditoria,
  subir,
} from "./auditoria.ts";
import * as gestao from "./gestao_demandas.ts";
import type { EventoPi } from "./pi.ts";
import { emMarkdown, lerConversa, type Mensagem, texto } from "./sessoes_demanda.ts";

export interface EscopoDaAvaliacao {
  projeto: string;
  /** AAAA-MM-DD, inclusivas. */
  de: string;
  ate: string;
  demandas?: string[];
  pedido?: string;
}

export type EstadoDaAvaliacao = "rodando" | "concluida";

const dirDaAvaliacao = (raiz: string, id: string): string => join(raiz, "avaliacoes", id);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Importa os achados novos de `achados.jsonl` (o nº da linha é o id do achado) e regrava o uso do JSONL da sessão. */
function sincronizar(banco: DatabaseSync, raiz: string, id: string): void {
  const arquivo = join(dirDaAvaliacao(raiz, id), "achados.jsonl");
  const linhas = existsSync(arquivo) ? readFileSync(arquivo, "utf8").split("\n").filter(Boolean) : [];
  importarAchados(
    banco,
    id,
    linhas.map((l, i) => ({
      achado_id: i + 1,
      ...(JSON.parse(l) as { titulo: string; descricao: string; evidencia: string }),
    })),
  );
  const jsonl = arquivoDaSessao(raiz, id);
  const somas = jsonl ? somar(readFileSync(jsonl, "utf8"), 0, Number.POSITIVE_INFINITY) : [];
  regravarUso(
    banco,
    id,
    somas.map((s) => ({
      modelo_provedor: s.provedor,
      modelo_nome: s.modelo,
      chamadas: s.chamadas,
      tokens_entrada: s.input,
      tokens_saida: s.output,
      tokens_cache_leitura: s.cacheRead,
      tokens_cache_escrita: s.cacheWrite,
      custo: s.semCusto ? null : s.custo,
    })),
  );
}

const conducao = (banco: DatabaseSync, raiz: string, id: string): Conducao => ({
  pasta: "avaliacoes",
  extensoes: ["achado.ts"],
  sincronizar: () => {
    sincronizar(banco, raiz, id);
  },
});

/** As demandas do escopo; recusa (409) o escopo sem demanda e a demanda pedida de outro projeto ou sem sessão no período. */
function demandasDoEscopo(banco: DatabaseSync, { projeto, de, ate, demandas }: EscopoDaAvaliacao): string[] {
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) {
    throw new ErroDeRegra(`o período ${de} a ${ate} é inválido`, "informe de e ate como AAAA-MM-DD, com de até ate");
  }
  const doPeriodo = demandasComSessaoNoPeriodo(banco, projeto, de, ate);
  if (doPeriodo.length === 0) {
    throw new ErroDeRegra(
      `o projeto ${projeto} não tem demanda com sessão entre ${de} e ${ate}`,
      "escolha outro período ou projeto",
    );
  }
  for (const d of demandas ?? []) {
    const dono = projetoDaDemanda(banco, d);
    if (dono !== undefined && dono !== projeto) {
      throw new ErroDeRegra(`a demanda ${d} é do projeto ${dono}, não de ${projeto}`, "escolha demandas do projeto");
    }
    if (!doPeriodo.includes(d)) {
      throw new ErroDeRegra(
        `a demanda ${d} não tem sessão do projeto ${projeto} entre ${de} e ${ate}`,
        "escolha demandas com sessão no período",
      );
    }
  }
  return demandas?.length ? [...new Set(demandas)].toSorted((a, b) => a.localeCompare(b)) : doPeriodo;
}

/** Grava em `dir` o que o agente lê: `indice.md`, `demandas/<id>/{demanda.md,metricas.json}` e `sessoes/<demanda>-<sessao>.md`. */
function prepararPasta(banco: DatabaseSync, dir: string, e: EscopoDaAvaliacao, demandas: string[]): void {
  const raiz = raizDo(banco);
  const arquivos: string[] = [];
  for (const id of demandas) {
    const { demanda } = carregarDemanda(banco, id);
    mkdirSync(join(dir, "demandas", id), { recursive: true });
    writeFileSync(
      join(dir, "demandas", id, "demanda.md"),
      `# ${id} — ${demanda.titulo}\n\n- Tipo: ${demanda.tipo}\n- Fase: ${demanda.fase}\n\n${demanda.descricao}\n`,
    );
    writeFileSync(
      join(dir, "demandas", id, "metricas.json"),
      JSON.stringify(metricasDaDemanda(banco, id), null, 2) + "\n",
    );
    mkdirSync(join(dir, "sessoes"), { recursive: true });
    for (const sessao of sessoesDaDemandaNoPeriodo(banco, id, e.de, e.ate)) {
      const nome = `${id}-${sessao}.md`;
      arquivos.push(nome);
      // ponytail: sem os prompts da Fabriquinha marcados, toda mensagem do usuário aparece como "Auditor".
      const mensagens = lerConversa(raiz, sessao).flatMap((x) => {
        const { type, message } = x as { type?: string; message?: Mensagem };
        return type === "message" && message ? [message] : [];
      });
      writeFileSync(
        join(dir, "sessoes", nome),
        [`# Sessão ${sessao} (${id})`, ...mensagens.flatMap((m) => emMarkdown(m, new Set()))].join("\n\n") + "\n",
      );
    }
  }
  writeFileSync(
    join(dir, "indice.md"),
    [
      "# Avaliação de melhoria do SDLC",
      "",
      `- Projeto: ${e.projeto}`,
      `- Período: ${e.de} a ${e.ate} (inclusive)`,
      `- Demandas: ${demandas.join(", ")}`,
      "",
      "## Sessões",
      "",
      ...arquivos.map((a) => `- sessoes/${a}`),
      "",
    ].join("\n"),
  );
}

/** `prompt.md`: o escopo e os caminhos, o pedido do Auditor (se houver) e o texto fixo da avaliação. */
function promptDaAvaliacao(dir: string, e: EscopoDaAvaliacao): string {
  const fixo = readFileSync(new URL("avaliacao.md", import.meta.url), "utf8");
  return [
    `# Avaliação do projeto ${e.projeto} (${e.de} a ${e.ate})`,
    "",
    `Pasta da avaliação, o seu diretório de trabalho: ${dir}`,
    `- Índice: ${join(dir, "indice.md")}`,
    `- Demandas: ${join(dir, "demandas")}/`,
    `- Sessões: ${join(dir, "sessoes")}/`,
    "",
    ...(e.pedido ? ["## Pedido do Auditor", "", e.pedido, "", "O pedido é o foco da avaliação.", ""] : []),
    fixo,
  ].join("\n");
}

/**
 * Valida o escopo, grava a avaliação, prepara `<raiz>/avaliacoes/<id>/` e sobe o pi; resolve com o id no primeiro
 * `agent_start`. Se o pi não sobe, não sobra avaliação, pasta nem JSONL, e o erro leva a causa (CA-17).
 */
export async function iniciarAvaliacao(
  banco: DatabaseSync,
  escopo: EscopoDaAvaliacao,
  opcoes: OpcoesDaAuditoria,
): Promise<string> {
  const demandas = demandasDoEscopo(banco, escopo);
  const raiz = raizDo(banco);
  const id = randomUUID();
  const dir = dirDaAvaliacao(raiz, id);
  const pedido = escopo.pedido?.trim() ?? "";
  mkdirSync(join(dir, "vazio"), { recursive: true });
  try {
    criarAvaliacao(banco, {
      id,
      projeto: escopo.projeto,
      de: escopo.de,
      ate: escopo.ate,
      pedido,
      criada_em: new Date().toISOString(),
      demandas,
    });
    prepararPasta(banco, dir, escopo, demandas);
    const prompt = promptDaAvaliacao(dir, { ...escopo, pedido });
    writeFileSync(join(dir, "prompt.md"), prompt);
    const comeco = Promise.withResolvers<true>();
    const desassinar = assinarSessao(id, (evento) => {
      if (evento.type === "agent_start") comeco.resolve(true);
    });
    const resultado = await Promise.race([
      comeco.promise,
      subir(raiz, id, prompt, opcoes, conducao(banco, raiz, id)),
    ]).finally(desassinar);
    if (resultado !== true) {
      throw new ErroExterno(`o agente da avaliação não subiu: ${causaDaFalha(dir, String(resultado))}`, "confira o pi");
    }
    return id;
  } catch (error_) {
    const jsonl = arquivoDaSessao(raiz, id);
    if (jsonl) rmSync(jsonl);
    apagarAvaliacao(banco, id);
    rmSync(dir, { recursive: true, force: true });
    throw error_;
  }
}

/** Derivado do pi: trabalhando (ou subindo/parando) é rodando; parado, concluída. */
export const estadoDaAvaliacao = (id: string): EstadoDaAvaliacao =>
  estadoDaAuditoria(id) === "rodando" ? "rodando" : "concluida";

/** A avaliação `id` com o escopo, os achados, o uso, o estado e a conversa; o `prompt.md` vai marcado `fabriquinha: true`. */
export function abrir(banco: DatabaseSync, id: string) {
  const dados = abrirAvaliacao(banco, id); // recusa a inexistente antes de ler a pasta
  const raiz = raizDo(banco);
  const prompt = readFileSync(join(dirDaAvaliacao(raiz, id), "prompt.md"), "utf8");
  const ehPrompt = (mensagem: unknown): boolean => {
    const m = mensagem as Partial<Mensagem> | undefined;
    return m?.role === "user" && texto(m as Mensagem) === prompt;
  };
  const eventos = lerConversa(raiz, id) as { message?: unknown }[];
  const primeira = eventos.findIndex((e) => (e.message as { role?: string } | undefined)?.role === "user");
  return {
    ...dados,
    estado: estadoDaAvaliacao(id),
    conversa: eventos.map((e, i) =>
      i === primeira && ehPrompt(e.message) ? { ...e, fabriquinha: true } : e,
    ) as unknown[],
    /** Os eventos ao vivo, com `{ type: "estado", estado }` quando o estado muda. Devolve a função que cancela. */
    assinar: (ouvinte: (evento: EventoPi) => void) =>
      assinarSessao(id, (evento) => {
        if (evento.type === "estado") ouvinte({ type: "estado", estado: estadoDaAvaliacao(id) });
        else
          ouvinte(
            evento.type === "message_end" && ehPrompt(evento.message) ? { ...evento, fabriquinha: true } : evento,
          );
      }),
  };
}

/** A pergunta do Auditor: ao pi vivo e ocioso, ou a um pi novo na mesma sessão e pasta. */
export function enviarNaAvaliacao(banco: DatabaseSync, id: string, mensagem: string, opcoes: OpcoesDaAuditoria): void {
  abrirAvaliacao(banco, id);
  const raiz = raizDo(banco);
  enviarNaConversa(id, mensagem, (prompt) => void subir(raiz, id, prompt, opcoes, conducao(banco, raiz, id)));
}

/** Manda `abort` ao agente da avaliação que trabalha. */
export const abortarAvaliacao = (id: string): void => {
  abortar(id);
};

/**
 * Encaminha o achado como demanda nova (tipo funcionalidade, em registro), com o vínculo nos dois sentidos: o
 * `demanda_id` do achado e a origem da demanda (`avaliacao` / `<id>#<n>`). Recusa o achado já encaminhado (CA-14).
 */
export function encaminharAchado(banco: DatabaseSync, id: string, achadoId: number): AgregadoDemanda {
  return escrever(banco, () => {
    const avaliacao = abrirAvaliacao(banco, id);
    const achado = avaliacao.achados.find((a) => a.achado_id === achadoId);
    if (!achado)
      throw new ErroDeRegra(`o achado ${String(achadoId)} da avaliação ${id} não existe`, "confira o achado");
    if (achado.demanda_id) {
      throw new ErroDeRegra(
        `o achado ${String(achadoId)} já foi encaminhado como ${achado.demanda_id}`,
        "abra a demanda criada",
      );
    }
    const ag = gestao.registrar(
      banco,
      {
        projeto: avaliacao.projeto,
        titulo: achado.titulo,
        tipo: "funcionalidade",
        descricao: `${achado.descricao}\n\nEvidência: ${achado.evidencia}\n\nOrigem: avaliação ${id}, achado ${String(achadoId)}.`,
      },
      { ferramenta: "avaliacao", sessao: `${id}#${String(achadoId)}` },
      { agora: new Date().toISOString() },
    );
    vincularAchado(banco, id, achadoId, ag.demanda.id);
    return ag;
  });
}
