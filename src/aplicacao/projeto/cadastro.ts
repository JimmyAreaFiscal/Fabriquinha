// Cadastro do projeto (C19: registrar, editar e remover; F2 §4 e §6). `registrarProjeto` e `editarProjeto` só validam e
// gravam; as conferências externas (F5 §2, F4 §9) são de `cadastrarProjetoDoFormulario` e `editarProjetoDoFormulario`.
import { readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { formatarTicketRef } from "../../nucleo/demanda.ts";
import { ErroDeRegra, ErroExterno, mensagem } from "../../nucleo/erros.ts";
import { EtapaTicket } from "../../nucleo/primitivos.ts";
import { type Hospedagem, Projeto } from "../../nucleo/projeto.ts";
import { caminhoArquivo } from "../../armazenamento/arquivos.ts";
import { escrever, raizDo } from "../../armazenamento/banco.ts";
import {
  apagarProjeto,
  buscarProjeto,
  donoDoRepositorio,
  gravarProjeto,
  projetoExistente,
  tarefaComExecucaoSimuladaPendente,
  ticketEmAndamentoDoProjeto,
} from "../../armazenamento/projetos.ts";
import { HarnessPi } from "../../infra/agente/harness_pi.ts";
import { dirDaExecucaoSimulada, noLog } from "../../infra/registro.ts";
import { conferirProjeto } from "../../infra/repositorio/cadastro.ts";
import { removerWorktrees } from "../../infra/repositorio/worktree.ts";
import {
  type ConfiguracoesDasEtapas,
  configuracoesDasEtapas,
  etapasComModeloOuEffort,
  parDoModelo,
  projetoComConfiguracoesDasEtapas,
} from "../configuracao/configuracao_do_ambiente.ts";
import { varrerCommitsHumanos } from "../metricas/varrer_commits_humanos.ts";

export { buscarProjeto, listarProjetos, projetoExistente } from "../../armazenamento/projetos.ts";

/** O repositório só pode ser de um projeto. */
function recusarRepositorioDeOutroProjeto(banco: DatabaseSync, p: Projeto): void {
  const dono = donoDoRepositorio(banco, p.raiz_git, p.nome);
  if (dono !== undefined) {
    throw new ErroDeRegra(
      `o repositório ${p.raiz_git} já é do projeto ${dono}`,
      `edite o projeto ${dono} em vez de cadastrar outro para o mesmo repositório`,
    );
  }
}

/** C19: valida o schema do F1 (§3.3) e cadastra um projeto novo, com a preparação da worktree, numa transação. */
export function registrarProjeto(banco: DatabaseSync, entrada: unknown): Projeto {
  const p = Projeto.parse(entrada);
  escrever(banco, () => {
    recusarRepositorioDeOutroProjeto(banco, p);
    if (buscarProjeto(banco, p.nome) !== undefined)
      throw new ErroDeRegra(`já existe o projeto ${p.nome}`, "edite-o na Configuração");
    gravarProjeto(banco, p);
  });
  return p;
}

/**
 * C19: substitui o cadastro de um projeto que já existe, com as etapas e a preparação da worktree; o nome é a chave e não
 * muda. A chave do SonarQube e o resto das Verificações (da configuração SDLC) ficam como estão.
 */
/** @testes a produção edita pelo formulário (`editarProjetoDoFormulario`); os testes exercitam o caso de uso direto */
export function editarProjeto(banco: DatabaseSync, entrada: unknown): Projeto {
  const p = Projeto.parse(entrada);
  return escrever(banco, () => {
    recusarRepositorioDeOutroProjeto(banco, p);
    const { chave_sonarqube, verificacoes } = projetoExistente(banco, p.nome, "cadastre-o na Configuração");
    const editado = {
      ...p,
      chave_sonarqube,
      verificacoes: { ...verificacoes, preparacao: p.verificacoes.preparacao },
    };
    gravarProjeto(banco, editado);
    return editado;
  });
}

/**
 * Grava a configuração SDLC do projeto que existe (a chave do SonarQube e as Verificações, menos a preparação); as
 * etapas, a preparação e o link do produto ficam como o cadastro os deixou.
 */
export function gravarConfiguracaoSdlc(banco: DatabaseSync, configurado: Projeto): Projeto {
  return escrever(banco, () => {
    const { etapas, link_produto, verificacoes } = projetoExistente(
      banco,
      configurado.nome,
      "cadastre o projeto antes",
    );
    const gravado = {
      ...configurado,
      etapas,
      link_produto,
      verificacoes: { ...configurado.verificacoes, preparacao: verificacoes.preparacao },
    };
    gravarProjeto(banco, gravado);
    return gravado;
  });
}

/** O projeto como o formulário o manda: a hospedagem, que ele só mostra, é ignorada; o F5 a deduz do remoto. */
type ProjetoDoFormulario = Pick<Projeto, "nome" | "raiz_git" | "branch_base" | "link_produto"> & {
  hospedagem?: Hospedagem;
  preparacao: Projeto["verificacoes"]["preparacao"];
  configuracoes: ConfiguracoesDasEtapas;
};

/**
 * F4 §9: o modelo novo ou trocado precisa existir no pi; o rejeitado vira erro do campo (ZodError). O igual ao gravado
 * não chama o pi: o que ele deixou de listar continua salvando sem mexer.
 */
async function conferirModelosAlterados(banco: DatabaseSync, nome: string, configuracoes: ConfiguracoesDasEtapas) {
  const gravadas = configuracoesDasEtapas(buscarProjeto(banco, nome)?.etapas ?? []);
  const alterados = EtapaTicket.options.flatMap((etapa) => {
    const modelo = configuracoes[etapa]?.modelo;
    return modelo && parDoModelo(modelo) !== parDoModelo(gravadas[etapa]?.modelo) ? [{ etapa, modelo }] : [];
  });
  const rejeitados = (
    await Promise.all(
      alterados.map(({ etapa, modelo }) =>
        new HarnessPi().conferirModelo(modelo).then(
          () => [],
          (error_: unknown) => [
            {
              code: "custom" as const,
              path: ["configuracoes", etapa, "modelo"],
              message: mensagem(error_),
              input: modelo,
            },
          ],
        ),
      ),
    )
  ).flat();
  if (rejeitados.length > 0) throw new z.ZodError(rejeitados);
}

/**
 * C19 pelo formulário: confere o repositório (F5 §2; a falha é externa, ErroExterno, e nada é gravado) e os modelos, e
 * grava o cadastro e as etapas numa transação só.
 */
async function conferirEGravar(banco: DatabaseSync, formulario: ProjetoDoFormulario, gravar: typeof registrarProjeto) {
  const { configuracoes, preparacao, ...cadastro } = formulario;
  const { hospedagem } = await conferirProjeto(cadastro).catch((error_: unknown) => {
    throw new ErroExterno(mensagem(error_));
  });
  await conferirModelosAlterados(banco, formulario.nome, configuracoes);
  return escrever(banco, () => {
    // A chave do SonarQube é da configuração SDLC, que a edita; o cadastro começa com o nome do projeto.
    const salvo = gravar(banco, {
      ...cadastro,
      hospedagem,
      chave_sonarqube: formulario.nome,
      etapas: etapasComModeloOuEffort(configuracoes),
      verificacoes: { preparacao },
    });
    return projetoComConfiguracoesDasEtapas(salvo);
  });
}

/**
 * O cadastro e só ele fixa o cursor inicial da base (F6 §4.4); a edição não varre. A varredura que falha só vai para o
 * log: o agendador a refaz no dia seguinte.
 */
export async function cadastrarProjetoDoFormulario(banco: DatabaseSync, formulario: ProjetoDoFormulario) {
  const salvo = await conferirEGravar(banco, formulario, registrarProjeto);
  await varrerCommitsHumanos(banco, salvo.nome).catch(noLog);
  return salvo;
}

/** Edita o projeto que já existe com as mesmas conferências do cadastro, sem varrer a base. */
export const editarProjetoDoFormulario = (banco: DatabaseSync, formulario: ProjetoDoFormulario) =>
  conferirEGravar(banco, formulario, editarProjeto);

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
  // A pasta de um processo em container é um symlink para a pasta de dentro do container: apaga as duas.
  const apagar = async (caminho: string) => {
    const deVerdade = await realpath(caminho).catch(() => caminho);
    await Promise.all(
      [...new Set([deVerdade, caminho])].map((alvo) =>
        rm(alvo, { recursive: true, force: true }).catch((error_: unknown) => {
          avisos.push(`não foi possível apagar ${alvo}: ${(error_ as Error).message}`);
        }),
      ),
    );
  };

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
    ...sessoes.map((conversa) => apagar(join(dirSessoes, conversa))), // a pasta própria da sessão
    ...orfaos.map((sha) => apagar(caminhoArquivo(banco, sha))),
  ]);
  avisos.push(...(await removerWorktrees(raiz, removido)));
  return { projeto: removido, avisos };
}
