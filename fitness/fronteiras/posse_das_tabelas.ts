// O dono de cada tabela do banco (MELHORIAS §5.1): o subdomínio de destino `<domínio>/<subdomínio>`, o único cujo
// `armazenamento/` fala SQL com ela, ou `shared` para o mecanismo técnico. A fitness da posse falha com tabela sem dono,
// dono sem tabela ou dono que o arquivo do domínio não declara. Tabela nova entra aqui na mesma mudança que a cria.
export const DONO_DE_CADA_TABELA: Record<string, string> = {
  // Ambiente
  ambiente: "ambiente/sandboxes",
  configuracao_ambiente: "ambiente/configuracao",

  // Sessões de IA
  trabalho_agentico: "sessoes/execucao",
  processo_do_trabalho: "sessoes/execucao",
  uso_modelo_execucao: "sessoes/metricas_de_execucao",
  uso_modelo_historico: "sessoes/metricas_de_execucao",
  uso_declarado: "sessoes/metricas_de_execucao",
  trabalho_nao_gerenciado: "sessoes/metricas_de_execucao",
  preco_do_modelo: "sessoes/modelos",

  // Repositório
  commit_ticket_demanda: "repositorio/commits",
  arquivo_commit_demanda: "repositorio/commits",
  commit_humano_posterior: "repositorio/commits",
  varredura_base: "repositorio/commits",
  pull_request: "repositorio/hospedagem",

  // Ciclo de Vida
  // A linha única da configuração do serviço; as colunas `ambiente_*` ficaram sem uso na migração 54, que deu à
  // Configuração do Ambiente a tabela própria.
  configuracao: "ciclo_de_vida/despacho",
  versao_plano: "ciclo_de_vida/planejamento",
  rodada: "ciclo_de_vida/planejamento",
  ticket_demanda: "ciclo_de_vida/planejamento",
  dependencia_rodada: "ciclo_de_vida/planejamento",
  dependencia_ticket: "ciclo_de_vida/planejamento",
  arquivo_previsto_demanda: "ciclo_de_vida/planejamento",
  arquivo_previsto_rodada: "ciclo_de_vida/planejamento",
  caminho_ticket: "ciclo_de_vida/planejamento",
  criterio_citado_rodada: "ciclo_de_vida/planejamento",
  processo_demanda: "ciclo_de_vida/processo",
  decisao_ticket: "ciclo_de_vida/processo",
  tentativa: "ciclo_de_vida/processo",
  iteracao_demanda: "ciclo_de_vida/processo",
  proposta_demanda: "ciclo_de_vida/processo",
  encerramento_demanda: "ciclo_de_vida/processo",
  limpeza_pendente_encerramento: "ciclo_de_vida/processo",
  evidencia_demanda: "ciclo_de_vida/evidencias",
  evidencia_historico: "ciclo_de_vida/evidencias",
  arquivo_evidencia: "ciclo_de_vida/evidencias",

  // Demandas
  projeto: "demandas/projetos",
  linguagem_projeto: "demandas/projetos",
  comando_preparacao_projeto: "demandas/projetos",
  configuracao_e2e: "demandas/projetos",
  glob_e2e: "demandas/projetos",
  fitness_function_projeto: "demandas/projetos",
  configuracao_etapa_projeto: "demandas/projetos",
  demanda: "demandas/pedidos",
  demanda_historico: "demandas/pedidos",
  dependencia_demanda: "demandas/dependencias",
  // Históricas da Avaliação, que saiu no ticket 02: o achado ainda é a origem da demanda encaminhada dele.
  avaliacao: "demandas/pedidos",
  avaliacao_demanda: "demandas/pedidos",
  achado_avaliacao: "demandas/pedidos",
  uso_avaliacao: "demandas/pedidos",
  // Históricas da Simulação, que saiu no ticket 02: só a remoção do projeto ainda as apaga.
  usuario_simulado: "demandas/projetos",
  usuario_simulado_anexo: "demandas/projetos",
  tarefa: "demandas/projetos",
  tarefa_usuario: "demandas/projetos",
  execucao_simulada: "demandas/projetos",

  // Shared: a sequência dos IDs, da unidade de trabalho.
  sequencia: "shared",
};
