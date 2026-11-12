import { HttpError } from "../../../lib/http-error";
import type { AuthUser } from "../../../lib/session";
import { hasProjectManagementRole } from "../../projects/projects.authorization";
import { canSubmitDeliveryDocuments } from "../eap.authorization";
import type { EapRepos, EapTransactionRunner } from "../repositories/contracts";
import type { DeliveryEventAction, DeliveryVersionItemRow } from "../repositories/delivery-compliance.contract";
import {
  normalizeEvidence,
  type ApproveDeliveryItemBody,
  type AssignDeliveryValidatorBody,
  type ReasonDeliveryItemBody,
  type SubmitDeliveryItemBody,
} from "../schemas/eap-delivery-compliance.schema";
import { buildVersionDtos, loadPeople } from "./delivery-versions";
import { assertCanView, loadProjectAccess } from "./shared";

const transitionError = () =>
  new HttpError(409, "A situação atual do documento não permite esta ação. Atualize a tela e confira o histórico.", "DELIVERY_ITEM_TRANSITION_INVALID");

const noteOrNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/**
 * Validadores do item: o designado para ele; sem designação, o responsável técnico designado nos marcos de homologação do
 * projeto (revisor do marco). O fornecedor nunca valida.
 */
async function effectiveValidators(repos: EapRepos, projectId: string, item: DeliveryVersionItemRow) {
  if (item.validatorId) return [item.validatorId];
  const milestones = await repos.milestones.listByProject(projectId);
  return [...new Set(milestones.filter((milestone) => milestone.type === "HOMOLOGACAO" && milestone.reviewerId).map((milestone) => milestone.reviewerId as string))];
}

/** Perfis globais que dispensam documentos obrigatórios, sempre com justificativa formal (mínimo de 10 caracteres) e auditoria. */
const WAIVER_ROLES: ReadonlyArray<string> = ["ADMIN", "PMO"];

/**
 * Envio e validação documental da Conformidade de Entrega. O sistema só registra links (SharePoint) e referências de tag ou
 * release (GitLab). Regras: quem enviou não valida o próprio envio; o validador é o responsável técnico designado; só ADMIN e PMO
 * dispensa (com justificativa formal); rejeição também exige justificativa; todo o histórico é preservado e auditado.
 */
