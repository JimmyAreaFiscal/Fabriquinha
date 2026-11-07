// Cadastro do projeto (C19: registrar, editar e remover; F2 §4 e §6). As conferências externas (F5 §2, F4 §9) rodam
// antes, fora daqui; o armazenamento só lê e grava as linhas.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { formatarTicketRef } from "../../nucleo/demanda.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { Projeto } from "../../nucleo/projeto.ts";
import { caminhoArquivo } from "../../armazenamento/arquivos.ts";
import { escrever, raizDo } from "../../armazenamento/banco.ts";
import { substituirPreparacaoDoProjeto } from "../../armazenamento/configuracao_projeto.ts";
import {
  apagarProjeto,
  atualizarProjeto,
  donoDoRepositorio,
  inserirProjeto,
  projetoExistente,
  tarefaComExecucaoSimuladaPendente,
  ticketEmAndamentoDoProjeto,
} from "../../armazenamento/projetos.ts";
import { dirDaExecucaoSimulada } from "../../infra/registro.ts";
import { removerWorktrees } from "../../infra/repositorio/worktree.ts";

export { projetoExistente, projetos } from "../../armazenamento/projetos.ts";

/** O repositório só pode ser de um projeto. */
function recusarRepositorioDeOutroProjeto(banco: DatabaseSync, p: Projeto): void {
  const dono = donoDoRepositorio(banco, p.repo, p.nome);
  if (dono !== undefined) {
    throw new ErroDeRegra(
      `o repositório ${p.repo} já é do projeto ${dono}`,
      `edite o projeto ${dono} em vez de cadastrar outro para o mesmo repositório`,
    );
  }
}

/** C19: valida o schema do F1 (§3.3) e cadastra um projeto novo, com a preparação da worktree, numa transação. */
export function registrarProjeto(banco: DatabaseSync, entrada: unknown): Projeto {
  const p = Projeto.parse(entrada);
  escrever(banco, () => {
    recusarRepositorioDeOutroProjeto(banco, p);
    if (!inserirProjeto(banco, p)) throw new ErroDeRegra(`já existe o projeto ${p.nome}`, "edite-o na Configuração");
    substituirPreparacaoDoProjeto(banco, p.nome, p.preparacao);
  });
  return p;
}

/**
 * C19: substitui o cadastro de um projeto que já existe; o nome é a chave e não muda. A chave do SonarQube (da
 * configuração SDLC) fica como está.
 */
export function editarProjeto(banco: DatabaseSync, entrada: unknown): Projeto {
  const p = Projeto.parse(entrada);
  escrever(banco, () => {
    recusarRepositorioDeOutroProjeto(banco, p);
    projetoExistente(banco, p.nome, "cadastre-o na Configuração");
    atualizarProjeto(banco, p);
    substituirPreparacaoDoProjeto(banco, p.nome, p.preparacao);
  });
  return p;
}

/** Recusa a remoção enquanto o projeto tem execução, de ticket ou simulada, em andamento. */
function recusarExecucaoEmAndamento(banco: DatabaseSync, nome: string): void {
  const ticketEmAndamento = ticketEmAndamentoDoProjeto(banco, nome);
  if (ticketEmAndamento) {
    throw new ErroDeRegra(
      `o projeto ${nome} tem execução em andamento no ${formatarTicketRef(ticketEmAndamento)}`,
      "espere ela terminar ou pare a sessão, e remova de novo",
    );
  }
  const tarefaPendente = tarefaComExecucaoSimuladaPendente(banco, nome);
  if (tarefaPendente !== undefined) {
    throw new ErroDeRegra(
      `o projeto ${nome} tem execução simulada pendente na Tarefa ${tarefaPendente}`,
      "espere ela terminar, e remova de novo",
    );
  }
}

/**
 * Remove o projeto e tudo o que depende dele, em qualquer estado (I-4): primeiro o banco, numa transação; depois,
 * com o banco já commitado, as pastas de execução, as sessões do pi, os anexos que nenhum outro projeto usa e as
 * worktrees do projeto.
 * Falha no disco vira aviso: o banco não volta atrás.
 * ponytail: janela de corrida. Uma submissão de outro projeto com o mesmo conteúdo copia o anexo fora da transação
 * (F2 §5.2); se ela cair entre a consulta dos órfãos e o `rm`, o arquivo some sob a evidência nova. É rara
 * (mesmo hash, no mesmo instante); se importar, trocar o `rm` por uma conferência no banco imediatamente antes.
 */
export async function removerProjeto(
  banco: DatabaseSync,
  nome: string,
): Promise<{ projeto: Projeto; avisos: string[] }> {
  const { removido, execucoes, sessoes, simuladas, orfaos } = escrever(banco, () => {
    const removido = projetoExistente(banco, nome);
    recusarExecucaoEmAndamento(banco, nome);
    return { removido, ...apagarProjeto(banco, nome) };
  });

  const raiz = raizDo(banco);
  const avisos: string[] = [];
  const apagar = (caminho: string) =>
    rm(caminho, { recursive: true, force: true }).catch((error_: unknown) => {
      avisos.push(`não foi possível apagar ${caminho}: ${(error_ as Error).message}`);
    });

  // `<instante>_<conversa>.jsonl`: o instante não tem `_`, então a conversa é o que vem depois do primeiro.
  const conversas = new Set(sessoes);
  const dirSessoes = join(raiz, "sessoes");
  const arquivosDeSessao = (await readdir(dirSessoes).catch(() => [])).filter(
    (arquivo) => arquivo.endsWith(".jsonl") && conversas.has(arquivo.slice(arquivo.indexOf("_") + 1, -".jsonl".length)),
  );
  await Promise.all([
    // A execução copiada do fluxo legado tem o id `E-<n>`, que já é o nome da pasta dela; as novas, `E-<id>`.
    ...execucoes.map((id) => apagar(join(raiz, "execucoes", id.startsWith("E-") ? id : `E-${id}`))),
    ...simuladas.map((id) => apagar(dirDaExecucaoSimulada(raiz, id))),
    ...arquivosDeSessao.map((arquivo) => apagar(join(dirSessoes, arquivo))),
    ...orfaos.map((sha) => apagar(caminhoArquivo(banco, sha))),
  ]);
  avisos.push(...(await removerWorktrees(raiz, { nome: removido.nome, raiz_git: removido.repo })));
  return { projeto: removido, avisos };
}
