// Grupo do estresse dos comandos do CLI de `COMANDOS_DEMANDA_EXTERNA` e `COMANDOS_DEMANDA`: uma ação por comando, cada
// chamada um processo `fabriquinha` de verdade na raiz temporária. O tempo vai do início do processo à saída dele; a
// preparação (demandas, execuções abertas, arquivos) é semeada toda antes e fica fora do tempo medido. Saída diferente
// de 0, `SQLITE_BUSY` ou `database is locked` contam como erro. `semMedicaoCli` confere a cobertura contra as duas tabelas.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { COMANDOS_DEMANDA } from "../../src/cli/agente_demanda.ts";
import { COMANDOS_DEMANDA_EXTERNA } from "../../src/cli/demanda_externa.ts";
import type { AgregadoDemanda } from "../../src/dominio/agregado_demanda.ts";
import { criarSessao, iniciarExecucao } from "../../src/dominio/sessoes.ts";
import { registrar, submeterEvidencia } from "../../src/execucao/gestao_demandas.ts";
import { abrir, escrever, novoId } from "../../src/persistencia/banco.ts";
import { criarDemandaNova } from "../../src/persistencia/demandas.ts";
import { comSessoesDoTicket } from "../../src/persistencia/sessoes.ts";
import type { Ambiente } from "../ambiente.ts";

/** Um comando do CLI medido: `chamar` roda um processo e devolve o tempo em ms, ou lança quando o resultado é inesperado. */
export interface AcaoCli {
  /** `fabriquinha <palavras>`, com ` (agente)` nos comandos de `COMANDOS_DEMANDA`: é o nome da ação na tabela. */
  nome: string;
  /** Orçamento de p95 em ms: 3× o p95 medido nesta máquina (Linux, Node 22, SQLite local), para não virar teste instável. */
  orcamento: number;
  chamar(): Promise<number>;
}

const CHAMADAS = 200;
const em = "2026-10-11T12:00:00.000Z";
const AUTOR = ["--ferramenta", "estresse", "--sessao", "s-estresse"];
const HTML = "<!doctype html><p>Desenho</p>";
const BUSY = /SQLITE_BUSY|database is locked/i;

const nomeExterno = (palavras: readonly string[]) => `fabriquinha ${palavras.join(" ")}`;
const nomeAgente = (palavras: readonly string[]) => `${nomeExterno(palavras)} (agente)`;

/** Um processo `fabriquinha`; o tempo vai do `spawn` ao `close`. Lança com saída ≠ 0 ou com erro de banco ocupado. */
async function processo(raiz: string, execucao: string, args: string[], cwd: string): Promise<number> {
  const inicio = performance.now();
  const filho = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "../../src/cli/fabriquinha.ts"), ...args],
    {
      cwd,
      env: { ...process.env, FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: execucao },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let saida = "";
  for (const s of [filho.stdout, filho.stderr]) s.on("data", (parte: Buffer) => (saida += parte.toString()));
  const [codigo] = (await once(filho, "close")) as [number | null];
  const tempo = performance.now() - inicio;
  if (codigo !== 0) throw new Error(`${args.join(" ")}: saiu com ${String(codigo)}: ${saida.trim()}`);
  if (BUSY.test(saida)) throw new Error(`${args.join(" ")}: banco ocupado: ${saida.trim()}`);
  return tempo;
}

interface Agente {
  demanda: string;
  execucao: string;
  ticket: string;
  rodada: string;
}

