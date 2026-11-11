// O harness pi (F4 §6.1): o binário, a linha de comando e o ambiente de cada modo, o lançamento em modo RPC com o
// framing do stdout e a parada do grupo de processos, a consulta sem ferramentas, a lista de modelos e o arquivo da sessão.
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import type { Modelo } from "../../compartilhado/nucleo/primitivos.ts";
import type { LinhaDeUso } from "../../custos/nucleo/uso.ts";
import { ambienteSemCredenciais, type Ambiente, chavesDeProvedorDoLlm } from "../../sandbox/infra/ambiente.ts";
import { executar } from "../../compartilhado/infra/processo.ts";
import { anotar } from "../../compartilhado/infra/registro.ts";
import { lerUsoDoPi } from "./leitor_de_uso_pi.ts";
import type {
  EventoDoAgente,
  Harness,
  Lancamento,
  LancamentoDeAuditoria,
  LancamentoDoTicket,
  ProcessoDoAgente,
  RespostaDaConsulta,
} from "../harness.ts";
import { confianca, PACOTE } from "./pi.ts";

/** Entre o SIGTERM e o SIGKILL no grupo (F4 §6.7). */
const GRACA_MS = 10_000;

/** As ferramentas da extensão `navegador`, as únicas da execução simulada. */
const FERRAMENTAS_DA_SIMULACAO = "ver_tela,clicar,digitar,tecla,rolar,relatar";

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
function objetoJson(linha: string): EventoDoAgente | undefined {
  try {
    const valor: unknown = JSON.parse(linha);
    return typeof valor === "object" && valor !== null ? (valor as EventoDoAgente) : undefined;
  } catch {
    return undefined;
  }
}

/** O Uso de todos os arquivos do diretório de sessão (o pi só grava os `.jsonl` dela), sem janela: a consulta é um Trabalho só. */
function usoDaSessaoEm(dir: string): LinhaDeUso[] {
  return readdirSync(dir).flatMap((nome) => lerUsoDoPi(readFileSync(join(dir, nome), "utf8"), 0, Infinity));
}

