// A fachada do domínio Demandas (MELHORIAS §12), `GestaoDeDemandas`: a única entrada usada por fora do domínio. Cadastra,
// configura e consulta projetos; registra, edita, envia e consulta pedidos, registra o cancelamento e a conclusão deles e
// mantém as dependências entre eles. As migrações do domínio saem daqui para a composição registrá-las em `abrir`.
export * from "./projetos/publico.ts";
export * from "./pedidos/publico.ts";
export * from "./dependencias/publico.ts";
