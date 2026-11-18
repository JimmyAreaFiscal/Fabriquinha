// O contrato da API do navegador de pastas da Configuração (I-309): as subpastas de um caminho da máquina da Fabriquinha.
import { z } from "zod";

/** Uma subpasta; `acessivel` é falso quando o processo não pode ler o conteúdo dela. */
const Pasta = z.object({
  nome: z.string(),
  caminho: z.string(),
  repositorioGit: z.boolean(),
  acessivel: z.boolean(),
});
type Pasta = z.infer<typeof Pasta>;

/** `GET /api/pastas`: `pai` é `null` na raiz; `acessivel` falso é a própria pasta ilegível, com `pastas` vazio. */
export const ListaDePastas = z.object({
  caminho: z.string(),
  pai: z.string().nullable(),
  acessivel: z.boolean(),
  pastas: z.array(Pasta),
});
export type ListaDePastas = z.infer<typeof ListaDePastas>;