/** A demanda em execução com a rodada R1 em `faseRodada` e o ticket 2 de `etapa`, e uma execução aberta só dele. */
function semearAgente(banco: DatabaseSync, faseRodada: string, etapa: string): Agente {
  const demanda = criarDemandaNova(
    banco,
    (id) =>
      ({
        demanda: {
          id,
          projeto: "cli",
          titulo: "Demanda do estresse",
          tipo: "funcionalidade",
          descricao: "d",
          fase: "execucao",
          fase_alterada_em: em,
          origem_ferramenta: "estresse",
          origem_sessao: "s-estresse",
          enviada: true,
          branch: `fabriquinha/${id}`,
        },
        rodadas: [
          { demanda_id: id, rodada_id: 1, titulo: "r1", fase: faseRodada, e2e: false, branch: `fabriquinha/${id}-1` },
        ],
        dependencias_rodada: [],
        criterios_citados: [],
        tickets: [
          {
            demanda_id: id,
            ticket_id: 1,
            etapa: "implementar",
            status: "concluido",
            status_alterado_em: em,
            rodada_id: 1,
            devolucoes: 0,
          },
          {
            demanda_id: id,
            ticket_id: 2,
            etapa,
            status: "aberto",
            status_alterado_em: em,
            rodada_id: 1,
            devolucoes: 0,
          },
        ],
        dependencias_ticket: [],
        caminhos_ticket: [],
        decisoes: [],
        evidencias: [],
      }) as unknown as AgregadoDemanda,
  ).demanda.id;
  const execucao = `ex-${demanda}`;
  comSessoesDoTicket(banco, { demanda_id: demanda, ticket_id: 2 }, (e) => {
    const sessoes = criarSessao(e.sessoes, {
      id: `s-${execucao}`,
      demanda_id: demanda,
      ticket_id: 2,
      modo: "autonomo",
      conversa_referencia: `s-${execucao}`,
    });
    return {
      ...e,
      sessoes,
      execucoes: iniciarExecucao(sessoes, e.execucoes, {
        id: execucao,
        sessao_id: `s-${execucao}`,
        inicio: em,
        falha: false,
      }),
    };
  });
  return { demanda, execucao, ticket: `${demanda}.T2`, rodada: `${demanda}.R1` };
}

