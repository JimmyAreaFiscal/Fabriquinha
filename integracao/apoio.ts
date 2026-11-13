// Apoio da suíte de integração do SDLC (CA-SDLC-01 a 13 e, na I-244, 14 a 25): cada cenário vive numa raiz temporária
// (banco, repositórios git reais e execuções), removida ao fim do teste. Combinado com a I-244: quem precisa de mais,
// acrescenta funções aqui. git e pi ficam isolados da máquina; o pi e o `gh` falsos estão em `falsos.ts`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, type TestContext } from "node:test";
import { abrirBancoTemporario } from "../apoio-testes/banco_temporario.ts";
import { AUDITOR, type Ator } from "../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeRegra } from "../src/modulos/compartilhado/nucleo/erros.ts";
import { submeterEvidencia } from "../src/modulos/sdlc/aplicacao/evidencias/submeter.ts";
import { cicloDoDespacho, type DepsDespacho } from "../src/modulos/sdlc/aplicacao/despacho/despacho.ts";
import { despachoDasEtapas } from "../src/modulos/etapas/conducoes.ts";
import { decidirGate } from "../src/modulos/etapas/gates.ts";
import * as gestao from "../src/modulos/sdlc/aplicacao/gestao_demandas.ts";
import { Endereco } from "../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { gravarProjeto, Projeto } from "../src/modulos/demandas/publico.ts";
import { carregarDemanda } from "../src/modulos/sdlc/armazenamento/demandas.ts";
import { gravarUsoDeclarado } from "../src/modulos/trabalho_agentico/armazenamento/uso_declarado.ts";
import { type Configuracao, configuracao } from "../src/modulos/compartilhado/armazenamento/servico.ts";

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

/** De onde os anexos das evidências externas vêm: a pasta do teste. */
export const ORIGENS_DOS_ANEXOS = { worktree: base, saida: base, fora: "da pasta do teste", copie: "a pasta do teste" };
/** O caminho de um HTML novo, como o desenho de uma IA externa o anexa. */
export const anexoHtml = (): string => {
  const pasta = mkdtempSync(join(base, "anexo-"));
  writeFileSync(join(pasta, "d.html"), "<!doctype html><p>x</p>");
  return join(pasta, "d.html");
};

/** O limite global de paralelismo (D04) não tem rota de escrita: o teste o grava direto na configuração. */
export const gravarLimiteParalelismo = (banco: DatabaseSync, limite: number): void => {
  banco.prepare("UPDATE configuracao SET limite_paralelismo = ?").run(limite);
};

/** O envio do plano pelo agente do `planejar`, como o CLI do agente o grava: `submeterEvidencia`; a recusa lança. */
export function proporPlanoDoAgente(banco: DatabaseSync, demandaId: string, plano: unknown, agente: Ator): void {
  const planejar = carregarDemanda(banco, demandaId).tickets.findLast((t) => t.etapa === "planejar");
  assert.ok(planejar, "ticket planejar");
  const avaliacao = submeterEvidencia(
    banco,
    {
      tipo: "plano",
      dono: Endereco.doTicket(demandaId, planejar.ticket_id),
      produtor: agente,
      dados: plano,
      anexos: [],
    },
    { origens: ORIGENS_DOS_ANEXOS },
  );
  if (avaliacao.resultado === "recusada") throw new ErroDeRegra(avaliacao.motivo);
}
/** A IA externa que registra e envia a demanda, e outra sessão, que não é a autora. */
export const AUTOR: Ator = { tipo: "externo", ferramenta: "claude", sessao: "S1" };
export const OUTRA_SESSAO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "S2" };

export interface Cenario extends ReturnType<typeof adicionarProjeto> {
  /** Raiz do serviço (banco e execuções), dentro do diretório do cenário. */
  raiz: string;
  banco: DatabaseSync;
  /** Projeto principal, `loja`, com o clone em `repo` e o remoto local em `bare`. */
  projeto: string;
  /** Configuração do agendador; o `timeoutMin` do cenário cabe no teste (pode ser fracionário). */
  config: Configuracao;
  dir: string;
}

