import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { canSubmitDeliveryDocuments } from "../eap.authorization";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import type { DeliveryVersionItemRow, DeliveryVersionRow } from "../repositories/delivery-compliance.contract";
import type {
  CreateDeliveryVersionBody,
  DeliveryVersionDto,
  DeliveryVersionItemDto,
} from "../schemas/eap-delivery-compliance.schema";
import { computeConformity } from "./delivery-conformity";
import { assertCanView, loadProjectAccess } from "./shared";

type Person = { id: string; name: string | null } | null;

/** Projeto com fornecedor: a Conformidade de Entrega só se aplica a eles. */
export async function projectHasSupplier(repos: EapRepos, projectId: string) {
  const members = await repos.members.listByProject(projectId);
  return members.some((entry) => entry.member.role === "FORNECEDOR");
}

/** Resolve nomes de várias pessoas de uma só vez. */
export async function loadPeople(repos: EapRepos, ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const users = await Promise.all(unique.map((id) => repos.users.findById(id)));
  const map = new Map(users.flatMap((user) => (user ? [[user.id, { id: user.id, name: user.name }] as const] : [])));
  return (id: string | null | undefined): Person => (id ? (map.get(id) ?? { id, name: null }) : null);
}

export function toVersionItemDto(item: DeliveryVersionItemRow, person: (id: string | null | undefined) => Person): DeliveryVersionItemDto {
  return {
    id: item.id,
    position: item.position,
    documentType: item.documentType,
    title: item.title,
    description: item.description,
    required: item.required,
    status: item.status,
    evidenceKind: item.evidenceKind,
    evidenceRef: item.evidenceRef,
    submittedBy: person(item.submittedBy),
    submittedAt: item.submittedAt?.toISOString() ?? null,
    validator: person(item.validatorId),
    decidedBy: person(item.decidedBy),
    decidedAt: item.decidedAt?.toISOString() ?? null,
    decisionNote: item.decisionNote,
  };
}

/** Monta a versão com seus itens, a conformidade e as rodadas de avaliação ligadas a ela. */
export async function buildVersionDtos(repos: EapRepos, versions: DeliveryVersionRow[]): Promise<DeliveryVersionDto[]> {
  if (versions.length === 0) return [];
  const ids = versions.map((version) => version.id);
  const [items, rounds] = await Promise.all([repos.deliveryCompliance.listItems(ids), repos.deliveryCompliance.countRoundsByVersion(ids)]);
  const revisions = new Map(
    await Promise.all(
      [...new Set(versions.map((version) => version.templateRevisionId))].map(async (id) => [id, await repos.deliveryCompliance.getRevision(id)] as const),
    ),
  );
  // Responsáveis técnicos dos marcos de homologação: validam os documentos sem validador designado (mesma regra do envio).
  const projectIds = [...new Set(versions.map((version) => version.projectId))];
  const reviewers = new Map(
    await Promise.all(
      projectIds.map(async (projectId) => {
        const milestones = await repos.milestones.listByProject(projectId);
        const ids = [...new Set(milestones.filter((milestone) => milestone.type === "HOMOLOGACAO" && milestone.reviewerId).map((milestone) => milestone.reviewerId as string))];
        return [projectId, ids] as const;
      }),
    ),
  );
  const person = await loadPeople(repos, [
    ...versions.map((version) => version.createdBy),
    ...items.flatMap((item) => [item.submittedBy, item.validatorId, item.decidedBy]),
    ...[...reviewers.values()].flat(),
  ]);

  return versions.map((version) => {
    const own = items.filter((item) => item.versionId === version.id);
    const revision = revisions.get(version.templateRevisionId) ?? null;
    return {
      id: version.id,
      versionLabel: version.versionLabel,
      nature: version.nature,
      templateRevision: revision?.revision ?? 0,
      templateIsProposal: revision?.isProposal ?? false,
      notes: version.notes,
      createdBy: person(version.createdBy),
      createdAt: version.createdAt.toISOString(),
      rounds: rounds[version.id] ?? 0,
      conformity: computeConformity(own),
      defaultValidators: (reviewers.get(version.projectId) ?? []).map((id) => person(id) as NonNullable<Person>),
      items: own.map((item) => toVersionItemDto(item, person)),
    };
  });
}

