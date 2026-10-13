// Simulação (F8): o Usuário Simulado e o nome dos seus anexos. Sem I/O.
import { extname } from "node:path";
import { z } from "zod";

/** Pessoa fictícia do projeto (F8 §2): o nome e a descrição do usuário e do seu conhecimento, que vão para a IA. */
export const NovoUsuarioSimulado = z.strictObject({
  nome: z.string().trim().min(1, "Nome obrigatório").max(80),
  descricao: z.string().trim().min(1, "Descrição obrigatória").max(4000),
});

/** Só PDF, texto e imagem: o que o pi lê como `@arquivo` (F8 §2). */
const FORMATOS = new Set([".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** O nome do anexo vira nome de arquivo na pasta da execução: sem `/` nem caractere de controle. */
export const NomeDoAnexo = z
  .string()
  .min(1)
  .max(200)
  .refine((nome) => !/[/\p{Cc}]/u.test(nome), "o nome do arquivo não pode ter / nem caracteres de controle")
  .refine((nome) => FORMATOS.has(extname(nome).toLowerCase()), "formato não suportado: envie PDF, texto ou imagem");

export type NovoUsuarioSimulado = z.infer<typeof NovoUsuarioSimulado>;
