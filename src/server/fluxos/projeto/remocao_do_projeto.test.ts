// O fluxo da remoção do projeto: recusa enquanto um ticket do projeto executa, e apaga em cada domínio o que depende do
// projeto, sem tocar o outro projeto nem deixar referência quebrada; no disco, só os anexos que ninguém mais cita saem.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco/banco_temporario.ts";
import { criarDemandaNova } from "../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { caminhoArquivo } from "../../../shared/armazenamento/arquivos.ts";
import { ErroDeInexistente, ErroDeRegra } from "../../../shared/nucleo/erros.ts";
import { FABRIQUINHA } from "../../../modulos/ciclo_de_vida/publico.ts";
import { registrarDemanda } from "../../../modulos/ciclo_de_vida/processo/nucleo/transicoes/transicoes_demanda.ts";
import { iniciarTentativaDoTicket } from "../../../modulos/ciclo_de_vida/processo/nucleo/transicoes_do_ticket/inicio_da_execucao.ts";
import { Projeto } from "../../../modulos/demandas/publico.ts";
import { removerProjetoComOQueDependeDele } from "./remocao_do_projeto.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../composicao/banco_da_fabriquinha.ts";
import { buscarProjeto, gravarProjeto } from "../../../../apoio-testes/demandas_de_teste.ts";

const ANEXO_ORFAO = "a".repeat(64);
const ANEXO_DE_OUTRO_PROJETO = "b".repeat(64);
const ANEXO_DE_USUARIO_SIMULADO = "c".repeat(64);

/** O banco com os projetos `a` e `b`, cada um com um pedido em execução, sessão, Simulação, evidências e anexos. */
function cenario(): { banco: DatabaseSync; raiz: string; fechar: () => void } {
  const { banco, raiz, fechar } = abrirBancoTemporario();
  for (const nome of ["a", "b"])
    gravarProjeto(
      banco,
      Projeto.parse({
        nome,
        branch_base: "main",
        chave_sonarqube: "k",
        raiz_git: `/repo/${nome}`,
        hospedagem: "github",
      }),
    );
  banco.exec(`
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, criada_por_ferramenta, criada_por_sessao, enviada) VALUES
      ('I-1', 'a', 'A', 'problema', 'descrição', 'pi', 's', 1), ('I-2', 'b', 'B', 'problema', 'descrição', 'pi', 's', 1);
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) VALUES
      ('I-1', 'em_execucao', 'agora', 'a'), ('I-2', 'em_execucao', 'agora', 'b');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES
      ('I-1', 1, 'implementar', 'aberto', 'agora'), ('I-2', 1, 'implementar', 'em_execucao', 'agora');
    INSERT INTO dependencia_demanda VALUES ('I-2', 'I-1');
    INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s1', 'I-1', 1, 'autonomo', 'conversa');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('execucao', 's1', '2026-01-01T00:00:00.000Z', NULL, 0);
    INSERT INTO usuario_simulado (id, projeto, nome, descricao) VALUES (1, 'a', 'Maria', 'd'), (2, 'b', 'João', 'd');
    INSERT INTO tarefa (id, projeto, texto, n, criada_em) VALUES (1, 'a', 't', 1, 'agora'), (2, 'b', 't', 1, 'agora');
    INSERT INTO tarefa_usuario VALUES (1, 1), (2, 2);
    INSERT INTO execucao_simulada (id, tarefa, usuario, status) VALUES (1, 1, 1, 'na_fila'), (2, 2, 2, 'na_fila');
    INSERT INTO evidencia_demanda (id, demanda_id, tipo, em) VALUES ('ev1', 'I-1', 'comportamento', 'agora'), ('ev2', 'I-2', 'comportamento', 'agora');
    INSERT INTO arquivo_evidencia VALUES
      ('ev1', 1, 'orfao.txt', '${ANEXO_ORFAO}', 'text/plain', 1),
      ('ev1', 2, 'compartilhado.txt', '${ANEXO_DE_OUTRO_PROJETO}', 'text/plain', 1),
      ('ev1', 3, 'usuario.txt', '${ANEXO_DE_USUARIO_SIMULADO}', 'text/plain', 1),
      ('ev2', 1, 'compartilhado.txt', '${ANEXO_DE_OUTRO_PROJETO}', 'text/plain', 1);
    INSERT INTO usuario_simulado_anexo VALUES (2, 'usuario.txt', '${ANEXO_DE_USUARIO_SIMULADO}', 1);
  `);
  for (const sha256 of [ANEXO_ORFAO, ANEXO_DE_OUTRO_PROJETO, ANEXO_DE_USUARIO_SIMULADO]) {
    mkdirSync(dirname(caminhoArquivo(banco, sha256)), { recursive: true });
    writeFileSync(caminhoArquivo(banco, sha256), "x");
  }
  for (const pasta of ["execucoes/E-execucao", "sessoes/conversa", "simulacoes/1"])
    mkdirSync(join(raiz, pasta), { recursive: true });
  return { banco, raiz, fechar };
}