/**
 * Versões de entrega do projeto. A versão é lógica (1.0, 1.1, 2.0) e não se confunde com a rodada de avaliação do marco: várias
 * rodadas podem avaliar a mesma versão, e o reenvio após rejeição NÃO cria versão nova. A versão copia os itens da revisão
 * publicada do modelo no momento da criação; revisões publicadas depois não alteram o checklist já em uso.
 */
export function makeDeliveryVersionUseCases(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  return {
    async listVersions(actor: AuthUser, projectId: string) {
      const { context } = await loadProjectAccess(deps.repos, actor, projectId);
      assertCanView(context);
      const [versions, hasSupplier] = await Promise.all([
        deps.repos.deliveryCompliance.listVersions(projectId),
        projectHasSupplier(deps.repos, projectId),
      ]);
      const data = await buildVersionDtos(deps.repos, versions);
      const conforming = data.filter((version) => version.conformity.conforming).length;
      return { data, summary: { versions: data.length, conforming, nonConforming: data.length - conforming, hasSupplier } };
    },

    async getVersion(actor: AuthUser, projectId: string, versionId: string) {
      const { context } = await loadProjectAccess(deps.repos, actor, projectId);
      assertCanView(context);
      const version = await deps.repos.deliveryCompliance.getVersion(versionId);
      if (!version || version.projectId !== projectId) {
        throw new HttpError(404, "Versão de entrega não encontrada.", "DELIVERY_VERSION_NOT_FOUND");
      }
      return (await buildVersionDtos(deps.repos, [version]))[0];
    },

    async createVersion(actor: AuthUser, projectId: string, body: CreateDeliveryVersionBody) {
      const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
      assertCanView(context);
      if (!canSubmitDeliveryDocuments(context)) {
        throw new HttpError(
          403,
          "Somente dono, gestor, fornecedor, PO, desenvolvedores e responsável técnico do projeto registram versões de entrega.",
          "DELIVERY_VERSION_FORBIDDEN",
        );
      }
      if (project.status === "CONCLUIDO") {
        throw new HttpError(409, "Projeto encerrado não aceita novas versões de entrega.", "DELIVERY_PROJECT_CLOSED");
      }
      if (!(await projectHasSupplier(deps.repos, projectId))) {
        throw new HttpError(
          409,
          "A Conformidade de Entrega se aplica a projetos com fornecedor vinculado.",
          "DELIVERY_PROJECT_WITHOUT_SUPPLIER",
        );
      }

      return deps.runInTransaction(async (repos) => {
        if (await repos.deliveryCompliance.findVersionByLabel(projectId, body.versionLabel)) {
          throw new HttpError(409, `A versão ${body.versionLabel} já está registrada neste projeto.`, "DELIVERY_VERSION_LABEL_EXISTS");
        }
        const revision = await repos.deliveryCompliance.getLatestPublished(body.nature);
        if (!revision) {
          throw new HttpError(409, "Não há modelo de checklist publicado para esta natureza.", "DELIVERY_TEMPLATE_NOT_PUBLISHED");
        }
        const now = new Date();
        const { version } = await repos.deliveryCompliance.createVersion({
          projectId,
          versionLabel: body.versionLabel,
          nature: body.nature,
          revision,
          notes: body.notes?.trim() ? body.notes.trim() : null,
          createdBy: actor.id,
          now,
        });
        await repos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "DELIVERY_VERSION",
          entityId: version.id,
          action: "CREATE",
          summary: `Versão de entrega ${version.versionLabel} registrada (${body.nature}).`,
          payload: {
            kind: "DELIVERY_VERSION_CREATED",
            versionLabel: version.versionLabel,
            nature: body.nature,
            templateRevision: revision.revision,
            templateIsProposal: revision.isProposal,
            itemCount: revision.items.length,
          },
          actorId: actor.id,
        });
        return (await buildVersionDtos(repos, [version]))[0];
      });
    },
  };
}

export type DeliveryVersionUseCases = ReturnType<typeof makeDeliveryVersionUseCases>;
