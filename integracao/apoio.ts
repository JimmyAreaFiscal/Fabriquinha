// Apoio da suíte de integração do SDLC (CA-SDLC-01 a 13 e, na I-244, 14 a 25): cada cenário vive numa raiz temporária
// (banco, repositórios git reais e execuções), removida ao fim do teste. Combinado com a I-244: quem precisa de mais,
// acrescenta funções aqui. git e pi ficam isolados da máquina; o pi e o `gh` falsos estão em `falsos.ts`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, type TestContext } from "node:test";
import { abrirBancoTemporario } from "../apoio-testes/banco_temporario.ts";
import { AUDITOR, type Ator } from "../src/nucleo/ator.ts";
import { submeterPlano } from "../src/nucleo/transicoes_demanda.ts";
import { despacharDemandas, type DepsDespacho } from "../src/aplicacao/despacho_demanda.ts";
import * as gestao from "../src/aplicacao/gestao_demandas.ts";
import { gravarConfiguracaoProjeto } from "../src/armazenamento/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../src/armazenamento/demandas.ts";
import { type Configuracao, configuracao } from "../src/armazenamento/servico.ts";

/** Diretório do arquivo de teste (git, pi e `gh` falsos); some ao fim dele. Os cenários têm a raiz própria. */
export const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-integracao-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
// git sem a configuração da máquina; pi sem a confiança do Auditor; credencial que só o serviço tem.
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Teste\n\temail = teste@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
mkdirSync(join(base, "pi-agent"));
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");
process.env.GH_TOKEN = "token-do-servico";

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("/usr/bin/git", args, { cwd, stdio: "pipe" }).toString().trim();

export const CTX = { agora: "2026-01-01T00:00:00.000Z" };

/** O limite global de paralelismo (D04) não tem rota de escrita: o teste o grava direto na configuração. */
export const gravarLimiteParalelismo = (banco: DatabaseSync, limite: number): void => {
  banco.prepare("UPDATE configuracao SET limite_paralelismo = ?").run(limite);
};

/** O envio do plano pelo agente do `planejar`, como o CLI do agente o grava: `submeterPlano` na transação da demanda. */
export const submeterPlanoDoAgente = (banco: DatabaseSync, demandaId: string, plano: unknown, agente: Ator) =>
  comDemanda(banco, demandaId, (ag) => submeterPlano(ag, plano, agente, { agora: new Date().toISOString() }));
/** A IA externa que registra e envia a demanda, e outra sessão, que não é a autora. */
export const AUTOR: Ator = { tipo: "externo", ferramenta: "claude", sessao: "S1" };
export const OUTRA_SESSAO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "S2" };

export interface Cenario {
  /** Raiz do serviço (banco e execuções), dentro do diretório do cenário. */
  raiz: string;
  banco: DatabaseSync;
  /** Projeto principal, `loja`, com o clone em `repo` e o remoto local em `bare`. */
  projeto: string;
  repo: string;
  bare: string;
  /** Configuração do agendador; o `timeoutMin` do cenário cabe no teste (pode ser fracionário). */
  config: Configuracao;
  dir: string;
}

/** Repositório de origem real (remoto bare local) com a branch base, clonado, e o projeto configurado no banco. */
export function adicionarProjeto(c: Pick<Cenario, "banco" | "dir">, nome: string, branchBase = "main") {
  const bare = join(c.dir, `${nome}.git`);
  const repo = join(c.dir, nome);
  git(c.dir, "init", "-q", "--bare", bare);
  git(c.dir, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", branchBase);
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "push", "-q", "origin", branchBase);
  c.banco
    .prepare(
      `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
       VALUES (?, ?, ?, 'github', ?)`,
    )
    .run(nome, repo, branchBase, `chave-${nome}`);
  gravarConfiguracaoProjeto(c.banco, {
    nome,
    branch_base: branchBase,
    chave_sonarqube: `chave-${nome}`,
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  return { repo, bare };
}

/** Cenário novo numa raiz temporária própria (banco, repositórios e execuções), removida (com o banco fechado) quando o teste `t` termina (CA-3). */
export function criarCenario(t: TestContext, projeto = "loja"): Cenario {
  const { raiz, banco, fechar } = abrirBancoTemporario();
  t.after(fechar);
  const dir = realpathSync(raiz);
  const { repo, bare } = adicionarProjeto({ banco, dir }, projeto);
  return { raiz, banco, projeto, repo, bare, dir, config: configuracao(banco) };
}

/** Espera `condicao` ficar verdadeira lendo o estado (o banco), com limite; nunca um sleep fixo. */
export async function esperar(condicao: () => boolean, descricao: string, limiteMs = 15_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${descricao}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Um ciclo do agendador, como o serviço o roda, e a espera das etapas que ele disparou. */
export async function ciclo(c: Cenario, deps?: DepsDespacho): Promise<void> {
  await Promise.all(despacharDemandas(c.banco, c.config, deps));
}

// Evidências de uma IA externa que registra a demanda (F3): critérios, desenho com o html e custos.
const criterios = { criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }] };
const desenho = { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }] };
const html = [{ nome: "d.html", mime: "text/html; charset=utf-8", conteudo: Buffer.from("<p>x</p>") }];
const custos = (sessao: string) => ({
  sessoes: [
    {
      ferramenta: "claude",
      sessao,
      linhas: [
        {
          provedor: "a",
          modelo: "m",
          tokens_entrada: 1,
          tokens_saida: 1,
          tokens_cache_leitura: 0,
          tokens_cache_escrita: 0,
        },
      ],
    },
  ],
});

export const registrarExterna = (c: Cenario, dependencias?: string[], projeto = c.projeto): string =>
  gestao.registrar(
    c.banco,
    { projeto, titulo: "Titulo", tipo: "funcionalidade", descricao: "Desc", dependencias },
    AUTOR,
    CTX,
  ).demanda.id;

/** Submete as três evidências obrigatórias, como a IA externa as enviaria (`custos` com a sessão externa dada). */
export function submeterObrigatorias(c: Cenario, id: string, sessaoExterna = `ext-${id}`): void {
  const submeter = (tipo: string, dados: unknown, arquivos?: gestao.EntradaEvidencia["arquivos"]) =>
    gestao.submeterEvidencia(c.banco, id, { tipo, dados, arquivos } as gestao.EntradaEvidencia, AUTOR, CTX);
  submeter("criterios_aceite", criterios);
  submeter("desenho_solucao", desenho, html);
  submeter("custos_realizados", custos(sessaoExterna));
}

/** Demanda registrada, completa e enviada: espera a decisão do Auditor em `gate_demanda`. */
export function demandaEnviada(c: Cenario, dependencias?: string[], projeto = c.projeto): string {
  const id = registrarExterna(c, dependencias, projeto);
  submeterObrigatorias(c, id);
  gestao.enviar(c.banco, id, AUTOR, CTX);
  return id;
}

/** Demanda aprovada pelo Auditor: em `planejar`, com o ticket `planejar` aberto. */
export function demandaAprovada(c: Cenario, dependencias?: string[], projeto = c.projeto): string {
  const id = demandaEnviada(c, dependencias, projeto);
  gestao.decidir(c.banco, id, { aprovado: true }, AUDITOR, CTX);
  return id;
}

export const demanda = (c: Cenario, id: string) => carregarDemanda(c.banco, id);
