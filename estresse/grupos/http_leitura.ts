// Grupo do estresse das rotas GET de `ROTAS`: uma ação por rota, sobre os dados que `preparar` semeia uma vez no banco do
// ambiente (leitura não os altera, então a preparação fica fora do tempo medido). O tempo vai do envio do pedido ao fim do
// corpo; nas rotas de SSE, até o primeiro evento. `semMedicao` confere a cobertura contra a tabela do produto.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgregadoDemanda } from "../../src/dominio/agregado_demanda.ts";
import { guardarBytes } from "../../src/persistencia/arquivos.ts";
import { criarAvaliacao } from "../../src/persistencia/avaliacoes.ts";
import { abrir } from "../../src/persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../../src/persistencia/configuracao_projeto.ts";
import { criarDemanda } from "../../src/persistencia/demandas.ts";
import { gravarAnexos } from "../../src/persistencia/evidencia_demanda.ts";
import { registrarProjeto } from "../../src/persistencia/projetos.ts";
import { comSessoesDoTicket } from "../../src/persistencia/sessoes.ts";
import { exigirGit } from "../../src/repositorio/worktree.ts";
import { ROTAS } from "../../src/web/servidor.ts";
import type { Ambiente } from "../ambiente.ts";

/** Uma rota GET medida: `chamar` faz uma chamada e devolve o tempo em ms, ou lança quando o resultado é inesperado. */
export interface AcaoHttp {
  metodo: "GET";
  /** O padrão de `ROTAS`, que é o nome da ação na tabela. */
  caminho: string;
  /** Orçamento de p95 em ms: 3× o p95 medido nesta máquina (Linux, Node 22, SQLite local), para não virar teste instável. */
  orcamento: number;
  chamar(): Promise<number>;
}

const em = "2026-10-11T12:00:00.000Z";
const DEMANDA = "I-1";
const SESSAO = "sd-1";

/** Os ids que os caminhos das ações precisam. */
interface Dados {
  avaliacao: string;
  sha256: string;
}

/** O projeto `loja` com um repositório git de verdade e o remoto num bare local (o heatmap lê `origin/main`) e a configuração do SDLC. */
async function semearProjeto(raiz: string, banco: ReturnType<typeof abrir>): Promise<void> {
  const repo = mkdtempSync(join(raiz, "loja-"));
  const bare = join(raiz, "origin.git");
  const git = (dir: string, ...args: string[]) =>
    exigirGit(dir, "-c", "user.name=Estresse", "-c", "user.email=estresse@exemplo.com", ...args);
  await git(raiz, "init", "-q", "--bare", bare);
  await git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "LEIAME"), "loja\n");
  await git(repo, "add", "LEIAME");
  await git(repo, "commit", "-q", "-m", "início");
  await git(repo, "remote", "add", "origin", bare);
  await git(repo, "push", "-q", "origin", "main");
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    sonar: { projectKey: "loja" },
  });
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
}

/**
 * A I-1 na sessão de ajustes da R1 (ticket 2, com a sessão `sd-1` e a conversa em disco) e com um anexo no desenho; mais
 * uma avaliação com a pasta e o prompt. Devolve os ids que as ações usam.
 */
function semearDemanda(raiz: string, banco: ReturnType<typeof abrir>): Dados {
  const ticket = (ticket_id: number, etapa: string, status: string) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    status,
    status_alterado_em: em,
    rodada_id: 1,
    devolucoes: 0,
  });
  const { sha256, bytes } = guardarBytes(banco, Buffer.from("<h1>Desenho</h1>"));
  criarDemanda(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda do estresse",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: DEMANDA,
      enviada: true,
      branch: `fabriquinha/${DEMANDA}`,
    },
    tickets: [ticket(1, "implementar", "concluido"), ticket(2, "sessao_em_aberto", "em_execucao")],
    decisoes: [],
    evidencias: [
      {
        demanda_id: DEMANDA,
        tipo: "desenho_solucao",
        dados: {
          resumo: "r",
          arquivosPrevistos: [{ caminho: "a.ts", acao: "alterar", motivo: "m" }],
          foraDeEscopo: [],
        },
        em,
      },
    ],
    rodadas: [
      {
        demanda_id: DEMANDA,
        rodada_id: 1,
        titulo: "rodada 1",
        fase: "sessao",
        e2e: false,
        branch: `fabriquinha/${DEMANDA}-1`,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
  } as unknown as AgregadoDemanda);
  gravarAnexos(banco, { demanda_id: DEMANDA, tipo: "desenho_solucao" }, [
    { caminho: "desenho.html", mime: "text/html; charset=utf-8", sha256, bytes },
  ]);

  comSessoesDoTicket(banco, { demanda_id: DEMANDA, ticket_id: 2 }, (e) => ({
    ...e,
    sessoes: [{ demanda_id: DEMANDA, ticket_id: 2, id: SESSAO, modo: "interativo", conversa_referencia: SESSAO }],
    execucoes: [{ id: "ed-1", sessao_id: SESSAO, inicio: em, fim: em, falha: false }],
  }));
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  const mensagem = (role: string, text: string) =>
    JSON.stringify({ type: "message", message: { role, content: [{ type: "text", text }] } });
  writeFileSync(
    join(raiz, "sessoes", `2026-01-01T00-00-00-000Z_${SESSAO}.jsonl`),
    `${mensagem("user", "ajuste")}\n${mensagem("assistant", "feito")}\n`,
  );

  const avaliacao = randomUUID();
  criarAvaliacao(banco, {
    id: avaliacao,
    projeto: "loja",
    de: "2026-01-01",
    ate: "2026-12-31",
    pedido: "",
    criada_em: em,
    demandas: [DEMANDA],
  });
  mkdirSync(join(raiz, "avaliacoes", avaliacao), { recursive: true });
  writeFileSync(join(raiz, "avaliacoes", avaliacao, "prompt.md"), "# Avaliação\n");
  return { avaliacao, sha256 };
}

