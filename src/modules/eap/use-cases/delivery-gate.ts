import { HttpError } from "../../../lib/http-error";
import type { EapRepos } from "../repositories/contracts";
import { computeConformity } from "./delivery-conformity";
import { projectHasSupplier } from "./delivery-versions";

type Round = { legacy: boolean; deliveryVersionId: string | null };

function blockingText(conformity: ReturnType<typeof computeConformity>) {
  const names = conformity.blockingItems.slice(0, 5).map((item) => `${item.title} (${item.status.toLowerCase()})`);
  const more = conformity.blockingItems.length > names.length ? ` e mais ${conformity.blockingItems.length - names.length}` : "";
  return `${names.join("; ")}${more}`;
}

/**
 * Homologação do marco final (marco do tipo HOMOLOGACAO) em projeto com fornecedor: bloqueada enquanto existir documento
 * obrigatório pendente, enviado sem validação ou rejeitado na versão avaliada pela rodada. Libera quando todos os obrigatórios
 * estão aprovados ou formalmente dispensados. A rodada sem versão ligada avalia a versão mais recente do projeto; sem nenhuma
 * versão registrada não há checklist e a homologação também fica bloqueada. Rodadas de legado (anteriores ao controle) não
 * são afetadas. Marcos de outros tipos e fases nunca passam por este bloqueio.
 */
export async function assertHomologationConforming(repos: EapRepos, projectId: string, round: Round) {
  if (round.legacy || !(await projectHasSupplier(repos, projectId))) return;

  const version = round.deliveryVersionId
    ? await repos.deliveryCompliance.getVersion(round.deliveryVersionId)
    : ((await repos.deliveryCompliance.listVersions(projectId))[0] ?? null);

  if (!version) {
    throw new HttpError(
      409,
      "A homologação está bloqueada: registre a versão da entrega e o checklist de conformidade documental antes de homologar.",
      "DELIVERY_VERSION_REQUIRED",
    );
  }

  const conformity = computeConformity(await repos.deliveryCompliance.listItems([version.id]));
  if (!conformity.conforming) {
    throw new HttpError(
      409,
      `A homologação está bloqueada: a versão ${version.versionLabel} tem documento obrigatório pendente, sem validação ou rejeitado: ${blockingText(conformity)}.`,
      "DELIVERY_NOT_CONFORMING",
    );
  }
}

/** Encerramento de projeto com fornecedor: todas as versões de entrega registradas precisam estar conformes. */
export async function assertProjectDeliveriesConforming(repos: EapRepos, projectId: string) {
  if (!(await projectHasSupplier(repos, projectId))) return;
  const versions = await repos.deliveryCompliance.listVersions(projectId);
  if (versions.length === 0) return;
  const items = await repos.deliveryCompliance.listItems(versions.map((version) => version.id));

  const failing = versions.flatMap((version) => {
    const conformity = computeConformity(items.filter((item) => item.versionId === version.id));
    return conformity.conforming ? [] : [`${version.versionLabel} (${conformity.blockingItems.length} documento${conformity.blockingItems.length === 1 ? "" : "s"} obrigatório${conformity.blockingItems.length === 1 ? "" : "s"} sem conformidade)`];
  });
  if (failing.length > 0) {
    throw new HttpError(
      409,
      `O encerramento exige que todas as versões de entrega registradas estejam conformes. Pendentes: ${failing.join("; ")}.`,
      "PROJECT_DELIVERY_NOT_CONFORMING",
    );
  }
}

/** Versão a ligar à rodada que está sendo enviada: a informada (do próprio projeto) ou, na homologação, a mais recente. */
export async function resolveRoundVersionId(
  repos: EapRepos,
  projectId: string,
  milestoneType: string,
  requested: string | null | undefined,
) {
  if (requested) {
    const version = await repos.deliveryCompliance.getVersion(requested);
    if (!version || version.projectId !== projectId) {
      throw new HttpError(404, "Versão de entrega não encontrada neste projeto.", "DELIVERY_VERSION_NOT_FOUND");
    }
    return version.id;
  }
  if (milestoneType === "HOMOLOGACAO" && (await projectHasSupplier(repos, projectId))) {
    return (await repos.deliveryCompliance.listVersions(projectId))[0]?.id ?? null;
  }
  return null;
}
