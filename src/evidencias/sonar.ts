// Coletor do SonarQube (F3 §6): a regra do `sonar_gate.py` da skill `commit` do Auditor, em TypeScript. Analisa a
// worktree da issue e registra `relatorio_sonar`, aprovado só com zero issue aberta nos arquivos alterados.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
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
const URL_NOS_DOIS =
  "SONAR_HOST_URL precisa resolver no host e no contêiner do scanner, e localhost não serve: use host.docker.internal";

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
        `confira se SONAR_HOST_URL aponta para o SonarQube; ${URL_NOS_DOIS}`,
      );
    }
    return lido.data;
  };
}

/**
 * Roda o `sonar-scanner-cli` em Docker e devolve o id da tarefa do Compute Engine. A worktree, o `.git` principal
 * (que o `.git` da worktree aponta) e a pasta de trabalho entram no mesmo caminho absoluto, para o scanner ler o
 * `.gitignore` pelo SCM. `project.settings` aponta para um arquivo vazio: o `sonar-project.properties` da worktree,
 * que o agente pode editar, fica de fora (com `sonar.exclusions=**` ele zeraria a análise e aprovaria o gate); o que
 * vale é a configuração do servidor (F3 §6).
 * ponytail: Docker Desktop só compartilha `$HOME`, e a raiz padrão (`~/fabriquinha`) está nele; a pasta de trabalho
 * fica ao lado da worktree, no mesmo disco compartilhado.
 * ponytail: ao estourar o limite, o SIGKILL leva o `docker run`, não o contêiner, que termina sozinho (`--rm`).
 */
async function escanear(host: string, worktree: string, comum: string, chave: string, limiteMs: number) {
  const trabalho = mkdtempSync(join(dirname(worktree), ".sonar-"));
  try {
    const configuracao = join(trabalho, "vazio.properties");
    writeFileSync(configuracao, "");
    const { uid, gid } = userInfo();
    const r = await executar(
      "docker",
      [
        "run",
        "--rm",
        "--add-host=host.docker.internal:host-gateway",
        "--user",
        `${String(uid)}:${String(gid)}`,
        "-e",
        `SONAR_HOST_URL=${host}`,
        // Sem valor: o docker copia do ambiente, e o token não aparece na lista de processos.
        "-e",
        "SONAR_TOKEN",
        "-v",
        `${worktree}:${worktree}`,
        "-v",
        `${comum}:${comum}`,
        "-v",
        `${trabalho}:${trabalho}`,
        "-w",
        worktree,
        "sonarsource/sonar-scanner-cli",
        `-Dsonar.projectKey=${chave}`,
        `-Dsonar.working.directory=${trabalho}`,
        `-Dproject.settings=${configuracao}`,
      ],
      { limiteMs },
    );
    // ponytail: stdout e depois stderr, só o fim; o log inteiro do scanner não cabe na mensagem do ticket.
    const saida = (r.saida + r.erro).trim().slice(-2000);
    const detalhe = saida ? `: ${saida}` : "";
    const dica = `${URL_NOS_DOIS}; se o SonarQube estiver fora do ar, suba com: ${SUBIR}`;
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

/**
 * Coleta e registra (C17, produtor `fabriquinha`) o `relatorio_sonar` do ticket, com a worktree da issue analisada.
 * Issue antiga num arquivo alterado também barra, como no `sonar_gate.py`. SonarQube fora do ar ou scanner falhando
 * lança ErroDeRegra com o comando para subir o servidor; quem chama falha o ticket com a mensagem.
 */
export async function coletarSonar(
  banco: DatabaseSync,
  ticket: Id,
  { limiteMs = 30 * 60_000, intervaloMs = 2000 }: OpcoesSonar = {},
): Promise<Agregado> {
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
  // Barras do fim fora sem regex: `\/+$` voltaria atrás em tempo quadrático numa sequência longa de `/` no meio.
  let host = process.env.SONAR_HOST_URL || "";
  while (host.endsWith("/")) host = host.slice(0, -1);
  const token = process.env.SONAR_TOKEN || "";
  if (!host || !token) {
    throw new ErroDeRegra(
      "SONAR_HOST_URL e SONAR_TOKEN precisam estar no ambiente da Fabriquinha",
      `defina os dois em <raiz>/ambiente e reinicie o serviço; ${URL_NOS_DOIS}`,
    );
  }
  const api = cliente(host, token);
  const { status } = await api(Status, "system/status");
  if (status !== "UP") throw new ErroDeRegra(`o SonarQube em ${host} está ${status}`, `suba com: ${SUBIR}`);

  // Alterados contra HEAD: versionados (staged ou não) e não versionados fora do .gitignore. `-z`: o caminho cru.
  const raiz = raizDo(banco);
  const worktree = caminhoDaWorktree(raiz, nome, issue);
  const { comum, arquivos } = await naFilaDoProjeto(raiz, nome, async () => {
    const nomes = async (...args: string[]) => (await exigirGit(worktree, ...args)).split("\0").filter(Boolean);
    const versionados = await nomes("diff", "--name-only", "-z", "HEAD");
    const novos = await nomes("ls-files", "--others", "--exclude-standard", "-z");
    return {
      comum: (await exigirGit(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim(),
      arquivos: [...new Set([...versionados, ...novos])].sort((a, b) => a.localeCompare(b)),
    };
  });

  const ceTaskId = await escanear(host, worktree, comum, chave, limiteMs);
  await esperarTarefa(api, host, ceTaskId, limiteMs, intervaloMs);

  // Busca as issues do projeto inteiro e filtra pelos arquivos alterados: pedir por componente falha (HTTP 400)
  // quando o lote mistura arquivos de código e de teste (sonar.tests).
  // ponytail: a API pagina até LIMITE_DA_API issues; projeto com mais que isso precisa filtrar no servidor.
  const alterados = new Set(arquivos.map((arquivo) => `${chave}:${arquivo}`));
  const achados = [];
  for (let p = 1; ; p++) {
    const pagina = await api(Issues, "issues/search", {
      components: chave,
      resolved: "false",
      ps: String(PAGINA),
      p: String(p),
    });
    for (const i of pagina.issues.filter((x) => alterados.has(x.component))) {
      achados.push({
        arquivo: i.component.slice(chave.length + 1),
        ...(i.line !== undefined && { linha: i.line }),
        regra: i.rule,
        severidade: i.severity,
        mensagem: i.message,
      });
    }
    if (p * PAGINA >= Math.min(pagina.paging.total, LIMITE_DA_API)) break;
  }

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
