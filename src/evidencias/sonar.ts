// Coletor do SonarQube (F3 §6): a regra do `sonar_gate.py` da skill `commit` do Auditor, em TypeScript. Analisa a
// worktree da issue e registra `relatorio_sonar`, aprovado só com zero issue aberta nos arquivos alterados.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { setTimeout as esperar } from "node:timers/promises";
import { z } from "zod";
import { type Agregado, FABRIQUINHA } from "../dominio/agregado.ts";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { registrarEvidencia } from "../dominio/evidencia.ts";
import type { Id } from "../dominio/primitivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { projeto } from "../persistencia/projetos.ts";
import { executar } from "../processo.ts";
import { caminhoDaWorktree, exigirGit, naFilaDoProjeto } from "../repositorio/worktree.ts";
import { schemaDe } from "./schemas.ts";

// ponytail: o servidor local do Auditor, o mesmo comando do sonar_gate.py; vira configuração se a Fabriquinha
// rodar noutra máquina.
const SUBIR = "docker compose -f ~/Documents/Projetos/SonarQube/docker-compose.yml up -d";
const PAGINA = 500;
/** `api/issues/search` não pagina além disso. */
const LIMITE_DA_API = 10_000;

export interface OpcoesSonar {
  /** Tempo máximo do scanner e, à parte, da espera pelo Compute Engine (F3 §6: 30 minutos). */
  limiteMs?: number;
  /** Intervalo entre as consultas à tarefa do Compute Engine. */
  intervaloMs?: number;
}

const Status = z.object({ status: z.string() });
const Tarefa = z.object({ task: z.object({ status: z.string(), errorMessage: z.string().optional() }) });
const Issues = z.object({
  paging: z.object({ total: z.number() }),
  issues: z.array(
    z.object({
      component: z.string(),
      line: z.number().int().optional(),
      rule: z.string(),
      severity: z.string(),
      message: z.string(),
    }),
  ),
});

type Api = <T>(schema: z.ZodType<T>, caminho: string, params?: Record<string, string>) => Promise<T>;

