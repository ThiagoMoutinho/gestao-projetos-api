/** Regras puras do catálogo de funções: normalização do nome e chave contra duplicatas. */

export const FUNCTION_NAME_MIN = 2;
export const FUNCTION_NAME_MAX = 60;

const ACCENTED = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
const PLAIN = "aaaaaaeeeeiiiiooooouuuucn";

/** Nome para exibição: sem espaços nas pontas nem repetidos; mantém a caixa e os acentos digitados. */
export function cleanFunctionName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Chave única: minúsculas, sem acento e sem pontuação, para "Stakeholder", "stakeholder " e "STAKEHOLDER" serem a mesma função. */
export function functionNameKey(name: string): string {
  let out = "";
  for (const char of cleanFunctionName(name).toLowerCase()) {
    const index = ACCENTED.indexOf(char);
    out += index >= 0 ? PLAIN[index] : char;
  }
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Nomes dos papéis de acesso fixos (rótulos da lista e códigos). Uma função do catálogo não pode ter o mesmo nome de um papel,
 * senão a lista de funções mostraria "Desenvolvedor" duas vezes (o papel e a "função").
 */
export const RESERVED_ROLE_NAMES = [
  "Dono do projeto",
  "Dono projeto",
  "Gestor",
  "PO",
  "Responsável técnico",
  "Desenvolvedor",
  "Fornecedor",
  "Observador",
] as const;

const RESERVED_KEYS = new Set(RESERVED_ROLE_NAMES.map((name) => functionNameKey(name)));

/** O nome (ignorando caixa, acento e espaços) é o de um papel de acesso fixo? */
export function isReservedFunctionName(name: string): boolean {
  return RESERVED_KEYS.has(functionNameKey(name));
}