export function makeDeliveryItemUseCases(deps: { repos: EapRepos; runInTransaction: EapTransactionRunner }) {
  async function load(repos: EapRepos, projectId: string, versionId: string, itemId: string) {
    const version = await repos.deliveryCompliance.getVersion(versionId);
    const item = version && version.projectId === projectId ? await repos.deliveryCompliance.getItem(itemId) : null;
    if (!version || !item || item.versionId !== version.id) {
      throw new HttpError(404, "Documento da versão de entrega não encontrado.", "DELIVERY_ITEM_NOT_FOUND");
    }
    return { version, item };
  }

  async function finish(
    repos: EapRepos,
    params: {
      projectId: string;
      actor: AuthUser;
      versionLabel: string;
      item: DeliveryVersionItemRow;
      action: DeliveryEventAction;
      kind: string;
      auditAction: "UPDATE" | "VALIDATE";
      summary: string;
      note: string | null;
      evidence?: { kind: DeliveryVersionItemRow["evidenceKind"]; ref: string | null };
      from: string;
      to: string;
      versionId: string;
    },
  ) {
    const now = new Date();
    await repos.deliveryCompliance.addItemEvent({
      id: crypto.randomUUID(),
      itemId: params.item.id,
      action: params.action,
      actorId: params.actor.id,
      evidenceKind: params.evidence?.kind ?? null,
      evidenceRef: params.evidence?.ref ?? null,
      note: params.note,
      createdAt: now,
    });
    await repos.audit.create({
      id: crypto.randomUUID(),
      projectId: params.projectId,
      entityType: "DELIVERY_ITEM",
      entityId: params.item.id,
      action: params.auditAction,
      summary: params.summary,
      payload: {
        kind: params.kind,
        versionId: params.versionId,
        versionLabel: params.versionLabel,
        documentType: params.item.documentType,
        required: params.item.required,
        from: params.from,
        to: params.to,
        evidenceKind: params.evidence?.kind ?? null,
        note: params.note,
        // Dispensa: registra também o perfil de quem dispensou (ADMIN ou PMO), além da justificativa e da situação anterior.
        ...(params.action === "DISPENSA" ? { actorRole: params.actor.role } : {}),
      },
      actorId: params.actor.id,
    });
    const version = await repos.deliveryCompliance.getVersion(params.versionId);
    return (await buildVersionDtos(repos, [version as NonNullable<typeof version>]))[0];
  }

  function assertOpen(project: { status: string }) {
    if (project.status === "CONCLUIDO") {
      throw new HttpError(409, "Projeto encerrado não aceita alterações no checklist de entrega.", "DELIVERY_PROJECT_CLOSED");
    }
  }

  return {
    async submitItem(actor: AuthUser, projectId: string, versionId: string, itemId: string, body: SubmitDeliveryItemBody) {
      const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
      assertCanView(context);
      if (!canSubmitDeliveryDocuments(context)) {
        throw new HttpError(
          403,
          "Somente dono, gestor, fornecedor, PO, desenvolvedores e responsável técnico do projeto enviam documentos.",
          "DELIVERY_ITEM_SUBMIT_FORBIDDEN",
        );
      }
      assertOpen(project);
      const evidenceRef = normalizeEvidence(body.evidenceKind, body.evidenceRef);
      if (!evidenceRef) {
        throw new HttpError(400, "Informe um link do SharePoint ou uma referência de tag ou release do GitLab válida.", "DELIVERY_EVIDENCE_INVALID");
      }

      return deps.runInTransaction(async (repos) => {
        const { version, item } = await load(repos, projectId, versionId, itemId);
        const updated = await repos.deliveryCompliance.submitItem(item.id, {
          evidenceKind: body.evidenceKind,
          evidenceRef,
          submittedBy: actor.id,
          submittedAt: new Date(),
        });
        if (!updated) throw transitionError();
        return finish(repos, {
          projectId,
          actor,
          versionLabel: version.versionLabel,
          item,
          action: "ENVIO",
          kind: item.status === "REJEITADO" ? "DELIVERY_ITEM_RESUBMITTED" : "DELIVERY_ITEM_SUBMITTED",
          auditAction: "UPDATE",
          summary: `Documento "${item.title}" da versão ${version.versionLabel} enviado para validação.`,
          note: noteOrNull(body.note),
          evidence: { kind: body.evidenceKind, ref: evidenceRef },
          from: item.status,
          to: "ENVIADO",
          versionId,
        });
      });
    },

    async approveItem(actor: AuthUser, projectId: string, versionId: string, itemId: string, body: ApproveDeliveryItemBody) {
      return decide(actor, projectId, versionId, itemId, "APROVADO", noteOrNull(body.note));
    },

    async rejectItem(actor: AuthUser, projectId: string, versionId: string, itemId: string, body: ReasonDeliveryItemBody) {
      return decide(actor, projectId, versionId, itemId, "REJEITADO", body.note.trim());
    },

    async waiveItem(actor: AuthUser, projectId: string, versionId: string, itemId: string, body: ReasonDeliveryItemBody) {
      return decide(actor, projectId, versionId, itemId, "DISPENSADO", body.note.trim());
    },

    async assignValidator(actor: AuthUser, projectId: string, versionId: string, itemId: string, body: AssignDeliveryValidatorBody) {
      const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
      assertCanView(context);
      const manages = actor.role === "PMO" || actor.id === project.ownerId || hasProjectManagementRole(context.memberRoles);
      if (!manages) {
        throw new HttpError(403, "Somente a gestão do projeto ou o PMO designam o validador de um documento.", "DELIVERY_VALIDATOR_FORBIDDEN");
      }
      assertOpen(project);
      return deps.runInTransaction(async (repos) => {
        const { version, item } = await load(repos, projectId, versionId, itemId);
        if (body.validatorId) {
          const members = await repos.members.listByProject(projectId);
          const roles = members.filter((entry) => entry.member.userId === body.validatorId).map((entry) => entry.member.role);
          const isOwner = body.validatorId === project.ownerId;
          if ((roles.length === 0 && !isOwner) || roles.includes("FORNECEDOR")) {
            throw new HttpError(
              400,
              "O validador precisa ser participante do projeto e não pode ser o fornecedor.",
              "DELIVERY_VALIDATOR_INVALID",
            );
          }
        }
        await repos.deliveryCompliance.setItemValidator(item.id, body.validatorId);
        const person = await loadPeople(repos, [body.validatorId]);
        await repos.audit.create({
          id: crypto.randomUUID(),
          projectId,
          entityType: "DELIVERY_ITEM",
          entityId: item.id,
          action: "UPDATE",
          summary: body.validatorId
            ? `Validador do documento "${item.title}" (versão ${version.versionLabel}) designado: ${person(body.validatorId)?.name ?? body.validatorId}.`
            : `Designação de validador do documento "${item.title}" (versão ${version.versionLabel}) removida.`,
          payload: { kind: "DELIVERY_ITEM_VALIDATOR_ASSIGNED", versionId, versionLabel: version.versionLabel, from: item.validatorId, to: body.validatorId },
          actorId: actor.id,
        });
        return (await buildVersionDtos(repos, [version]))[0];
      });
    },

    async listEvents(actor: AuthUser, projectId: string, versionId: string, itemId: string) {
      const { context } = await loadProjectAccess(deps.repos, actor, projectId);
      assertCanView(context);
      const { item } = await load(deps.repos, projectId, versionId, itemId);
      const events = await deps.repos.deliveryCompliance.listItemEvents(item.id);
      const person = await loadPeople(deps.repos, events.map((event) => event.actorId));
      return {
        data: events.map((event) => ({
          id: event.id,
          action: event.action,
          actor: person(event.actorId),
          evidenceKind: event.evidenceKind,
          evidenceRef: event.evidenceRef,
          note: event.note,
          createdAt: event.createdAt.toISOString(),
        })),
      };
    },
  };

  async function decide(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    itemId: string,
    status: "APROVADO" | "REJEITADO" | "DISPENSADO",
    note: string | null,
  ) {
    const { project, context } = await loadProjectAccess(deps.repos, actor, projectId);
    assertCanView(context);
    assertOpen(project);
    if (status === "DISPENSADO" && !WAIVER_ROLES.includes(actor.role)) {
      throw new HttpError(403, "Somente o ADMIN ou o PMO dispensam documentos, mediante justificativa formal.", "DELIVERY_ITEM_WAIVE_FORBIDDEN");
    }

    return deps.runInTransaction(async (repos) => {
      const { version, item } = await load(repos, projectId, versionId, itemId);

      if (status !== "DISPENSADO") {
        if (context.globalRole === "FORNECEDOR" || context.memberRoles.includes("FORNECEDOR")) {
          throw new HttpError(403, "O fornecedor não valida documentos de entrega.", "DELIVERY_ITEM_VALIDATE_FORBIDDEN");
        }
        const validators = await effectiveValidators(repos, projectId, item);
        if (!validators.includes(actor.id)) {
          throw new HttpError(
            403,
            "Somente o responsável técnico designado para o documento (ou para o marco de homologação) valida o documento.",
            "DELIVERY_ITEM_VALIDATE_FORBIDDEN",
          );
        }
        if (item.submittedBy === actor.id) {
          throw new HttpError(403, "Quem enviou o documento não pode validar o próprio envio.", "DELIVERY_ITEM_SELF_VALIDATION");
        }
      }

      const updated = await repos.deliveryCompliance.decideItem(item.id, { status, decidedBy: actor.id, decidedAt: new Date(), decisionNote: note });
      if (!updated) throw transitionError();

      const labels = {
        APROVADO: { action: "APROVACAO", kind: "DELIVERY_ITEM_APPROVED", audit: "VALIDATE", verb: "aprovado" },
        REJEITADO: { action: "REJEICAO", kind: "DELIVERY_ITEM_REJECTED", audit: "VALIDATE", verb: "rejeitado" },
        DISPENSADO: { action: "DISPENSA", kind: "DELIVERY_ITEM_WAIVED", audit: "UPDATE", verb: "dispensado" },
      } as const;
      const label = labels[status];
      return finish(repos, {
        projectId,
        actor,
        versionLabel: version.versionLabel,
        item,
        action: label.action,
        kind: label.kind,
        auditAction: label.audit,
        summary: `Documento "${item.title}" da versão ${version.versionLabel} ${label.verb}.`,
        note,
        evidence: { kind: item.evidenceKind, ref: item.evidenceRef },
        from: item.status,
        to: status,
        versionId,
      });
    });
  }
}

export type DeliveryItemUseCases = ReturnType<typeof makeDeliveryItemUseCases>;
