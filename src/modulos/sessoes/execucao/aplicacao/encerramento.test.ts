// A estimativa do custo no fim da execução e na consulta: o Uso que o harness não custeou recebe o custo pelo preço do
// catálogo vigente no instante, gravado com a referência do preço; o custo informado fica como veio.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import type { LinhaDeUso } from "../../harness/publico.ts";
import { gravarCatalogoDePrecos, lerPrecoVigente } from "../../modelos/publico.ts";
import type { Execucao, Sessao } from "../nucleo/sessao.ts";
import { encerrarExecucaoComUso, registrarUsoDaConsulta } from "./encerramento.ts";
import { carregarSessoesDoContexto, comSessoesDoContexto } from "./sessoes_do_contexto.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const T = "2026-11-01T00:00:00.000Z";
const FIM = "2026-11-13T10:00:00.000Z";
const relogio = { agora: () => FIM };
const ref = { demanda_id: "I-1", ticket_id: 1 };
const SESSAO: Sessao = { id: "s1", demanda_id: "I-1", ticket_id: 1, modo: "autonomo", conversa_referencia: "c-s1" };
const EXECUCAO: Execucao = { id: "e1", trabalho_id: "s1", inicio: "2026-11-13T09:00:00.000Z", falha: false };

const linha = (modelo: string, custo: number | null): LinhaDeUso => ({
  modelo,
  tokens_entrada: 1_000_000,
  tokens_saida: 100_000,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
  custo,
  chamadas: 1,
});

/** A execução aberta do ticket 1 e o preço do sonnet no catálogo desde `T`. */
function bancoComExecucaoAberta() {
  const { banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'em_execucao', '${T}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) VALUES ('I-1', 'em_execucao', '${T}', 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', '${T}');`);
  comSessoesDoContexto(banco, ref, (estado) => ({ ...estado, sessoes: [SESSAO], execucoes: [EXECUCAO] }));
  gravarCatalogoDePrecos(
    banco,
    [
      {
        modelo: { provedor: "anthropic", nome: "claude-sonnet-5-5" },
        usd_por_milhao: { entrada: 2, saida: 10, cache_leitura: 0.1, cache_escrita: 2.5 },
        origem: "pi",
      },
    ],
    T,
  );
  return banco;
}

const usosGravados = (banco: ReturnType<typeof bancoComExecucaoAberta>) =>
  carregarSessoesDoContexto(banco, ref).usos.map(({ modelo_nome, custo, preco_id }) => ({
    modelo_nome,
    custo,
    preco_id,
  }));

test("o fim da execução estima pelo catálogo o custo que o harness não informou e grava a referência do preço", () => {
  const banco = bancoComExecucaoAberta();
  const harness = {
    lerUsoDaSessao: () => [
      linha("anthropic/claude-sonnet-5-5", null),
      linha("anthropic/claude-opus-5-5", 0.5),
      linha("anthropic/claude-haiku-5-5", null),
    ],
  };
  encerrarExecucaoComUso({ banco, ref, sessao: SESSAO, execucao: EXECUCAO }, false, "/dev/null", harness, relogio);
  const preco = lerPrecoVigente(banco, { provedor: "anthropic", nome: "claude-sonnet-5-5" }, FIM);
  assert.deepEqual(usosGravados(banco), [
    // 1M × 2 + 0,1M × 10 = US$ 3, pelo preço vigente no fim da execução.
    { modelo_nome: "claude-sonnet-5-5", custo: 3, preco_id: preco?.id },
    { modelo_nome: "claude-opus-5-5", custo: 0.5, preco_id: undefined },
    // Sem preço no catálogo, o custo segue desconhecido.
    { modelo_nome: "claude-haiku-5-5", custo: undefined, preco_id: undefined },
  ]);
});

test("a consulta sem custo informado também recebe a estimativa, somada ao Uso da execução que a pediu", () => {
  const banco = bancoComExecucaoAberta();
  registrarUsoDaConsulta(banco, ref, EXECUCAO.id, [linha("anthropic/claude-sonnet-5-5", null)], relogio);
  const preco = lerPrecoVigente(banco, { provedor: "anthropic", nome: "claude-sonnet-5-5" }, FIM);
  assert.deepEqual(usosGravados(banco), [{ modelo_nome: "claude-sonnet-5-5", custo: 3, preco_id: preco?.id }]);
});
