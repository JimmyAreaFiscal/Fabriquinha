// A fachada do domínio Demandas (MELHORIAS §12), `GestaoDeDemandas`: a única entrada usada por fora do domínio. Por ora,
// cadastrar, configurar e consultar projetos; os Pedidos e as Dependências entram aqui quando migrarem (ticket 19).
export * from "./projetos/publico.ts";
