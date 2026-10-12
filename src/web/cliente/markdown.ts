// Markdown de texto vindo de agente ou do Auditor (F7 §4.4): `markdown-it` com `html: false`, que escapa qualquer HTML do
// texto em vez de injetá-lo na página. No navegador, o import map do `index.html` leva ao pacote servido em /static/.
import markdownit from "markdown-it/browser";

const md = markdownit({ html: false });

export const markdown = (texto: string): string => md.render(texto);
