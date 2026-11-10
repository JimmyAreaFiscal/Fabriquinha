// Grupo do estresse dos comandos do CLI de `COMANDOS_DEMANDA_EXTERNA` e `COMANDOS_DEMANDA`: uma ação por comando, cada
// chamada um processo `fabriquinha` de verdade na raiz temporária. O tempo vai do início do processo à saída dele; a
// preparação (demandas, execuções abertas, arquivos) é semeada toda antes e fica fora do tempo medido. Saída diferente
// de 0, `SQLITE_BUSY` ou `database is locked` contam como erro. `semMedicaoCli` confere a cobertura contra as duas tabelas.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { COMANDOS_DEMANDA } from "../../src/entrega/cli/agente_demanda.ts";
import { COMANDOS_DEMANDA_EXTERNA } from "../../src/entrega/cli/demanda_externa.ts";
import type { AgregadoDemanda } from "../../src/nucleo/agregado_demanda.ts";
import { criarTrabalho, iniciarProcesso } from "../../src/nucleo/trabalho_agentico.ts";
import { registrar, submeterEvidencia } from "../../src/aplicacao/gestao_demandas.ts";
import { abrir, escrever, novoId } from "../../src/armazenamento/banco.ts";
import { criarDemandaNova } from "../../src/armazenamento/demandas.ts";
import { comTrabalhosDoTicket } from "../../src/armazenamento/trabalho_agentico.ts";
import type { Ambiente } from "../instancia_descartavel.ts";
import { CHAMADAS } from "../medir.ts";

/** Um comando do CLI medido: `chamar` roda um processo e devolve o tempo em ms, ou lança quando o resultado é inesperado. */
export interface AcaoCli {
  /** `fabriquinha <palavras>`, com ` (agente)` nos comandos de `COMANDOS_DEMANDA`: é o nome da ação na tabela. */
  nome: string;
  /** Orçamento de p95 em ms: 3× o p95 medido nesta máquina (Linux, Node 22, SQLite local), para não virar teste instável. */
  orcamento: number;
  chamar(): Promise<number>;
}

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
    [
      "--disable-warning=ExperimentalWarning",
      join(import.meta.dirname, "../../src/composicao/fabriquinha.ts"),
      ...args,
    ],
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

/** A demanda em execução com a rodada R1 em `estadoDaRodada` e o ticket 2 de `etapa`, e uma execução aberta só dele. */
function semearAgente(banco: DatabaseSync, estadoDaRodada: string, etapa: string): Agente {
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
          estado: "em_execucao",
          estado_alterado_em: em,
          criada_por: { tipo: "externo", ferramenta: "estresse", sessao: "s-estresse" },
          enviada: true,
          branch: `fabriquinha/${id}`,
        },
        rodadas: [
          {
            demanda_id: id,
            rodada_id: 1,
            titulo: "r1",
            estado: estadoDaRodada,
            estado_alterado_em: "2026-01-01T00:00:00.000Z",
            e2e: false,
            branch: `fabriquinha/${id}-1`,
          },
        ],
        dependencias_rodada: [],
        criterios_citados: [],
        tickets: [
          {
            demanda_id: id,
            ticket_id: 1,
            etapa: "implementar",
            estado: "concluido",
            estado_alterado_em: em,
            criado_por: { tipo: "fabriquinha" },
            rodada_id: 1,
          },
          {
            demanda_id: id,
            ticket_id: 2,
            etapa,
            estado: "aberto",
            estado_alterado_em: em,
            criado_por: { tipo: "fabriquinha" },
            rodada_id: 1,
          },
        ],
        dependencias_ticket: [],
        caminhos_ticket: [],
        arquivos_previstos_rodada: [],
        arquivos_previstos_demanda: [],
        versoes_plano: [],
        pull_requests: [],
        tentativas: [],
        decisoes: [],
        evidencias: [],
      }) as unknown as AgregadoDemanda,
  ).demanda.id;
  const execucao = `ex-${demanda}`;
  comTrabalhosDoTicket(banco, { demanda_id: demanda, ticket_id: 2 }, (e) => {
    const sessoes = criarTrabalho(e.sessoes, {
      id: `s-${execucao}`,
      demanda_id: demanda,
      ticket_id: 2,
      modo: "autonomo",
      conversa_referencia: `s-${execucao}`,
    });
    return {
      ...e,
      sessoes,
      execucoes: iniciarProcesso(sessoes, e.execucoes, {
        id: execucao,
        trabalho_id: `s-${execucao}`,
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
  const linhaDeUso = {
    provedor: "a",
    modelo: "m",
    tokens_entrada: 1,
    tokens_saida: 1,
    tokens_cache_leitura: 0,
    tokens_cache_escrita: 0,
  };
  writeFileSync(
    join(pasta, "custos.json"),
    JSON.stringify({ sessoes: [{ ferramenta: "estresse", sessao: "s-estresse", linhas: [linhaDeUso] }] }),
  );
  const origens = { worktree: pasta, saida: pasta, fora: "da pasta do estresse", copie: "a pasta do estresse" };

  // Um rascunho por chamada nos comandos que gravam na demanda; uma execução própria por chamada nos do agente que gravam.
  const rascunhos: string[] = [];
  const criar: Agente[] = [];
  const decidir: Agente[] = [];
  let leitura: Agente;
  const banco = abrir(amb.raiz);
  try {
    banco
      .prepare(
        "INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('cli', ?, 'main', 'github', 'cli')",
      )
      .run(amb.raiz);
    // O grupo HTTP semeia demandas com id escolhido (I-1001 em diante), fora da sequência: avança-a além do maior número.
    const maiorNumero = Number(banco.prepare("SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) AS n FROM demanda").get()?.n);
    escrever(banco, () => {
      while (novoId(banco, "demanda") <= maiorNumero);
    });
    for (let i = 0; i < CHAMADAS * 3; i++) {
      const entrada = { projeto: "cli", titulo: "Demanda do estresse", tipo: "funcionalidade", descricao: "d" };
      const autor = { tipo: "externo", ferramenta: "estresse", sessao: "s-estresse" } as const;
      rascunhos.push(registrar(banco, entrada, autor, { agora: em }).demanda.id);
    }
    // `enviar` exige as duas evidências de quem registra; o rascunho de cada chamada nasce com elas.
    for (const id of rascunhos.slice(2 * CHAMADAS)) {
      const autor = { tipo: "externo", ferramenta: "estresse", sessao: "s-estresse" } as const;
      const completa = [
        { tipo: "criterios_aceite", dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] } },
        {
          tipo: "desenho_solucao",
          dados: desenho,
          arquivos: [join(pasta, "desenho.html")],
        },
      ];
      for (const e of completa) submeterEvidencia(banco, id, e as never, autor, origens);
    }
    leitura = semearAgente(banco, "ajustar_resultado", "ajustar_resultado");
    for (let i = 0; i < CHAMADAS; i++) {
      criar.push(semearAgente(banco, "ajustar_resultado", "ajustar_resultado"));
      decidir.push(semearAgente(banco, "revisar_rodada", "revisar_rodada"));
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
    externo(["demanda", "uso"], 2800, (i) => [rascunho(0, i), "--dados", "custos.json", ...AUTOR]),
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