/** Repositório de origem real (remoto bare local) com a branch base, clonado, e o projeto configurado no banco. */
export function adicionarProjeto(c: { banco: DatabaseSync; dir: string }, nome: string, branchBase = "main") {
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
  gravarProjeto(
    c.banco,
    Projeto.parse({
      nome,
      branch_base: branchBase,
      chave_sonarqube: `chave-${nome}`,
      raiz_git: repo,
      hospedagem: "github",
      etapas: [],
      verificacoes: {
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
    }),
  );
  return { repo, bare };
}

/**
 * Cenário novo numa raiz temporária própria (banco, repositórios e execuções), removida (com o banco fechado) quando o
 * teste `t` termina (CA-3). `raizExistente` é a pasta já criada que o cenário usa no lugar de uma nova no tmp.
 */
export function criarCenario(t: TestContext, projeto = "loja", raizExistente?: string): Cenario {
  const { raiz, banco, fechar } = abrirBancoTemporario(raizExistente);
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
export async function ciclo(c: Cenario, deps: DepsDespacho = despachoDasEtapas()): Promise<void> {
  await Promise.all(cicloDoDespacho(c.banco, c.config, deps));
}

// Evidências de uma IA externa que registra a demanda (F3): critérios e desenho com o html.
const criterios = { criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }] };
const desenho = { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }] };

/** O Uso declarado de uma sessão externa (uma linha `x/m`, custo `null` = desconhecido), gravado como o comando de uso o grava. */
export function declararUso(c: Cenario, demanda_id: string, sessao: string, custo: number | null = null): void {
  const linhas = [
    {
      modelo: "x/m",
      tokens_entrada: 1,
      tokens_saida: 1,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
      custo,
      chamadas: 0,
    },
  ];
  const { demandaDona } = gravarUsoDeclarado(c.banco, { ferramenta: "claude", sessao, demanda_id, linhas });
  if (demandaDona === demanda_id) {
    c.banco
      .prepare("INSERT OR IGNORE INTO trabalho_nao_gerenciado (ferramenta, sessao, demanda_id) VALUES (?, ?, ?)")
      .run("claude", sessao, demanda_id);
  }
}

export const registrarExterna = (c: Cenario, dependencias?: string[], projeto = c.projeto): string =>
  gestao.registrar(
    c.banco,
    { projeto, titulo: "Titulo", tipo: "funcionalidade", descricao: "Desc", dependencias },
    AUTOR,
    CTX,
  ).demanda.id;

/** Submete as evidências obrigatórias, como a IA externa as enviaria. */
export function submeterObrigatorias(c: Cenario, id: string): void {
  const submeter = (tipo: string, dados: unknown, arquivos?: gestao.EntradaEvidencia["arquivos"]) =>
    gestao.submeterEvidencia(
      c.banco,
      id,
      { tipo, dados, arquivos } as gestao.EntradaEvidencia,
      AUTOR,
      ORIGENS_DOS_ANEXOS,
    );
  submeter("criterios_aceite", criterios);
  submeter("desenho_solucao", desenho, [anexoHtml()]);
}

/** Demanda registrada, completa e enviada: espera a decisão do Auditor em `gate_demanda`. */
export function demandaEnviada(c: Cenario, dependencias?: string[], projeto = c.projeto): string {
  const id = registrarExterna(c, dependencias, projeto);
  submeterObrigatorias(c, id);
  gestao.enviar(c.banco, id, AUTOR, CTX);
  return id;
}

/** Demanda aprovada pelo Auditor: em `planejar`, com o ticket `planejar` aberto. */
export async function demandaAprovada(c: Cenario, dependencias?: string[], projeto = c.projeto): Promise<string> {
  const id = demandaEnviada(c, dependencias, projeto);
  await decidirGate(c.banco, "gate_demanda", Endereco.daDemanda(id), { resultado: "aprovado" }, AUDITOR);
  return id;
}

export const demanda = (c: Cenario, id: string) => carregarDemanda(c.banco, id);