/** Os arquivos `<instante>_<sessaoPi>.jsonl` de `dir`; `dir` sem a pasta não tem nenhum. */
const arquivosDaSessaoEm = (dir: string, sessaoPi: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((nome) => nome.endsWith(`_${sessaoPi}.jsonl`)) : [];

/** Como a consulta roda o pi: `executar` do host; os testes trocam. */
type RodarComando = typeof executar;

/** A linha de comando do ticket, com as skills que o pacote tem e a confiança do `trust.json` já resolvidas. */
interface LinhaDeComandoDoTicket extends Pick<LancamentoDoTicket, "raiz" | "sessao" | "modelo" | "effort" | "modo"> {
  skills: readonly string[];
  confianca: boolean | undefined;
}

type LinhaDeComandoDaAuditoria = Omit<LancamentoDeAuditoria, "tipo" | "dir">;

/** As skills que existem em `pacote-pi/skills`: o pi ignora em silêncio um `--skill` que não existe (CA-12). */
const skillsDoPacote = (skills: readonly string[]): string[] =>
  skills.filter((skill) => existsSync(join(PACOTE, "skills", skill)));

export class HarnessPi implements Harness {
  readonly #rodarComando: RodarComando;

  constructor(rodarComando: RodarComando = executar) {
    this.#rodarComando = rodarComando;
  }

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
  argumentos(l: LinhaDeComandoDoTicket | LinhaDeComandoDaAuditoria): string[] {
    const comum = [
      "--mode",
      "rpc",
      "--session-dir",
      this.pastaDaSessao(l.raiz, l.sessao),
      "--session-id",
      l.sessao,
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
   * A linha de comando do `lancamento`. A simulação (F8 §5) é o pi em `--mode json`, só com as ferramentas do
   * `navegador`, a sessão em `<dir>/sessao`, os anexos como `@arquivo` e o prompt por último.
   */
  argumentosDoLancamento(lancamento: Lancamento): string[] {
    switch (lancamento.tipo) {
      case "ticket":
        return this.argumentos({
          ...lancamento,
          skills: skillsDoPacote(lancamento.skills),
          confianca: confianca(lancamento.repositorio),
        });
      case "auditoria":
        return this.argumentos(lancamento);
      case "simulacao":
        return [
          "--mode",
          "json",
          "--session-dir",
          join(lancamento.dir, "sessao"),
          "--tools",
          FERRAMENTAS_DA_SIMULACAO,
          "-e",
          join(PACOTE, "extensions", "navegador.ts"),
          ...lancamento.anexos.map((arquivo) => `@${arquivo}`),
          lancamento.prompt,
        ];
    }
  }

  /**
   * F4 §6.1.2: o ambiente do serviço sem credenciais, com `gh` e `az` apontando para um diretório vazio de `dir` (a
   * pasta do processo) e as variáveis da Fabriquinha. O agente de um ticket fala com a API pelo cliente
   * empacotado, que vai à frente no PATH, e não recebe `FABRIQUINHA_ROOT` nem `FABRIQUINHA_EXECUCAO`: o condutor soma
   * `FABRIQUINHA_API` e `FABRIQUINHA_TOKEN`. A auditoria (`<raiz>/avaliacoes/<sessão>`), que não é de
   * nenhum ticket, o `FABRIQUINHA_ROOT` fica e `FABRIQUINHA_AUDITORIA` liga a regra do `scout` na guarda.
   * No Ambiente que isola as variáveis do serviço o env começa vazio, sem `process.env`: só as chaves de provedor do
   * LLM e as variáveis da Fabriquinha; o `PATH` (com `pacote-pi/bin` à frente) e o `PI_CODING_AGENT_DIR` vêm do próprio
   * Ambiente.
   */
  variaveisDeAmbiente(
    raiz: string,
    dir: string,
    agente: "ticket" | "auditoria",
    ambiente?: Pick<Ambiente, "isolaAsVariaveisDoServico">,
  ): NodeJS.ProcessEnv {
    if (ambiente?.isolaAsVariaveisDoServico) {
      return {
        ...chavesDeProvedorDoLlm(process.env),
        ...(agente === "auditoria"
          ? { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_AUDITORIA: "1" }
          : { FABRIQUINHA_SAIDA: join(dir, "saida") }),
      };
    }
    const {
      FABRIQUINHA_EXECUCAO: _execucaoHerdada,
      FABRIQUINHA_ROOT: _raizHerdada,
      ...semCredenciais
    } = ambienteSemCredenciais(process.env, join(dir, "vazio"));
    return agente === "auditoria"
      ? { ...semCredenciais, FABRIQUINHA_ROOT: raiz, FABRIQUINHA_AUDITORIA: "1" }
      : {
          ...semCredenciais,
          PATH: [join(PACOTE, "bin"), semCredenciais.PATH].filter(Boolean).join(delimiter),
          FABRIQUINHA_SAIDA: join(dir, "saida"),
        };
  }

  /**
   * As variáveis do `lancamento` no `ambiente`. A auditoria roda sempre no Ambiente do serviço, com as do
   * host; a simulação (F8 §5) recebe o produto em `FABRIQUINHA_LINK` e a pasta do relatório em `FABRIQUINHA_SAIDA`.
   */
  variaveisDoLancamento(
    lancamento: Lancamento,
    ambiente: Pick<Ambiente, "isolaAsVariaveisDoServico">,
  ): NodeJS.ProcessEnv {
    switch (lancamento.tipo) {
      case "ticket":
        return this.variaveisDeAmbiente(lancamento.raiz, lancamento.dir, "ticket", ambiente);
      case "auditoria":
        return this.variaveisDeAmbiente(lancamento.raiz, lancamento.dir, "auditoria");
      case "simulacao":
        return {
          ...ambienteSemCredenciais(process.env, join(lancamento.dir, "vazio")),
          FABRIQUINHA_LINK: lancamento.link,
          FABRIQUINHA_SAIDA: join(lancamento.dir, "saida"),
        };
    }
  }

  /**
   * Lança o agente do `lancamento`: a linha de comando vai para o `log` (a da simulação não, que traz o prompt inteiro),
   * e o stdin da simulação fecha já, porque ela lê o prompt dos argumentos.
   */
  lancar(
    ambiente: Ambiente,
    lancamento: Lancamento,
    { cwd, log, variaveisDoServico }: { cwd: string; log: string; variaveisDoServico?: Record<string, string> },
    aoEvento: (evento: EventoDoAgente) => void,
  ): ProcessoDoAgente {
    const args = this.argumentosDoLancamento(lancamento);
    const simulacao = lancamento.tipo === "simulacao";
    if (!simulacao) anotar(log, `pi ${args.join(" ")}`);
    const env = { ...this.variaveisDoLancamento(lancamento, ambiente), ...variaveisDoServico };
    return this.lancarProcesso(ambiente, args, { cwd, env, log, fecharStdin: simulacao }, aoEvento);
  }

  /**
   * Lança o pi, pelo `ambiente`, num grupo próprio, com o stderr no `log`. Cada linha JSON do stdout vai para `aoEvento`; linha fora do
   * protocolo vai para o log. Com `fecharStdin`, o stdin fecha já: o `--mode json` do pi só começa depois do EOF dele,
   * e o modo RPC precisa do stdin aberto.
   */
  lancarProcesso(
    ambiente: Ambiente,
    args: readonly string[],
    { cwd, env, log, fecharStdin }: { cwd: string; env: NodeJS.ProcessEnv; log: string; fecharStdin?: boolean },
    aoEvento: (evento: EventoDoAgente) => void,
  ): ProcessoDoAgente {
    const processo = ambiente.lancar({
      programa: this.binarioPi(),
      argumentos: [...args],
      cwd: ambiente.caminhoNoAmbiente(cwd),
      env: Object.fromEntries(
        Object.entries(env).flatMap(([nome, valor]) => (valor === undefined ? [] : [[nome, valor]])),
      ),
    });
    const { identificador } = processo;
    // Escrever no stdin de um pi que já saiu dá EPIPE; sem ouvinte, o erro derrubaria o serviço.
    processo.aoFalhar((erro) => {
      anotar(log, `pi: ${erro.message}`);
    });
    if (fecharStdin) processo.stdin.end();
    processo.stderr.on("data", (parte: Buffer) => {
      appendFileSync(log, parte);
    });
    const dividir = divisorJsonl();
    processo.stdout.setEncoding("utf8").on("data", (parte: string) => {
      for (const linha of dividir(parte)) {
        const evento = objetoJson(linha);
        if (evento) aoEvento(evento);
        else anotar(log, `pi, fora do protocolo: ${linha}`);
      }
    });
    const { saiu } = processo;
    return {
      identificador,
      saiu,
      enviar(comando) {
        processo.stdin.write(JSON.stringify(comando) + "\n");
      },
      async parar() {
        await ambiente.sinalizar(identificador, "SIGTERM");
        await Promise.race([saiu, dormir(GRACA_MS, undefined, { ref: false })]);
        await ambiente.sinalizar(identificador, "SIGKILL");
      },
    };
  }

  /**
   * O modo consulta: uma chamada única do pi (`-p`) sem ferramentas, skills nem contexto do projeto: o modelo só lê o
   * `prompt`. A sessão do pi vai para um diretório temporário, apagado ao fim, só para o Uso ser lido por `lerUsoDoPi`. As extensões ficam, porque provedores como o claude-bridge são extensões do pi. Sem `modelo`,
   * vale o padrão do pi. O ambiente é o dos outros modos, sem credenciais de hospedagem nem do Sonar.
   * Devolve o stdout e o Uso, ou `undefined` se o pi falhou, saiu com código diferente de 0 ou passou de `limiteMs`.
   */
  async perguntar(
    prompt: string,
    modelo: Modelo | undefined,
    limiteMs: number,
  ): Promise<RespostaDaConsulta | undefined> {
    const dirDaSessao = mkdtempSync(join(tmpdir(), "fabriquinha-consulta-"));
    const args = [
      "-p",
      "--session-dir",
      dirDaSessao,
      "--no-tools",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-mcp",
      ...(modelo ? ["--model", `${modelo.provedor}/${modelo.nome}`] : []),
      prompt,
    ];
    let resposta: RespostaDaConsulta | undefined;
    try {
      const env = ambienteSemCredenciais(process.env, join(tmpdir(), "fabriquinha-vazio"));
      const r = await this.#rodarComando(this.binarioPi(), args, { env, limiteMs });
      if (r.codigo === 0) resposta = { saida: r.saida, uso: usoDaSessaoEm(dirDaSessao) };
    } catch {
      resposta = undefined;
    }
    rmSync(dirDaSessao, { recursive: true, force: true });
    return resposta;
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
   * A pasta onde o pi grava a sessão: `<raiz>/sessoes/<sessaoPi>`, uma por sessão, porque o container do Espaço monta
   * só a da sessão dele. A sessão que nasceu antes disso, solta em `<raiz>/sessoes`, continua lá.
   */
  pastaDaSessao(raiz: string, sessaoPi: string): string {
    const dirPlano = join(raiz, "sessoes");
    return arquivosDaSessaoEm(dirPlano, sessaoPi).length > 0 ? dirPlano : join(dirPlano, sessaoPi);
  }

  /**
   * O arquivo JSONL que o pi grava em `<raiz>/sessoes/<sessaoPi>/<instante>_<sessaoPi>.jsonl` (ou, nas sessões antigas,
   * direto em `<raiz>/sessoes`), ou `undefined` se ainda não existe. Mais de um arquivo para o mesmo ID é erro (F6 §3.1):
   * não há como saber qual é a sessão.
   */
  arquivoDaSessao(raiz: string, sessaoPi: string): string | undefined {
    const achados = [join(raiz, "sessoes"), join(raiz, "sessoes", sessaoPi)].flatMap((dir) =>
      arquivosDaSessaoEm(dir, sessaoPi).map((nome) => join(dir, nome)),
    );
    if (achados.length > 1) {
      throw new ErroDeRegra(
        `a sessão ${sessaoPi} tem ${String(achados.length)} arquivos: ${achados.join(", ")}`,
        "deixe só o arquivo da sessão e apague as cópias",
      );
    }
    return achados[0];
  }

  /** F6 §3: o Uso do JSONL da sessão na janela `[inicio, fim]`. */
  lerUsoDaSessao(raiz: string, sessao: string, inicio: number, fim: number): LinhaDeUso[] {
    const arquivo = this.arquivoDaSessao(raiz, sessao);
    return arquivo ? lerUsoDoPi(readFileSync(arquivo, "utf8"), inicio, fim) : [];
  }
}