/** Semeia o ambiente e devolve uma ação por comando das duas tabelas. O orçamento de cada uma fica ao lado dela. */
export function acoesCli(amb: Ambiente): AcaoCli[] {
  const pasta = join(amb.raiz, "cli");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "descricao.md"), "Descrição do estresse.\n");
  const desenho = { resumo: "r", arquivosPrevistos: [{ caminho: "a.ts", acao: "alterar", motivo: "m" }] };
  writeFileSync(join(pasta, "dados.json"), JSON.stringify(desenho));
  writeFileSync(join(pasta, "desenho.html"), HTML);

  // Um rascunho por chamada nos comandos que gravam na demanda; uma execução própria por chamada nos do agente que gravam.
  const rascunhos: string[] = [];
  const criar: Agente[] = [];
  const decidir: Agente[] = [];
  let leitura: Agente;
  const banco = abrir(amb.raiz);
  try {
    banco
      .prepare(
        "INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key) VALUES ('cli', ?, 'main', 'github', 'cli')",
      )
      .run(amb.raiz);
    // O grupo HTTP semeia demandas com id escolhido, fora da sequência: gasta um número por demanda já existente.
    const existentes = Number(banco.prepare("SELECT COUNT(*) AS n FROM demanda").get()?.n);
    escrever(banco, () => {
      for (let k = 0; k < existentes; k++) novoId(banco, "issue");
    });
    for (let i = 0; i < CHAMADAS * 3; i++) {
      const entrada = { projeto: "cli", titulo: "Demanda do estresse", tipo: "funcionalidade", descricao: "d" };
      const autor = { ferramenta: "estresse", sessao: "s-estresse" };
      rascunhos.push(registrar(banco, entrada, autor, { agora: em }).demanda.id);
    }
    // `enviar` exige as três evidências de quem registra; o rascunho de cada chamada nasce com elas.
    const linha = {
      provedor: "a",
      modelo: "m",
      tokens_entrada: 1,
      tokens_saida: 1,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
    };
    for (const [i, id] of rascunhos.slice(2 * CHAMADAS).entries()) {
      const autor = { ferramenta: "estresse", sessao: "s-estresse" };
      const sessoes = [{ ferramenta: "estresse", sessao: `ext-${String(i)}`, linhas: [linha] }];
      const completa = [
        { tipo: "criterios_aceite", dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] } },
        {
          tipo: "desenho_solucao",
          dados: desenho,
          arquivos: [{ nome: "desenho.html", mime: "text/html", conteudo: Buffer.from(HTML) }],
        },
        { tipo: "custos_realizados", dados: { sessoes } },
      ];
      for (const e of completa) submeterEvidencia(banco, id, e as never, autor, { agora: em });
    }
    leitura = semearAgente(banco, "sessao", "sessao_em_aberto");
    for (let i = 0; i < CHAMADAS; i++) {
      criar.push(semearAgente(banco, "sessao", "sessao_em_aberto"));
      decidir.push(semearAgente(banco, "revisao", "revisar_rodada"));
    }
  } finally {
    banco.close();
  }

  // Cada ação consome a sua fatia (editar, evidência, enviar) uma vez por chamada.
  const externo = (palavras: string[], orcamento: number, args: (i: number) => string[]): AcaoCli => {
    let i = 0;
    return {
      nome: nomeExterno(palavras),
      orcamento,
      chamar: () => processo(amb.raiz, "", [...palavras, ...args(i++)], pasta),
    };
  };
  const doAgente = (
    palavras: string[],
    orcamento: number,
    agentes: Agente[] | undefined,
    args: (a: Agente) => string[],
  ): AcaoCli => {
    let i = 0;
    return {
      nome: nomeAgente(palavras),
      orcamento,
      chamar() {
        const a = agentes ? (agentes[i++] ?? leitura) : leitura;
        return processo(amb.raiz, a.execucao, [...palavras, ...args(a)], pasta);
      },
    };
  };
  const rascunho = (fatia: number, i: number) => String(rascunhos[fatia * CHAMADAS + i]);
  return [
    externo(["demanda", "registrar"], 2800, () => [
      ...["--projeto", "cli", "--titulo", "Demanda do estresse", "--tipo", "funcionalidade"],
      ...["--descricao", "descricao.md", ...AUTOR],
    ]),
    externo(["demanda", "editar"], 2800, (i) => [rascunho(0, i), "--titulo", "Novo título", ...AUTOR]),
    externo(["demanda", "evidencia"], 2800, (i) => [
      ...[rascunho(1, i), "desenho_solucao", "--dados", "dados.json", "--arquivo", "desenho.html", ...AUTOR],
    ]),
    externo(["demanda", "enviar"], 2800, (i) => [rascunho(2, i), ...AUTOR]),
    externo(["demanda", "ver"], 2800, () => [leitura.demanda, ...AUTOR]),
    externo(["demanda", "schema"], 2800, () => ["desenho_solucao", ...AUTOR]),
    doAgente(["projeto", "ver"], 2800, undefined, () => []),
    doAgente(["demanda", "ver"], 2800, undefined, (a) => [a.demanda]),
    doAgente(["ticket", "ver"], 2800, undefined, (a) => [a.ticket]),
    doAgente(["ticket", "criar"], 2800, criar, (a) => [a.rodada, "--titulo", "Corrigir"]),
    doAgente(["revisao", "decidir"], 2800, decidir, (a) => [
      ...[a.ticket, "reprovar", "--motivo", "falta", "--correcoes", JSON.stringify([{ titulo: "a", descricao: "b" }])],
    ]),
  ];
}

/** Os comandos das duas tabelas que nenhuma ação mede, pelo nome da ação; vazio quando a cobertura está completa. */
export function semMedicaoCli(acoes: readonly AcaoCli[]): string[] {
  const medidas = new Set(acoes.map((a) => a.nome));
  return [
    ...COMANDOS_DEMANDA_EXTERNA.map((c) => nomeExterno(c.palavras)),
    ...COMANDOS_DEMANDA.map((c) => nomeAgente(c.palavras)),
  ].filter((nome) => !medidas.has(nome));
}
