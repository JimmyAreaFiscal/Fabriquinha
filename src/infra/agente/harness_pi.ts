// O harness pi (F4 §6.1): o binário, a linha de comando e o ambiente de cada modo, o lançamento em modo RPC com o
// framing do stdout e a parada do grupo de processos, a consulta sem ferramentas, a lista de modelos e o arquivo da sessão.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import type { Modelo } from "../../nucleo/configuracao_agente.ts";
import type { ModoTrabalho } from "../../nucleo/trabalho_agentico.ts";
import type { Effort } from "../../nucleo/primitivos.ts";
import { executar, sinalNoGrupo } from "../processo.ts";
import { ambienteSemCredenciais } from "../ambiente/ambiente_sem_credenciais.ts";
import { anotar } from "../registro.ts";
import { PACOTE, type EventoPi } from "./pi.ts";

/** Entre o SIGTERM e o SIGKILL no grupo (F4 §6.7). */
const GRACA_MS = 10_000;

export interface Lancamento {
  raiz: string;
  sessaoPi: string;
  /** As skills de artefato da etapa (P1 §5.1). */
  skills: string[];
  modelo: Modelo | undefined;
  effort?: Effort;
  confianca: boolean | undefined;
  modo: ModoTrabalho;
}

/** A auditoria do Histórico: sem skills, effort nem confiança herdada; o `modelo` é o da Configuração, ou o padrão do pi. */
interface LancamentoDeAuditoria {
  raiz: string;
  sessaoPi: string;
  modelo?: Modelo | null;
  extensoes?: string[];
}

/**
 * Divide o stdout em registros JSONL só em `\n`, tirando um `\r` final (F4 §6.1.2). O `readline` do Node não serve:
 * ele também quebra em U+2028 e U+2029, que são válidos dentro de strings JSON.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function divisorJsonl(): (parte: string) => string[] {
  let resto = "";
  return (parte) => {
    const tudo = resto + parte;
    const fim = tudo.lastIndexOf("\n") + 1;
    resto = tudo.slice(fim);
    return tudo
      .slice(0, fim)
      .split("\n")
      .map((linha) => linha.replace(/\r$/, ""))
      .filter((linha) => linha !== "");
  };
}

/**
 * O objeto JSON da linha, ou `undefined` se ela não é JSON ou não é objeto (`null`, número): um neto que herda o
 * stdout pode escrever qualquer coisa nele, e o ouvinte do `data` não pode lançar.
 */
function objetoJson(linha: string): EventoPi | undefined {
  try {
    const valor: unknown = JSON.parse(linha);
    return typeof valor === "object" && valor !== null ? (valor as EventoPi) : undefined;
  } catch {
    return undefined;
  }
}

interface ProcessoPi {
  /** O grupo de processos do pi (F4 §7). */
  readonly pgid: number;
  /** Um comando RPC, como uma linha JSON no stdin. */
  enviar(comando: object): void;
  /** Resolve com o código de saída quando o pi termina e o stdout fecha, inclusive se ele nem chegou a rodar. */
  readonly saiu: Promise<number | null>;
  /** SIGTERM no grupo, até 10 s para o pi fechar, e SIGKILL no grupo, para não sobrar o que o agente abriu. */
  parar(): Promise<void>;
}

export class HarnessPi {
  /** O binário do pi: `$FABRIQUINHA_PI` ou `pi` do PATH (F4 §10). */
  binarioPi(): string {
    return process.env.FABRIQUINHA_PI || "pi";
  }

