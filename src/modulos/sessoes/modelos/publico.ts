// A API do subdomínio Modelos: o modelo do agente, o esforço de raciocínio e os dois juntos, como a execução os guarda,
// e o catálogo de preços com que o custo não informado é estimado.
export { ConfiguracaoDoModelo, Effort, Modelo } from "./nucleo/modelo.ts";
export { custoPeloPreco, type PrecoDoCatalogo, PrecoDoModelo } from "./nucleo/preco_do_modelo.ts";
export { gravarCatalogoDePrecos, lerPrecoVigente } from "./armazenamento/catalogo_de_precos.ts";
