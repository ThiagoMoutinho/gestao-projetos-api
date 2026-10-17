import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserRole } from "../../lib/session";
import {
  canAssignProjectOwner,
  canCreateProject,
  canListAllProjects,
  canManageProjectMembers,
  canTransferOwnership,
  canUpdateProject,
  canViewProject,
  isProtectedOwnerMembership,
  type ProjectAccessContext,
} from "./projects.authorization";
import type { ProjectMemberRole } from "./schemas/projects.schema";

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

describe("autorização de projetos", () => {
  it("permite listar todos os projetos apenas para ADMIN, PMO e COORDENADOR", () => {
    assert.equal(canListAllProjects("ADMIN"), true);
    assert.equal(canListAllProjects("PMO"), true);
    assert.equal(canListAllProjects("COORDENADOR"), true);
    assert.equal(canListAllProjects("GESTOR"), false);
    assert.equal(canListAllProjects("FORNECEDOR"), false);
    assert.equal(canListAllProjects("COLABORADOR"), false);
  });

  it("restringe o cadastro de projetos a ADMIN e PMO", () => {
    assert.equal(canCreateProject("ADMIN"), true);
    assert.equal(canCreateProject("PMO"), true);
    assert.equal(canCreateProject("COORDENADOR"), false);
    assert.equal(canCreateProject("GESTOR"), false);
    assert.equal(canCreateProject("COLABORADOR"), false);
  });

  it("impede FORNECEDOR e COLABORADOR de consultar projeto sem vínculo", () => {
    assert.equal(canViewProject(context("FORNECEDOR")), false);
    assert.equal(canViewProject(context("COLABORADOR")), false);
    assert.equal(
      canViewProject(context("COLABORADOR", { memberRoles: ["DESENVOLVEDOR"] })),
      true,
    );
    assert.equal(
      canViewProject(context("GESTOR", { userId: "owner-1", ownerId: "owner-1" })),
      true,
    );
  });

  it("não concede gestão de participantes a FORNECEDOR e COLABORADOR", () => {
    assert.equal(
      canManageProjectMembers(
        context("FORNECEDOR", { userId: "owner-1", ownerId: "owner-1" }),
      ),
      false,
    );
    assert.equal(
      canManageProjectMembers(
        context("COLABORADOR", { memberRoles: ["DESENVOLVEDOR"] }),
      ),
      false,
    );
  });

  it("autoriza GESTOR a gerenciar participantes quando é dono ou tem função de gestão", () => {
    assert.equal(
      canManageProjectMembers(
        context("GESTOR", { userId: "owner-1", ownerId: "owner-1" }),
      ),
      true,
    );
    assert.equal(
      canManageProjectMembers(context("GESTOR", { memberRoles: ["GESTOR"] })),
      true,
    );
    assert.equal(
      canManageProjectMembers(context("GESTOR", { memberRoles: ["OBSERVADOR"] })),
      false,
    );
  });

  it("não permite que participante comum altere o projeto", () => {
    assert.equal(
      canUpdateProject(context("GESTOR", { memberRoles: ["DESENVOLVEDOR"] })),
      false,
    );
    assert.equal(
      canUpdateProject(context("PMO", { memberRoles: [] })),
      true,
    );
  });

  it("restringe transferência de dono ao titular ou a perfis institucionais", () => {
    assert.equal(canAssignProjectOwner("PMO"), true);
    assert.equal(canAssignProjectOwner("GESTOR"), false);
    assert.equal(
      canTransferOwnership(
        context("GESTOR", { userId: "owner-1", ownerId: "owner-1" }),
      ),
      true,
    );
    assert.equal(
      canTransferOwnership(context("GESTOR", { memberRoles: ["GESTOR"] })),
      false,
    );
  });

  it("protege a participação DONO_PROJETO do dono principal", () => {
    assert.equal(
      isProtectedOwnerMembership("owner-1", "owner-1", "DONO_PROJETO"),
      true,
    );
    assert.equal(
      isProtectedOwnerMembership("owner-1", "owner-1", "GESTOR"),
      false,
    );
    assert.equal(
      isProtectedOwnerMembership("owner-1", "other-user", "DONO_PROJETO"),
      false,
    );
  });
});