  /**
   * F4 §6.1: a configuração do Auditor vale inteira; a Fabriquinha só soma as skills da etapa, a guarda e a `perguntar`,
   * que toma o lugar da `ask_user_question` (quebrada no modo RPC; o pi não inicia com duas ferramentas de mesmo nome).
   * A consulta (F4 §6.5) copia a sessão principal para a sessão nova `sessaoPi` e tira só as ferramentas embutidas de
   * escrita; além das três da spec, o `powershell`, que o pi 0.84.4 também embute e que altera arquivos se houver `pwsh`.
   * A auditoria do Histórico (`LancamentoDeAuditoria`) tira essas mesmas ferramentas e só a guarda, que deixa o
   * `subagent` chamar apenas o `scout`, vai com ela.
   */
  argumentos(l: Lancamento | LancamentoDeAuditoria): string[] {
    const comum = [
      "--mode",
      "rpc",
      "--session-dir",
      join(l.raiz, "sessoes"),
      "--session-id",
      l.sessaoPi,
      ...(l.modelo ? ["--provider", l.modelo.provedor, "--model", l.modelo.nome] : []),
    ];
    const guarda = ["-e", join(PACOTE, "extensions", "guarda.ts")];
    if (!("skills" in l)) {
      return [
        ...comum,
        ...guarda,
        ...(l.extensoes ?? []).flatMap((extensao) => ["-e", join(PACOTE, "extensions", extensao)]),
        "--exclude-tools",
        "edit,write,bash,powershell",
      ];
    }
    return [
      ...comum,
      ...(l.effort ? ["--thinking", l.effort] : []),
      ...l.skills.flatMap((skill) => ["--skill", join(PACOTE, "skills", skill)]),
      ...guarda,
      "-e",
      join(PACOTE, "extensions", "pergunta.ts"),
      ...(l.confianca === undefined ? [] : [l.confianca ? "--approve" : "--no-approve"]),
      "--exclude-tools",
      l.modo === "consulta" ? "ask_user_question,edit,write,bash,powershell" : "ask_user_question",
    ];
  }

  /**
   * F4 §6.1.2: o ambiente do serviço sem credenciais, com `gh` e `az` apontando para um diretório vazio de `dir` (a
   * pasta do processo) e as variáveis da Fabriquinha. Sem `execucao` (a auditoria `<raiz>/avaliacoes/<sessão>`), não
   * há `FABRIQUINHA_EXECUCAO`, porque ela não é de nenhum ticket, e `FABRIQUINHA_AUDITORIA` liga a regra do `scout` na guarda.
   */
  ambiente(raiz: string, dir: string, execucao?: number | string): NodeJS.ProcessEnv {
    const { FABRIQUINHA_EXECUCAO: _herdada, ...semCredenciais } = ambienteSemCredenciais(
      process.env,
      join(dir, "vazio"),
    );
    return execucao === undefined
      ? { ...semCredenciais, FABRIQUINHA_ROOT: raiz, FABRIQUINHA_AUDITORIA: "1" }
      : {
          ...semCredenciais,
          FABRIQUINHA_EXECUCAO: String(execucao),
          FABRIQUINHA_ROOT: raiz,
          FABRIQUINHA_SAIDA: join(dir, "saida"),
        };
  }