const contar = (banco: DatabaseSync, sql: string): unknown => banco.prepare(sql).get()?.quantidade;

test("recusa enquanto um ticket do projeto executa e, sem execução, apaga tudo o que depende do projeto, só dele", async () => {
  const { banco, raiz, fechar } = cenario();
  const recusa = { name: ErroDeRegra.name, message: /^o projeto a tem execução em andamento no I-1\.T1/ };
  await assert.rejects(
    removerProjetoComOQueDependeDele(banco, montarCicloDeVidaDoBanco(banco), montarDemandasDoBanco(banco), "a"),
    recusa,
  );
  banco.exec(
    "UPDATE processo_do_trabalho SET fim = '2026-01-01T00:01:00.000Z'; UPDATE ticket_demanda SET estado = 'em_execucao' WHERE demanda_id = 'I-1'",
  );
  await assert.rejects(
    removerProjetoComOQueDependeDele(banco, montarCicloDeVidaDoBanco(banco), montarDemandasDoBanco(banco), "a"),
    recusa,
  );
  banco.exec("UPDATE ticket_demanda SET estado = 'aberto' WHERE demanda_id = 'I-1'");

  const { avisos } = await removerProjetoComOQueDependeDele(
    banco,
    montarCicloDeVidaDoBanco(banco),
    montarDemandasDoBanco(banco),
    "a",
  );

  // Os repositórios do cenário não existem: só a limpeza das worktrees avisa.
  assert.deepEqual(avisos, [
    "git -C /repo/a worktree prune falhou: fatal: cannot change to '/repo/a': No such file or directory",
  ]);
  assert.equal(buscarProjeto(banco, "a"), undefined);
  assert.ok(buscarProjeto(banco, "b"));
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM demanda WHERE projeto = 'a'"), 0);
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM processo_demanda WHERE demanda_id = 'I-1'"), 0);
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM trabalho_agentico"), 0);
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM dependencia_demanda"), 0);
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM execucao_simulada"), 1);
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM ticket_demanda"), 1);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(
    [ANEXO_ORFAO, ANEXO_DE_OUTRO_PROJETO, ANEXO_DE_USUARIO_SIMULADO].map((sha256) =>
      existsSync(caminhoArquivo(banco, sha256)),
    ),
    [false, true, true],
  );
  for (const pasta of ["execucoes/E-execucao", "sessoes/conversa", "simulacoes/1"])
    assert.equal(existsSync(join(raiz, pasta)), false, pasta);
  fechar();
});

test("remove as Tentativas antes dos tickets, sem deixar referência quebrada, e recusa o projeto que não existe", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  for (const nome of ["a", "b"])
    gravarProjeto(
      banco,
      Projeto.parse({
        nome,
        branch_base: "main",
        chave_sonarqube: "k",
        raiz_git: `/repo/${nome}`,
        hospedagem: "github",
      }),
    );
  const agora = "2026-01-01T00:00:00.000Z";
  criarDemandaNova(banco, (id) =>
    iniciarTentativaDoTicket(
      registrarDemanda(
        { id, projeto: "a", titulo: "com Tentativa", descricao: "d", tipo: "problema" },
        { tipo: "externo", ferramenta: "pi", sessao: "s1" },
        { agora },
      ),
      { ticket_id: 1, processo_id: "exec-1" },
      FABRIQUINHA,
      { agora },
    ),
  );
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM tentativa"), 1);
  banco.exec("UPDATE ticket_demanda SET estado = 'aberto'");

  await removerProjetoComOQueDependeDele(banco, montarCicloDeVidaDoBanco(banco), montarDemandasDoBanco(banco), "a");

  assert.deepEqual(
    montarDemandasDoBanco(banco)
      .projetos()
      .map((projeto) => projeto.nome),
    ["b"],
  );
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM tentativa"), 0);
  assert.equal(contar(banco, "SELECT count(*) AS quantidade FROM ticket_demanda"), 0);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  await assert.rejects(
    removerProjetoComOQueDependeDele(banco, montarCicloDeVidaDoBanco(banco), montarDemandasDoBanco(banco), "fantasma"),
    ErroDeInexistente,
  );
  fechar();
});
