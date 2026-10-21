import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserRole } from "../../lib/session";
import type { ProjectMemberRole } from "../projects/schemas/projects.schema";
import {
  canCreateEapItems,
  canDeliverEapMilestone,
  canEditEapItem,
  canManageEapPhases,
  canRegisterEapEvidence,
  canRegisterEapEvidenceOn,
  canReviewEapMilestone,
  canStructureEapMilestones,
  canStructureEapTasks,
  canUpdateEapTaskProgress,
  canViewProject,
  type ProjectAccessContext,
} from "./eap.authorization";

function context(
  globalRole: UserRole,
  options?: {
    userId?: string;
    ownerId?: string;
    memberRoles?: ProjectMemberRole[];
  },
): ProjectAccessContext {
  return {
    globalRole,
    userId: options?.userId ?? "user-1",
    ownerId: options?.ownerId ?? "owner-1",
    memberRoles: options?.memberRoles ?? [],
  };
}

describe("autorização de fases da EAP", () => {
  it("reutiliza canViewProject para consulta", () => {
    assert.equal(canViewProject(context("ADMIN")), true);
    assert.equal(canViewProject(context("PMO")), true);
    assert.equal(canViewProject(context("COORDENADOR")), true);
    assert.equal(canViewProject(context("FORNECEDOR")), false);
    assert.equal(
      canViewProject(context("FORNECEDOR", { memberRoles: ["FORNECEDOR"] })),
      true,
    );
    assert.equal(canViewProject(context("COLABORADOR")), false);
  });

  it("permite ADMIN, PMO e COORDENADOR gerenciar fases", () => {
    assert.equal(canManageEapPhases(context("ADMIN")), true);
    assert.equal(canManageEapPhases(context("PMO")), true);
    assert.equal(canManageEapPhases(context("COORDENADOR")), true);
  });

  it("permite GESTOR autorizado gerenciar fases", () => {
    assert.equal(
      canManageEapPhases(context("GESTOR", { userId: "owner-1", ownerId: "owner-1" })),
      true,
    );
    assert.equal(
      canManageEapPhases(context("GESTOR", { memberRoles: ["DONO_PROJETO"] })),
      true,
    );
    assert.equal(canManageEapPhases(context("GESTOR", { memberRoles: ["GESTOR"] })), true);
    assert.equal(
      canManageEapPhases(context("GESTOR", { memberRoles: ["OBSERVADOR"] })),
      false,
    );
  });

  it("impede FORNECEDOR, DESENVOLVEDOR, OBSERVADOR e COLABORADOR de gerenciar fases", () => {
    assert.equal(
      canManageEapPhases(context("FORNECEDOR", { memberRoles: ["FORNECEDOR"] })),
      false,
    );
    assert.equal(
      canManageEapPhases(context("GESTOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
    assert.equal(
      canManageEapPhases(context("GESTOR", { memberRoles: ["OBSERVADOR"] })),
      false,
    );
    assert.equal(
      canManageEapPhases(context("COLABORADOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
  });
});

describe("autorização de tarefas da EAP", () => {
  it("permite ADMIN, PMO, COORDENADOR e GESTOR autorizado estruturar tarefas", () => {
    assert.equal(canStructureEapTasks(context("ADMIN")), true);
    assert.equal(canStructureEapTasks(context("PMO")), true);
    assert.equal(canStructureEapTasks(context("COORDENADOR")), true);
    assert.equal(
      canStructureEapTasks(context("GESTOR", { memberRoles: ["GESTOR"] })),
      true,
    );
  });

  it("impede FORNECEDOR, DESENVOLVEDOR, OBSERVADOR e COLABORADOR de estruturar tarefas", () => {
    assert.equal(
      canStructureEapTasks(context("FORNECEDOR", { memberRoles: ["FORNECEDOR"] })),
      false,
    );
    assert.equal(
      canStructureEapTasks(context("GESTOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
    assert.equal(
      canStructureEapTasks(context("GESTOR", { memberRoles: ["OBSERVADOR"] })),
      false,
    );
    assert.equal(
      canStructureEapTasks(context("COLABORADOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
  });

  it("permite ao responsável vinculado atualizar somente a própria tarefa", () => {
    const task = (assigneeId: string | null) => ({ assigneeId, createdBy: "pmo-1" });

    assert.equal(
      canUpdateEapTaskProgress(
        context("FORNECEDOR", { userId: "forn-1", memberRoles: ["FORNECEDOR"] }),
        task("forn-1"),
      ),
      true,
    );
    assert.equal(
      canUpdateEapTaskProgress(
        context("FORNECEDOR", { userId: "forn-1", memberRoles: ["FORNECEDOR"] }),
        task("outro"),
      ),
      false,
    );
    assert.equal(
      canUpdateEapTaskProgress(
        context("GESTOR", { userId: "dev-1", memberRoles: ["DESENVOLVEDOR"] }),
        task("dev-1"),
      ),
      true,
    );
    assert.equal(
      canUpdateEapTaskProgress(
        context("GESTOR", { userId: "obs-1", memberRoles: ["OBSERVADOR"] }),
        task("obs-1"),
      ),
      true,
    );
    assert.equal(
      canUpdateEapTaskProgress(context("COLABORADOR", { userId: "colab-1" }), task("colab-1")),
      false,
    );
    assert.equal(
      canUpdateEapTaskProgress(
        context("GESTOR", { userId: "dev-1", memberRoles: ["DESENVOLVEDOR"] }),
        task(null),
      ),
      false,
    );
  });

  it("permite ao criador atualizar a própria tarefa sem ser responsável", () => {
    assert.equal(
      canUpdateEapTaskProgress(
        context("COLABORADOR", { userId: "po-1", memberRoles: ["PO"] }),
        { assigneeId: null, createdBy: "po-1" },
      ),
      true,
    );
    assert.equal(
      canUpdateEapTaskProgress(
        context("COLABORADOR", { userId: "po-1", memberRoles: ["PO"] }),
        { assigneeId: null, createdBy: "outro" },
      ),
      false,
    );
    assert.equal(
      canUpdateEapTaskProgress(
        context("GESTOR", { userId: "obs-1", memberRoles: ["OBSERVADOR"] }),
        { assigneeId: null, createdBy: "obs-1" },
      ),
      false,
    );
  });

  it("permite gestores institucionais atualizar execução mesmo sem serem responsáveis", () => {
    const task = { assigneeId: "forn-1", createdBy: "pmo-1" };
    assert.equal(canUpdateEapTaskProgress(context("PMO"), task), true);
    assert.equal(
      canUpdateEapTaskProgress(context("GESTOR", { memberRoles: ["GESTOR"] }), task),
      true,
    );
  });
});

describe("criação e edição de itens da EAP", () => {
  it("permite criar a ADMIN, PMO, COORDENADOR e ao dono do projeto", () => {
    assert.equal(canCreateEapItems(context("ADMIN")), true);
    assert.equal(canCreateEapItems(context("PMO")), true);
    assert.equal(canCreateEapItems(context("COORDENADOR")), true);
    assert.equal(
      canCreateEapItems(context("COLABORADOR", { userId: "owner-1", ownerId: "owner-1" })),
      true,
    );
  });

  it("permite criar às funções de projeto com edição, independentemente do perfil global", () => {
    const roles: ProjectMemberRole[] = [
      "DONO_PROJETO",
      "GESTOR",
      "PO",
      "RESPONSAVEL_TECNICO",
      "DESENVOLVEDOR",
      "FORNECEDOR",
    ];
    for (const role of roles) {
      assert.equal(canCreateEapItems(context("COLABORADOR", { memberRoles: [role] })), true, role);
      assert.equal(canCreateEapItems(context("FORNECEDOR", { memberRoles: [role] })), true, role);
    }
  });

  it("impede OBSERVADOR e usuários sem vínculo de criar", () => {
    assert.equal(canCreateEapItems(context("GESTOR", { memberRoles: ["OBSERVADOR"] })), false);
    assert.equal(canCreateEapItems(context("GESTOR")), false);
    assert.equal(canCreateEapItems(context("FORNECEDOR")), false);
    assert.equal(canCreateEapItems(context("COLABORADOR")), false);
  });

  it("permite editar apenas os itens criados pelo próprio usuário", () => {
    const dev = context("COLABORADOR", { userId: "dev-1", memberRoles: ["DESENVOLVEDOR"] });
    assert.equal(canEditEapItem(dev, "dev-1"), true);
    assert.equal(canEditEapItem(dev, "outro"), false);
    assert.equal(canStructureEapTasks(dev), false);
    assert.equal(canManageEapPhases(dev), false);
  });

  it("não concede edição ao criador que perdeu a função de edição", () => {
    assert.equal(
      canEditEapItem(context("GESTOR", { userId: "obs-1", memberRoles: ["OBSERVADOR"] }), "obs-1"),
      false,
    );
    assert.equal(canEditEapItem(context("FORNECEDOR", { userId: "ex-1" }), "ex-1"), false);
  });

  it("mantém a edição administrativa para gestão e perfis institucionais", () => {
    assert.equal(canEditEapItem(context("PMO"), "outro"), true);
    assert.equal(canEditEapItem(context("COORDENADOR"), "outro"), true);
    assert.equal(canEditEapItem(context("GESTOR", { memberRoles: ["GESTOR"] }), "outro"), true);
    assert.equal(
      canEditEapItem(context("GESTOR", { userId: "owner-1", ownerId: "owner-1" }), "outro"),
      true,
    );
  });
});

describe("evidências da EAP", () => {
  it("permite ao responsável da tarefa vincular evidência mesmo sem função de evidência", () => {
    const observer = context("GESTOR", { userId: "obs-1", memberRoles: ["OBSERVADOR"] });
    assert.equal(canRegisterEapEvidence(observer), false);
    assert.equal(
      canRegisterEapEvidenceOn(observer, { createdBy: "pmo-1", assigneeId: "obs-1" }),
      true,
    );
    assert.equal(
      canRegisterEapEvidenceOn(observer, { createdBy: "pmo-1", assigneeId: "outro" }),
      false,
    );
    assert.equal(canRegisterEapEvidenceOn(observer, null), false);
  });

  it("impede responsável sem vínculo com o projeto", () => {
    assert.equal(
      canRegisterEapEvidenceOn(context("COLABORADOR", { userId: "ex-1" }), {
        createdBy: "pmo-1",
        assigneeId: "ex-1",
      }),
      false,
    );
  });
});

describe("autorização de marcos da EAP", () => {
  it("permite institucional e gestores estruturar marcos e impede fornecedor", () => {
    assert.equal(canStructureEapMilestones(context("ADMIN")), true);
    assert.equal(canStructureEapMilestones(context("PMO")), true);
    assert.equal(
      canStructureEapMilestones(context("GESTOR", { memberRoles: ["GESTOR"] })),
      true,
    );
    assert.equal(
      canStructureEapMilestones(context("FORNECEDOR", { memberRoles: ["FORNECEDOR"] })),
      false,
    );
    assert.equal(
      canStructureEapMilestones(context("GESTOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
  });

  it("permite fornecedor vinculado entregar e impede colaborador sem vínculo", () => {
    assert.equal(
      canDeliverEapMilestone(context("FORNECEDOR", { memberRoles: ["FORNECEDOR"] })),
      true,
    );
    assert.equal(canDeliverEapMilestone(context("PMO")), true);
    assert.equal(canDeliverEapMilestone(context("FORNECEDOR")), false);
    assert.equal(
      canDeliverEapMilestone(context("GESTOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
  });

  it("restringe a decisão institucional a perfis autorizados", () => {
    assert.equal(canReviewEapMilestone(context("ADMIN")), true);
    assert.equal(canReviewEapMilestone(context("COORDENADOR")), true);
    assert.equal(
      canReviewEapMilestone(context("GESTOR", { memberRoles: ["DONO_PROJETO"] })),
      true,
    );
    assert.equal(
      canReviewEapMilestone(context("FORNECEDOR", { memberRoles: ["FORNECEDOR"] })),
      false,
    );
  });
});
