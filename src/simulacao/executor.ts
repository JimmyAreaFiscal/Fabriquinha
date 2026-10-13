// Execução da Simulação (F8 §5): cada execução é um pi em `--mode json` que imita o Usuário Simulado no produto, pela
// extensão `navegador`, e entrega o relatório de usabilidade e bugs em `relatorio.json`. As execuções de uma Tarefa
// rodam uma por vez, em segundo plano.
import { linkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, mensagem } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { LINK_FORA_DO_AR, RelatorioSimulacao } from "../dominio/simulacao.ts";
import { PACOTE, lancarPi } from "../execucao/pi.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { dirDaExecucaoSimulada } from "../persistencia/execucoes.ts";
import { enfileirar, gravarPgid, marcar, paraRodar, type UsuarioSimulado } from "../persistencia/simulacao.ts";
import { ambienteSemCredenciais, executar } from "../processo.ts";

export interface OpcoesDaSimulacao {
  /** Tempo máximo de cada execução, em minutos (o mesmo da execução autônoma, F4 §3). */
  timeoutMin: number;
}

const FERRAMENTAS = "ver_tela,clicar,digitar,tecla,rolar,relatar";
const SEM_RELATORIO = "o agente não entregou o relatório";

/** O produto responde? Qualquer resposta HTTP basta, até 500: a página quebrada é achado do relatório. */
export async function conferirLink(link: string): Promise<boolean> {
  try {
    await fetch(link, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Põe os anexos do usuário na pasta da execução, com o nome original, por hard link: o conteúdo continua só em
 * `arquivos/`. O PDF vira também `<nome>.txt` (`pdftotext`), que é o que o pi lê. Devolve o que vai como `@arquivo`.
 */
async function prepararAnexos(banco: DatabaseSync, usuario: UsuarioSimulado, dir: string): Promise<string[]> {
  const arquivos: string[] = [];
  for (const { nome, sha256 } of usuario.anexos) {
    const destino = join(dir, nome);
    linkSync(caminhoArquivo(banco, sha256), destino);
    if (!nome.toLowerCase().endsWith(".pdf")) {
      arquivos.push(destino);
      continue;
    }
    const { codigo, saida, erro } = await executar("pdftotext", [destino, "-"]);
    if (codigo !== 0) {
      throw new ErroDeRegra(`o pdftotext não leu o anexo ${nome}: ${erro.trim()}`, "confira o PDF do usuário simulado");
    }
    // `wx`: o `.txt` nunca grava por cima de um anexo, que é um hard link do conteúdo guardado.
    await writeFile(`${destino}.txt`, saida, { flag: "wx" });
    arquivos.push(`${destino}.txt`);
  }
  return arquivos;
}

/** O prompt da persona: quem ela é, o que fazer e que o fim é o `relatar`. */
const promptDaPersona = (usuario: UsuarioSimulado, tarefa: string, link: string, comAnexos: boolean): string =>
  [
    `Você é ${usuario.nome}, uma pessoa que usa o produto que está em ${link}.`,
    `Quem você é e o que você sabe: ${usuario.descricao}`,
    ...(comAnexos ? ["Os arquivos anexados são os manuais e materiais que você tem."] : []),
    `Sua tarefa: ${tarefa}`,
    "Use o produto só pela tela (ver_tela, clicar, digitar, tecla, rolar), como essa pessoa usaria, com a familiaridade dela.",
    "Cumpra só a tarefa: não faça ações irreversíveis (apagar, pagar, enviar de verdade) e não saia do produto.",
    "Anote o que atrapalhou o uso (usabilidade) e o que não funcionou (bugs). Termine sempre chamando `relatar` uma vez com as duas listas, vazias se nada atrapalhou.",
  ].join("\n");

/** O `relatorio.json` da execução, ou `undefined` se não existe ou não é um relatório válido. */
async function lerRelatorio(arquivo: string): Promise<RelatorioSimulacao | undefined> {
  try {
    return RelatorioSimulacao.parse(JSON.parse(await readFile(arquivo, "utf8")));
  } catch {
    return undefined;
  }
}

/** Uma execução, do `em_andamento` ao `concluida` ou `falhou`. Erro que sobe daqui o chamador grava como `falhou`. */
async function executarUma(banco: DatabaseSync, id: Id, link: string, timeoutMin: number): Promise<void> {
  const { texto, usuario } = paraRodar(banco, id);
  marcar(banco, id, { status: "em_andamento" });
  if (!(await conferirLink(link))) {
    marcar(banco, id, { status: "falhou", erro: LINK_FORA_DO_AR });
    return;
  }
  const dir = dirDaExecucaoSimulada(raizDo(banco), id);
  const saida = join(dir, "saida");
  await mkdir(saida, { recursive: true });
  const anexos = await prepararAnexos(banco, usuario, dir);
  const pi = lancarPi(
    [
      "--mode",
      "json",
      "--session-dir",
      join(dir, "sessao"),
      "--tools",
      FERRAMENTAS,
      "-e",
      join(PACOTE, "extensions", "navegador.ts"),
      ...anexos.map((arquivo) => `@${arquivo}`),
      promptDaPersona(usuario, texto, link, anexos.length > 0),
    ],
    {
      cwd: dir,
      env: {
        ...ambienteSemCredenciais(process.env, join(dir, "vazio")),
        FABRIQUINHA_LINK: link,
        FABRIQUINHA_SAIDA: saida,
      },
      log: join(dir, "log"),
    },
    () => undefined,
  );
  gravarPgid(banco, id, pi.pgid);
  const limite = { estourou: false };
  const relogio = setTimeout(() => {
    limite.estourou = true;
    void pi.parar();
  }, timeoutMin * 60_000);
  await pi.saiu;
  clearTimeout(relogio);
  if (limite.estourou) {
    marcar(banco, id, { status: "falhou", erro: `passou do limite de ${String(timeoutMin)} min e foi encerrado` });
    return;
  }
  const relatorio = await lerRelatorio(join(saida, "relatorio.json"));
  marcar(banco, id, relatorio ? { status: "concluida", relatorio } : { status: "falhou", erro: SEM_RELATORIO });
}

/**
 * Executa a Tarefa: enfileira N execuções por usuário alocado já, de forma síncrona (sem link do produto ou com
 * execução pendente, lança antes de qualquer coisa), e as roda uma por vez. A promessa resolve no fim da última; falha
 * de uma execução vira o `falhou` dela e as seguintes seguem. Só rejeita se o banco falhar.
 * ponytail: a fila é por Tarefa; duas Tarefas executadas juntas rodam em paralelo. Uma fila global se o Chromium pesar.
 */
export function executarTarefa(banco: DatabaseSync, tarefa: Id, { timeoutMin }: OpcoesDaSimulacao): Promise<void> {
  const { execucoes, link } = enfileirar(banco, tarefa);
  return (async () => {
    for (const id of execucoes) {
      try {
        await executarUma(banco, id, link, timeoutMin);
      } catch (error_) {
        marcar(banco, id, { status: "falhou", erro: mensagem(error_) });
      }
    }
  })();
}
