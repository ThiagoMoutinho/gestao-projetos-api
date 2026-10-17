import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthUser } from "../../lib/session";
import { getAuthUser } from "../../lib/session";
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  ProjectDetailDto,
  ProjectListItemDto,
  ProjectMemberDto,
  UpdateProjectInput,
} from "./dtos/projects.dto";
import type { ProjectMemberRole } from "./schemas/projects.schema";

type ProjectUseCases = {
  createProject: (
    actor: AuthUser,
    input: CreateProjectInput,
  ) => Promise<ProjectDetailDto>;
  listProjects: (actor: AuthUser) => Promise<{ data: ProjectListItemDto[] }>;
  listMyProjects: (actor: AuthUser) => Promise<{ data: ProjectListItemDto[] }>;
  getProject: (actor: AuthUser, projectId: string) => Promise<ProjectDetailDto>;
  updateProject: (
    actor: AuthUser,
    projectId: string,
    input: UpdateProjectInput,
  ) => Promise<ProjectDetailDto>;
  transferProjectOwner: (
    actor: AuthUser,
    projectId: string,
    newOwnerId: string,
  ) => Promise<ProjectDetailDto>;
  listProjectMembers: (
    actor: AuthUser,
    projectId: string,
  ) => Promise<{ data: ProjectMemberDto[] }>;
  addProjectMember: (
    actor: AuthUser,
    projectId: string,
    input: AddProjectMemberInput,
  ) => Promise<ProjectMemberDto>;
  updateProjectMember: (
    actor: AuthUser,
    projectId: string,
    memberId: string,
    input: { role: ProjectMemberRole },
  ) => Promise<ProjectMemberDto>;
  removeProjectMember: (
    actor: AuthUser,
    projectId: string,
    memberId: string,
  ) => Promise<void>;
};

export function makeProjectsController(useCases: ProjectUseCases) {
  return {
    async create(
      request: FastifyRequest<{ Body: CreateProjectInput }>,
      reply: FastifyReply,
    ) {
      const project = await useCases.createProject(getAuthUser(request), request.body);
      return reply.status(201).send(project);
    },

    async list(request: FastifyRequest) {
      return useCases.listProjects(getAuthUser(request));
    },

    async listMine(request: FastifyRequest) {
      return useCases.listMyProjects(getAuthUser(request));
    },

    async get(request: FastifyRequest<{ Params: { id: string } }>) {
      return useCases.getProject(getAuthUser(request), request.params.id);
    },

    async update(
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateProjectInput;
      }>,
    ) {
      return useCases.updateProject(
        getAuthUser(request),
        request.params.id,
        request.body,
      );
    },

    async listMembers(request: FastifyRequest<{ Params: { id: string } }>) {
      return useCases.listProjectMembers(getAuthUser(request), request.params.id);
    },

    async addMember(
      request: FastifyRequest<{
        Params: { id: string };
        Body: AddProjectMemberInput;
      }>,
      reply: FastifyReply,
    ) {
      const member = await useCases.addProjectMember(
        getAuthUser(request),
        request.params.id,
        request.body,
      );
      return reply.status(201).send(member);
    },

    async updateMember(
      request: FastifyRequest<{
        Params: { id: string; memberId: string };
        Body: { role: ProjectMemberRole };
      }>,
    ) {
      return useCases.updateProjectMember(
        getAuthUser(request),
        request.params.id,
        request.params.memberId,
        request.body,
      );
    },

    async removeMember(
      request: FastifyRequest<{ Params: { id: string; memberId: string } }>,
      reply: FastifyReply,
    ) {
      await useCases.removeProjectMember(
        getAuthUser(request),
        request.params.id,
        request.params.memberId,
      );
      return reply.status(204).send();
    },
  };
}

export type ProjectsController = ReturnType<typeof makeProjectsController>;
