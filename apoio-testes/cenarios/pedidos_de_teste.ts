// Pedidos registrados, completos e enviados como a ferramenta externa os deixa, pelos fluxos do servidor, para os testes
// dos Pedidos, das Dependências e dos fluxos que partem de um pedido real num banco temporário.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import { fabricaDeBancosTemporarios } from "../banco/banco_temporario.ts";
import { registrarPedidoComProcesso } from "../../src/server/fluxos/registro_do_pedido.ts";
import { enviarAoDesenvolvimento } from "../../src/server/fluxos/envio_ao_desenvolvimento.ts";
import { submeterEvidenciaDaEntradaExterna } from "../../src/modulos/ciclo_de_vida/publico.ts";
import { montarDemandasDoBanco } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { cicloDeVidaNoContexto } from "../ciclo_de_vida_de_teste.ts";

export const INSTANTE_DOS_PEDIDOS = "2026-01-01T00:00:00.000Z";
export const CONTEXTO_DOS_PEDIDOS = { agora: INSTANTE_DOS_PEDIDOS };
export const AUTORA_DOS_PEDIDOS = { tipo: "externo" as const, ferramenta: "claude", sessao: "S1" };
export const OUTRA_SESSAO = { tipo: "externo" as const, ferramenta: "claude", sessao: "S2" };

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const pastaDosAnexos = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-pedidos-de-teste-")));
after(() => {
  rmSync(pastaDosAnexos, { recursive: true, force: true });
});
const ORIGENS_DOS_ANEXOS = {
  worktree: pastaDosAnexos,
  saida: pastaDosAnexos,
  fora: "da pasta do teste",
  copie: "a pasta do teste",
};

/** Banco temporário com o projeto `fabriquinha` cadastrado (e `outro`, com `comOutroProjeto`). */
export function bancoComProjeto({ comOutroProjeto = false } = {}): DatabaseSync {
  const { banco } = abrirBancoTemporario();
  for (const nome of comOutroProjeto ? ["fabriquinha", "outro"] : ["fabriquinha"]) {
    banco
      .prepare(
        `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
         VALUES (?, ?, 'main', 'github', ?)`,
      )
      .run(nome, `/repo/${nome}`, `k-${nome}`);
  }
  return banco;
}

/** O rascunho novo do projeto (por padrão, `fabriquinha`), dependente de `dependencias`; devolve o ID. */
export const registrarPedidoDeTeste = (
  banco: DatabaseSync,
  dependencias?: string[],
  { autor = AUTORA_DOS_PEDIDOS, projeto = "fabriquinha" } = {},
): string =>
  registrarPedidoComProcesso(
    cicloDeVidaNoContexto(banco, CONTEXTO_DOS_PEDIDOS),
    montarDemandasDoBanco(banco),
    { projeto, titulo: "Titulo", tipo: "funcionalidade", descricao: "Desc", dependencias },
    autor,
  ).demanda.id;

/** Submete as evidências obrigatórias da definição, como a autora do pedido. */
export function completarDefinicao(banco: DatabaseSync, id: string): void {
  const pasta = mkdtempSync(join(pastaDosAnexos, "a-"));
  writeFileSync(join(pasta, "d.html"), "<!doctype html><p>x</p>");
  const criterios = { criterios: [{ id: "CA-1", dado: "um dado", quando: "quando", entao: "então" }] };
  const desenho = { resumo: "r", arquivosPrevistos: [{ caminho: "src/a.ts", acao: "criar", motivo: "porque" }] };
  submeterEvidenciaDaEntradaExterna(
    banco,
    id,
    { tipo: "criterios_aceite", dados: criterios },
    AUTORA_DOS_PEDIDOS,
    ORIGENS_DOS_ANEXOS,
  );
  submeterEvidenciaDaEntradaExterna(
    banco,
    id,
    { tipo: "desenho_solucao", dados: desenho, arquivos: [join(pasta, "d.html")] },
    AUTORA_DOS_PEDIDOS,
    ORIGENS_DOS_ANEXOS,
  );
}

/** O pedido registrado, completo e enviado: o processo espera o Auditor no Gate da demanda. */
export function pedidoEnviadoDeTeste(banco: DatabaseSync, dependencias?: string[]): string {
  const id = registrarPedidoDeTeste(banco, dependencias);
  completarDefinicao(banco, id);
  enviarAoDesenvolvimento(
    cicloDeVidaNoContexto(banco, CONTEXTO_DOS_PEDIDOS),
    montarDemandasDoBanco(banco),
    id,
    AUTORA_DOS_PEDIDOS,
  );
  return id;
}

/** A situação administrativa do pedido `id`, lida direto da linha. */
export const situacaoGravada = (banco: DatabaseSync, id: string): unknown =>
  banco.prepare("SELECT situacao FROM demanda WHERE id = ?").get(id)?.situacao;