/** Uma chamada: o tempo até o fim do corpo (ou, no SSE, até o primeiro evento); lança se o status não for 200. */
async function cronometrar(amb: Ambiente, caminho: string, sse: boolean): Promise<number> {
  const inicio = performance.now();
  const r = await fetch(`${amb.base}${caminho}`, { headers: { cookie: amb.cookie } });
  if (r.status !== 200) {
    await r.body?.cancel();
    throw new Error(`GET ${caminho}: HTTP ${String(r.status)}`);
  }
  if (!sse) {
    await r.arrayBuffer();
    return performance.now() - inicio;
  }
  const leitor = r.body?.getReader();
  const primeiro = await leitor?.read();
  const tempo = performance.now() - inicio;
  await leitor?.cancel();
  if (!primeiro || primeiro.done) throw new Error(`GET ${caminho}: o SSE fechou sem evento`);
  return tempo;
}

/** Semeia o ambiente e devolve uma ação por rota GET. O orçamento de cada uma fica ao lado dela. */
export async function acoesHttpLeitura(amb: Ambiente): Promise<AcaoHttp[]> {
  const banco = abrir(amb.raiz);
  let d: Dados;
  try {
    await semearProjeto(amb.raiz, banco);
    d = semearDemanda(amb.raiz, banco);
  } finally {
    banco.close();
  }
  const acao = (caminho: string, url: string, orcamento: number, sse = false): AcaoHttp => ({
    metodo: "GET",
    caminho,
    orcamento,
    chamar: () => cronometrar(amb, url, sse),
  });
  const periodo = "projeto=loja&de=2026-01-01&ate=2026-12-31";
  return [
    acao("/api/inicio", "/api/inicio", 151),
    acao("/api/sessoes", "/api/sessoes?escopo=ativas", 52),
    acao("/api/configuracao", "/api/configuracao", 15),
    acao("/api/projetos", "/api/projetos", 17),
    acao("/api/projetos/:nome", "/api/projetos/loja", 19),
    acao("/api/modelos", "/api/modelos", 437),
    acao("/api/projetos/:nome/configuracao-sdlc", "/api/projetos/loja/configuracao-sdlc", 22),
    acao("/api/demandas", "/api/demandas", 36),
    acao("/api/demandas/:id", `/api/demandas/${DEMANDA}`, 37),
    acao("/api/demandas/:id/anexos/:sha256", `/api/demandas/${DEMANDA}/anexos/${d.sha256}?tipo=desenho_solucao`, 20),
    acao("/api/demandas/rodadas/:ref/ajustes", `/api/demandas/rodadas/${DEMANDA}.R1/ajustes`, 51),
    acao("/api/sessoes/:sessao", `/api/sessoes/${SESSAO}`, 49),
    acao("/api/sessoes/:sessao/eventos", `/api/sessoes/${SESSAO}/eventos`, 54, true),
    acao("/api/sessoes/:sessao/historico.md", `/api/sessoes/${SESSAO}/historico.md`, 51),
    acao("/api/avaliacoes", "/api/avaliacoes", 18),
    acao("/api/avaliacoes/demandas", `/api/avaliacoes/demandas?${periodo}`, 40),
    acao("/api/avaliacoes/:id", `/api/avaliacoes/${d.avaliacao}`, 26),
    acao("/api/avaliacoes/:id/eventos", `/api/avaliacoes/${d.avaliacao}/eventos`, 51, true),
    acao("/api/projetos/:nome/demandas", "/api/projetos/loja/demandas", 41),
    acao("/api/projetos/:nome/heatmap", "/api/projetos/loja/heatmap", 614),
    acao("/api/metricas", "/api/metricas", 77),
    acao("/api/metricas/issues", "/api/metricas/issues", 20),
    acao("/api/projetos/:nome/usuarios-simulados", "/api/projetos/loja/usuarios-simulados", 17),
    acao("/api/projetos/:nome/tarefas", "/api/projetos/loja/tarefas", 20),
  ];
}

/** As rotas GET de `ROTAS` que nenhuma ação mede, como `GET /caminho`; vazio quando a cobertura está completa. */
export function semMedicao(acoes: readonly AcaoHttp[]): string[] {
  const medidas = new Set(acoes.map((a) => a.caminho));
  return ROTAS.filter((r) => r.metodo === "GET" && !medidas.has(r.caminho)).map((r) => `GET ${r.caminho}`);
}
