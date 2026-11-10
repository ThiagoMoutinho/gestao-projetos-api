/** Banco descartável de prévia do Cronograma. O seed só roda nele: nenhum outro banco é aceito, nem o principal nem o de prévia oficial. */
export const PREVIEW_DATABASE_NAME = "gp_preview_97";
export const PREVIEW_PROJECT_ID = "demo-proj-05";
/** Todo registro criado pelo seed tem este prefixo no id, para ser reconhecido e removido sem tocar em mais nada. */
export const PREVIEW_ID_PREFIX = "prev97-";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type PreviewAssessment = { ok: true; host: string; database: string } | { ok: false; reason: string };

export function assessPreviewDatabase(env: Record<string, string | undefined>): PreviewAssessment {
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "Execução bloqueada: o seed de prévia não roda em produção." };
  }
  if (!env.DATABASE_URL) {
    return { ok: false, reason: "Execução bloqueada: DATABASE_URL não informado." };
  }
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return { ok: false, reason: "Execução bloqueada: DATABASE_URL inválido." };
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return { ok: false, reason: "Execução bloqueada: o banco precisa estar em localhost." };
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database !== PREVIEW_DATABASE_NAME) {
    return { ok: false, reason: `Execução bloqueada: o banco precisa ser ${PREVIEW_DATABASE_NAME} (recebido: ${database || "vazio"}).` };
  }
  return { ok: true, host: url.hostname, database };
}
