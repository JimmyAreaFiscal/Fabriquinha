// Simulação (F7 §4.4, F8) como funções puras: as abas por projeto, o aviso de link, o formulário de nova Tarefa, os
// cartões das Tarefas com os Usuários Simulados alocados, as execuções e o relatório. O DOM e a rede ficam em
// simulacao-montar.ts.
import type { Id } from "../../../dominio/primitivos.ts";
import type { RelatorioSimulacao, StatusExecucaoSimulada } from "../../../dominio/simulacao.ts";
import type { ExecucaoSimulada, Tarefa, UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import { escapar } from "../render.ts";
import { type Erros, idDe, marca, type ProjetoListado } from "./configuracao.ts";

export const caminhoDaSimulacao = (nome: string): string => `/simulation/${encodeURIComponent(nome)}`;

export const SEM_PROJETOS_DA_SIMULACAO =
  '<div class="cabeca-pagina"><h1>Simulação</h1></div><p class="muted">Nenhum projeto cadastrado ainda. <a class="link" href="/config?novo">Cadastrar um projeto na Configuração</a></p>';

/** O que está nos campos do formulário de nova Tarefa; `n` fica como o Auditor digitou. */
export interface Rascunho {
  texto: string;
  n: string;
  usuarios: readonly Id[];
}

export const RASCUNHO_VAZIO: Rascunho = { texto: "", n: "1", usuarios: [] };

export interface DadosDaSimulacao {
  projetos: readonly ProjetoListado[];
  projeto: ProjetoListado;
  usuarios: readonly UsuarioSimulado[];
  tarefas: readonly Tarefa[];
  rascunho: Rascunho;
  /** Os erros do 422 do formulário, por campo (`texto`, `n`, `usuarios`). */
  erros: Erros;
  /** A recusa que não é de um campo (409), logo abaixo do formulário. */
  falha?: string;
  /** A recusa do Executar (409) de cada Tarefa, no cartão dela. */
  falhasDeExecutar?: Readonly<Record<number, string>>;
}

const PREFIXO = "campo-tarefa";

/** O que o projeto tem de link do produto: o endereço, ou o aviso de que sem ele não há Simulação. */
const linkDoProduto = (projeto: ProjetoListado): string =>
  projeto.linkProduto
    ? `<span class="muted">Produto em <span class="mono">${escapar(projeto.linkProduto)}</span></span>`
    : '<span class="pill pill-aguarda sem-pulso">sem link do produto</span>';

function formulario({ projeto, usuarios, rascunho, erros, falha }: DadosDaSimulacao): string {
  const texto = marca(erros, "texto", PREFIXO);
  const n = marca(erros, "n", PREFIXO);
  const alocados = marca(erros, "usuarios", PREFIXO);
  const caixas =
    usuarios.length > 0
      ? usuarios
          .map(
            (u) =>
              `<label class="check"><input type="checkbox" name="usuarios" value="${String(u.id)}"${rascunho.usuarios.includes(u.id) ? " checked" : ""}> ${escapar(u.nome)}</label>`,
          )
          .join("")
      : `<span class="muted">Cadastre usuários simulados na <a class="link" href="/config?projeto=${encodeURIComponent(projeto.nome)}">Configuração do projeto</a>.</span>`;
  const descricao = alocados.msg ? ` aria-describedby="${idDe("usuarios", PREFIXO)}-erro"` : "";
  const aviso = falha ? `<span class="msg-erro falha" role="alert">${escapar(falha)}</span>` : "";
  return `<form class="superficie form-tarefa" data-nova-tarefa novalidate><h2>Nova tarefa</h2><div class="campo${texto.classe}"><label for="${idDe("texto", PREFIXO)}">Tarefa</label><textarea id="${idDe("texto", PREFIXO)}" name="texto" rows="2" placeholder="o que o usuário deve tentar fazer no produto"${texto.aria}>${escapar(rascunho.texto)}</textarea>${texto.msg}</div><div class="linha-tarefa"><div class="num-campo${n.classe}"><label for="${idDe("n", PREFIXO)}">Execuções por usuário (N)</label><input type="number" id="${idDe("n", PREFIXO)}" name="n" min="1" max="20" value="${escapar(rascunho.n)}"${n.aria}>${n.msg}</div><fieldset class="campo alocar${alocados.classe}"${descricao}><legend>Usuários simulados</legend>${caixas}${alocados.msg}</fieldset><button type="submit" class="btn btn-primario">Criar tarefa</button></div>${aviso}</form>`;
}

const STATUS: Record<StatusExecucaoSimulada, { rotulo: string; pill: string }> = {
  na_fila: { rotulo: "na fila", pill: "pill-neutro" },
  em_andamento: { rotulo: "em andamento", pill: "pill-rodando" },
  concluida: { rotulo: "concluído", pill: "pill-ok" },
  falhou: { rotulo: "falhou", pill: "pill-falha" },
};

const pendente = (e: ExecucaoSimulada): boolean => e.status === "na_fila" || e.status === "em_andamento";

/** Alguma execução ainda vai mudar de status: a tela relê a cada 3 s enquanto for verdade. */
export const temPendente = (tarefas: readonly Tarefa[]): boolean => tarefas.some((t) => t.execucoes.some(pendente));

/** A coluna do fim da linha: o relatório de quem concluiu, o erro de quem falhou. */
function resultado(t: Tarefa, e: ExecucaoSimulada): string {
  if (e.status === "concluida") {
    return `<button type="button" class="link" data-relatorio="${String(t.id)}:${String(e.id)}">Ver relatório</button>`;
  }
  return e.erro ? `<span class="msg-erro">${escapar(e.erro)}</span>` : "";
}

function execucoes(t: Tarefa): string {
  if (t.execucoes.length === 0) return '<p class="muted">Nenhuma execução ainda.</p>';
  const linhas = t.execucoes
    .map(
      (e, i) =>
        `<tr><td class="id">#${String(i + 1)}</td><td>${escapar(e.usuarioNome)}</td><td><span class="pill ${STATUS[e.status].pill}">${STATUS[e.status].rotulo}</span></td><td>${resultado(t, e)}</td></tr>`,
    )
    .join("");
  return `<div class="rola"><table class="tabela"><thead><tr><th></th><th>Usuário simulado</th><th>Status</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

function cartao(t: Tarefa, falha: string | undefined): string {
  const alocados = t.usuarios.map((u) => `<b>${escapar(u.nome)}</b>`).join(", ");
  const rodando = t.execucoes.some(pendente);
  const botao = `<button type="button" class="btn btn-primario" data-executar="${String(t.id)}"${rodando ? " disabled" : ""}>${rodando ? "Executando…" : "Executar"}</button>`;
  const aviso = falha ? `<p class="msg-erro falha" role="alert">${escapar(falha)}</p>` : "";
  return `<article class="tarefa superficie" data-tarefa="${String(t.id)}"><div class="tarefa-cab"><strong class="tarefa-texto">${escapar(t.texto)}</strong><span class="tag">N = ${String(t.n)}</span><span class="muted">alocada a ${alocados}</span>${botao}</div>${aviso}${execucoes(t)}</article>`;
}

/** Os cartões das Tarefas (ou o aviso de que não há nenhuma): o que o polling redesenha sem mexer no formulário. */
export const listaDeTarefas = (tarefas: readonly Tarefa[], falhas: Readonly<Record<number, string>> = {}): string =>
  tarefas.length > 0
    ? tarefas.map((t) => cartao(t, falhas[t.id])).join("")
    : '<p class="muted">Nenhuma tarefa neste projeto.</p>';

/** O título, o assunto e o corpo da caixa do relatório de uma execução concluída (CA-13). */
export function relatorioNaCaixa(
  t: Tarefa,
  e: ExecucaoSimulada & { relatorio: RelatorioSimulacao },
): { titulo: string; meta: string; corpo: string } {
  const lista = (achados: readonly string[]): string =>
    "<ul>" + achados.map((a) => "<li>" + escapar(a) + "</li>").join("") + "</ul>";
  const secao = (titulo: string, achados: readonly string[]) => {
    const corpo = achados.length > 0 ? lista(achados) : '<p class="muted">Nenhum achado</p>';
    return `<section class="rel-secao"><h3>${titulo}</h3>${corpo}</section>`;
  };
  return {
    titulo: `Relatório · ${e.usuarioNome} · execução #${String(t.execucoes.findIndex((x) => x.id === e.id) + 1)}`,
    meta: t.texto,
    corpo: secao("Usabilidade", e.relatorio.usabilidade) + secao("Bugs", e.relatorio.bugs),
  };
}

/** A página `/simulation/:projeto`: as abas, o formulário de nova Tarefa e as Tarefas do projeto. */
export function paginaDaSimulacao(dados: DadosDaSimulacao): string {
  const abas = dados.projetos
    .map((p) => {
      const atual = p.nome === dados.projeto.nome ? ' aria-current="page"' : "";
      return `<a href="${caminhoDaSimulacao(p.nome)}"${atual}>${escapar(p.nome)}</a>`;
    })
    .join("");
  return `<div class="cabeca-pagina"><h1>Simulação</h1><nav class="abas-projeto" aria-label="Projetos">${abas}</nav><div class="acoes">${linkDoProduto(dados.projeto)}</div></div>${formulario(dados)}<div class="tarefas" data-tarefas>${listaDeTarefas(dados.tarefas, dados.falhasDeExecutar)}</div>`;
}