/** GET em `<host>/api/<caminho>` com o token; servidor inacessível ou resposta de erro viram ErroDeRegra. */
function cliente(host: string, token: string): Api {
  const credencial = Buffer.from(`${token}:`).toString("base64");
  const autorizacao = `Basic ${credencial}`;
  return async (schema, caminho, params = {}) => {
    let resposta: Response;
    try {
      resposta = await fetch(`${host}/api/${caminho}?${new URLSearchParams(params).toString()}`, {
        headers: { Authorization: autorizacao },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error_) {
      throw new ErroDeRegra(`o SonarQube em ${host} está inacessível: ${String(error_)}`, `suba com: ${SUBIR}`);
    }
    if (!resposta.ok) {
      throw new ErroDeRegra(
        `o SonarQube respondeu HTTP ${String(resposta.status)} em api/${caminho}: ${(await resposta.text()).slice(0, 500)}`,
        `confira o SONAR_TOKEN; se o servidor estiver fora do ar, suba com: ${SUBIR}`,
      );
    }
    const lido = schema.safeParse(await resposta.json().catch(() => undefined));
    if (!lido.success) {
      throw new ErroDeRegra(
        `a resposta de ${host}/api/${caminho} não é a esperada do SonarQube`,
        "confira se SONAR_HOST_URL aponta para o SonarQube",
      );
    }
    return lido.data;
  };
}

/**
 * Roda o `sonar-scanner` do PATH na worktree e devolve o id da tarefa do Compute Engine. O scanner roda no host, não
 * em Docker: nenhum contêiner além do servidor, e o processo Java não disputa a memória da VM do Docker Desktop.
 * `project.settings` aponta para um arquivo vazio: o `sonar-project.properties` da worktree, que o agente pode
 * editar, fica de fora (com `sonar.exclusions=**` ele zeraria a análise e aprovaria o gate); o que vale é a
 * configuração do servidor (F3 §6). O host e o token vão pelo ambiente: o token não aparece na lista de processos.
 */
async function escanear(host: string, token: string, worktree: string, chave: string, limiteMs: number) {
  const trabalho = mkdtempSync(join(dirname(worktree), ".sonar-"));
  try {
    const configuracao = join(trabalho, "vazio.properties");
    writeFileSync(configuracao, "");
    const r = await executar(
      "sonar-scanner",
      [`-Dsonar.projectKey=${chave}`, `-Dsonar.working.directory=${trabalho}`, `-Dproject.settings=${configuracao}`],
      { cwd: worktree, env: { ...process.env, SONAR_HOST_URL: host, SONAR_TOKEN: token }, limiteMs },
    );
    // ponytail: stdout e depois stderr, só o fim; o log inteiro do scanner não cabe na mensagem do ticket.
    const saida = (r.saida + r.erro).trim().slice(-2000);
    const detalhe = saida ? `: ${saida}` : "";
    const dica = `se o SonarQube estiver fora do ar, suba com: ${SUBIR}`;
    if (r.codigo !== 0) {
      const motivo = r.limiteEstourado ? "passou do tempo limite" : `saiu com código ${String(r.codigo)}`;
      throw new ErroDeRegra(`o sonar-scanner ${motivo}${detalhe}`, dica);
    }
    const relatorio = join(trabalho, "report-task.txt");
    const ceTaskId = existsSync(relatorio) ? /^ceTaskId=(.+)$/m.exec(readFileSync(relatorio, "utf8"))?.[1] : undefined;
    if (!ceTaskId) {
      throw new ErroDeRegra(
        `o sonar-scanner terminou sem informar a tarefa do Compute Engine, report-task.txt ausente ou sem ceTaskId${detalhe}`,
        dica,
      );
    }
    return ceTaskId;
  } finally {
    rmSync(trabalho, { recursive: true, force: true });
  }
}

/** A análise é processada de forma assíncrona pelo Compute Engine; espera terminar, até `limiteMs`. */
async function esperarTarefa(api: Api, host: string, id: string, limiteMs: number, intervaloMs: number) {
  const prazo = Date.now() + limiteMs;
  for (;;) {
    const { task } = await api(Tarefa, "ce/task", { id });
    if (task.status === "SUCCESS") return;
    const dica = `veja a tarefa ${id} em ${host}/admin/background_tasks e execute o ticket de novo`;
    if (task.status !== "PENDING" && task.status !== "IN_PROGRESS") {
      throw new ErroDeRegra(`o SonarQube não processou a análise: ${task.errorMessage ?? task.status}`, dica);
    }
    if (Date.now() >= prazo) throw new ErroDeRegra("a análise passou do tempo limite na fila do SonarQube", dica);
    await esperar(intervaloMs);
  }
}

/** Alterados contra HEAD: versionados (staged ou não) e não versionados fora do .gitignore. `-z`: o caminho cru. */
export async function arquivosAlterados(worktree: string): Promise<string[]> {
  const nomes = async (...args: string[]) => (await exigirGit(worktree, ...args)).split("\0").filter(Boolean);
  const versionados = await nomes("diff", "--name-only", "-z", "HEAD");
  const novos = await nomes("ls-files", "--others", "--exclude-standard", "-z");
  return [...new Set([...versionados, ...novos])].sort((a, b) => a.localeCompare(b));
}

/**
 * Núcleo sem banco: checa o ambiente e o servidor, lista os arquivos alterados via `listarArquivos`, escaneia a
 * worktree, espera o Compute Engine e devolve as issues abertas nos arquivos alterados. Falhas viram ErroDeRegra.
 */
export async function analisarSonar(
  chave: string,
  worktree: string,
  listarArquivos: () => Promise<string[]>,
  { limiteMs = 30 * 60_000, intervaloMs = 2000 }: OpcoesSonar = {},
) {
  // Barras do fim fora sem regex: `\/+$` voltaria atrás em tempo quadrático numa sequência longa de `/` no meio.
  let host = process.env.SONAR_HOST_URL || "";
  while (host.endsWith("/")) host = host.slice(0, -1);
  const token = process.env.SONAR_TOKEN || "";
  if (!host || !token) {
    throw new ErroDeRegra(
      "SONAR_HOST_URL e SONAR_TOKEN precisam estar no ambiente da Fabriquinha",
      "defina os dois em <raiz>/ambiente e reinicie o serviço",
    );
  }
  const api = cliente(host, token);
  const { status } = await api(Status, "system/status");
  if (status !== "UP") throw new ErroDeRegra(`o SonarQube em ${host} está ${status}`, `suba com: ${SUBIR}`);

  const arquivos = await listarArquivos();
  const ceTaskId = await escanear(host, token, worktree, chave, limiteMs);
  await esperarTarefa(api, host, ceTaskId, limiteMs, intervaloMs);

  // Busca as issues do projeto inteiro e filtra pelos arquivos alterados: pedir por componente falha (HTTP 400)
  // quando o lote mistura arquivos de código e de teste (sonar.tests).
  // ponytail: a API pagina até LIMITE_DA_API issues; projeto com mais que isso precisa filtrar no servidor.
  const alterados = new Set(arquivos.map((arquivo) => `${chave}:${arquivo}`));
  const issues = [];
  for (let p = 1; ; p++) {
    const pagina = await api(Issues, "issues/search", {
      components: chave,
      resolved: "false",
      ps: String(PAGINA),
      p: String(p),
    });
    for (const i of pagina.issues.filter((x) => alterados.has(x.component))) {
      issues.push({
        arquivo: i.component.slice(chave.length + 1),
        ...(i.line !== undefined && { linha: i.line }),
        regra: i.rule,
        severidade: i.severity,
        mensagem: i.message,
      });
    }
    if (p * PAGINA >= Math.min(pagina.paging.total, LIMITE_DA_API)) break;
  }
  return { ceTaskId, arquivos, issues };
}

/**
 * Coleta e registra (C17, produtor `fabriquinha`) o `relatorio_sonar` do ticket, com a worktree da issue analisada.
 * Issue antiga num arquivo alterado também barra, como no `sonar_gate.py`. SonarQube fora do ar ou scanner falhando
 * lança ErroDeRegra com o comando para subir o servidor; quem chama falha o ticket com a mensagem.
 */
export async function coletarSonar(banco: DatabaseSync, ticket: Id, opcoes: OpcoesSonar = {}): Promise<Agregado> {
  const ag = agregadoDoTicket(banco, ticket);
  const config = ag && projeto(banco, ag.issue.projeto);
  if (!ag || !config) {
    throw new ErroDeInexistente(`o ticket T-${String(ticket)} não existe`, "confira o número do ticket");
  }
  const issue = ag.issue.id;
  const {
    nome,
    sonar: { projectKey: chave },
  } = config;
  const raiz = raizDo(banco);
  const worktree = caminhoDaWorktree(raiz, nome, issue);
  const {
    ceTaskId,
    arquivos,
    issues: achados,
  } = await analisarSonar(
    chave,
    worktree,
    () => naFilaDoProjeto(raiz, nome, () => arquivosAlterados(worktree)),
    opcoes,
  );

  const dados = schemaDe("relatorio_sonar").dados.parse({
    projectKey: chave,
    ceTaskId,
    arquivosAnalisados: arquivos,
    issues: achados,
  });
  return comIssue(banco, issue, "registrarEvidencia", FABRIQUINHA, (ag, ctx) =>
    registrarEvidencia(
      ag,
      { ticket, tipo: "relatorio_sonar", aprovada: achados.length === 0, dados, arquivos: [] },
      FABRIQUINHA,
      ctx,
    ),
  );
}
