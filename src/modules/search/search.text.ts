/**
 * Funções puras da busca global: normalização sem acento, palavras do termo, padrão LIKE seguro e trecho do texto.
 * Ficam fora do repositório para serem testadas sem banco.
 */

const ACCENTED = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
const PLAIN = "aaaaaaeeeeiiiiooooouuuucn";

/** Pares usados também no SQL (translate): mesma lista, mesma ordem, para a busca casar igual nos dois lados. */
export const SQL_ACCENTED = ACCENTED;
export const SQL_PLAIN = PLAIN;

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;
export const MAX_WORDS = 5;

/** Minúsculas e sem acento, preservando o tamanho do texto (o índice do achado vale para o texto original). */
export function foldText(value: string): string {
  let out = "";
  for (const char of value.toLowerCase()) {
    const index = ACCENTED.indexOf(char);
    out += index >= 0 ? PLAIN[index] : char;
  }
  return out;
}

/** Palavras do termo: só letras e números (sem acento nem pontuação), sem repetição e no máximo MAX_WORDS. */
export function searchWords(query: string): string[] {
  const words = foldText(query)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** Escapa %, _ e \ para a palavra valer como texto literal num LIKE ... ESCAPE '\'. */
export function escapeLike(word: string): string {
  return word.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Casa pelo começo de qualquer palavra do texto (o texto chega ao SQL com um espaço na frente e sem pontuação). */
export function likePattern(word: string): string {
  return `% ${escapeLike(word)}%`;
}

/** Trecho de até `size` caracteres ao redor da primeira palavra encontrada, com reticências nas pontas cortadas. */
export function excerpt(text: string | null | undefined, words: readonly string[], size = 110): string | null {
  if (!text) {
    return null;
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length === 0) {
    return null;
  }
  if (clean.length <= size) {
    return clean;
  }
  const folded = foldText(clean);
  const hits = words.map((word) => folded.indexOf(word)).filter((index) => index >= 0);
  const first = hits.length > 0 ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(first - Math.floor(size / 4), clean.length - size));
  const end = Math.min(clean.length, start + size);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}