  /**
   * Lança o pi num grupo próprio, com o stderr no `log`. Cada linha JSON do stdout vai para `aoEvento`; linha fora do
   * protocolo vai para o log. Com `fecharStdin`, o stdin fecha já: o `--mode json` do pi só começa depois do EOF dele,
   * e o modo RPC precisa do stdin aberto.
   */
  lancar(
    args: readonly string[],
    { cwd, env, log, fecharStdin }: { cwd: string; env: NodeJS.ProcessEnv; log: string; fecharStdin?: boolean },
    aoEvento: (evento: EventoPi) => void,
  ): ProcessoPi {
    const filho = spawn(this.binarioPi(), args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const pgid = Number(filho.pid);
    // Escrever no stdin de um pi que já saiu dá EPIPE; sem ouvinte, o erro derrubaria o serviço.
    const falhou = (erro: Error) => {
      anotar(log, `pi: ${erro.message}`);
    };
    filho.on("error", falhou);
    filho.stdin.on("error", falhou);
    if (fecharStdin) filho.stdin.end();
    filho.stderr.on("data", (parte: Buffer) => {
      appendFileSync(log, parte);
    });
    const dividir = divisorJsonl();
    filho.stdout.setEncoding("utf8").on("data", (parte: string) => {
      for (const linha of dividir(parte)) {
        const evento = objetoJson(linha);
        if (evento) aoEvento(evento);
        else anotar(log, `pi, fora do protocolo: ${linha}`);
      }
    });
    const saiu = new Promise<number | null>((resolve) => filho.on("close", resolve));
    return {
      pgid,
      saiu,
      enviar(comando) {
        filho.stdin.write(JSON.stringify(comando) + "\n");
      },
      async parar() {
        sinalNoGrupo(pgid, "SIGTERM");
        await Promise.race([saiu, dormir(GRACA_MS, undefined, { ref: false })]);
        sinalNoGrupo(pgid, "SIGKILL");
      },
    };
  }

  /**
   * O modo consulta: uma chamada única do pi (`-p`) sem ferramentas, skills, contexto do projeto nem sessão: o modelo
   * só lê o `prompt`. As extensões ficam, porque provedores como o claude-bridge são extensões do pi. Sem `modelo`,
   * vale o padrão do pi. O ambiente é o dos outros modos, sem credenciais de hospedagem nem do Sonar.
   * Devolve o stdout, ou `undefined` se o pi falhou, saiu com código diferente de 0 ou passou de `limiteMs`.
   */
  async perguntar(
    prompt: string,
    modelo: Modelo | undefined,
    limiteMs: number,
    rodar: typeof executar = executar,
  ): Promise<string | undefined> {
    const args = [
      "-p",
      "--no-session",
      "--no-tools",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-mcp",
      ...(modelo ? ["--model", `${modelo.provedor}/${modelo.nome}`] : []),
      prompt,
    ];
    try {
      const env = ambienteSemCredenciais(process.env, join(tmpdir(), "fabriquinha-vazio"));
      const r = await rodar(this.binarioPi(), args, { env, limiteMs });
      return r.codigo === 0 ? r.saida : undefined;
    } catch {
      return undefined;
    }
  }

  /** Os pares da tabela de `pi --list-models [busca]`; a busca do pi é aproximada. */
  private async modelosDoPi(...busca: string[]): Promise<Modelo[]> {
    const lista = await executar(this.binarioPi(), ["--list-models", ...busca]);
    if (lista.codigo !== 0) {
      throw new ErroDeRegra(
        `o pi falhou ao listar os modelos: ${lista.erro.trim()}`,
        "confira o pi rodando pi --list-models",
      );
    }
    // A saída é uma tabela com cabeçalho e colunas separadas por dois ou mais espaços: provedor, modelo, contexto…
    // ponytail: um nome de modelo com dois espaços seguidos não casaria; nenhum provedor usa isso.
    return lista.saida
      .split("\n")
      .slice(1)
      .flatMap((linha) => {
        const [provedor, nome] = linha.trim().split(/\s{2,}/);
        return provedor && nome ? [{ provedor, nome }] : [];
      });
  }

  /** Todos os pares que o pi conhece (F4 §9, F7 §4.2). */
  listarModelos(): Promise<Modelo[]> {
    return this.modelosDoPi();
  }

  /** Recusa o par que `pi --list-models "<provedor>/<nome>"` não lista exatamente. */
  async conferirModelo({ provedor, nome }: Modelo): Promise<void> {
    const par = `${provedor}/${nome}`;
    if (!(await this.modelosDoPi(par)).some((m) => m.provedor === provedor && m.nome === nome)) {
      throw new ErroDeRegra(`o modelo ${par} não existe no pi`, "escolha um par listado por pi --list-models");
    }
  }

  /**
   * O arquivo JSONL que o pi grava em `<raiz>/sessoes/<instante>_<sessaoPi>.jsonl`, ou `undefined` se ainda não existe.
   * Mais de um arquivo para o mesmo ID é erro (F6 §3.1): não há como saber qual é a sessão.
   */
  arquivoDaSessao(raiz: string, sessaoPi: string): string | undefined {
    const dir = join(raiz, "sessoes");
    const achados = existsSync(dir) ? readdirSync(dir).filter((nome) => nome.endsWith(`_${sessaoPi}.jsonl`)) : [];
    if (achados.length > 1) {
      throw new ErroDeRegra(
        `a sessão ${sessaoPi} tem ${String(achados.length)} arquivos em ${dir}: ${achados.join(", ")}`,
        "deixe só o arquivo da sessão e apague as cópias",
      );
    }
    return achados[0] && join(dir, achados[0]);
  }
}
