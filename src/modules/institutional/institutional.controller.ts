import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthUser } from "../../lib/session";
import { getAuthUser } from "../../lib/session";
import type {
  CreateResultInput,
  DecisionInput,
  HighlightDto,
  ProfileFieldViewDto,
  ProjectOverviewDto,
  ProjectResultViewDto,
  UpdateResultInput,
} from "./dtos/institutional.dto";
import type { EapEvidenceDto } from "../eap/dtos/eap-evidences.dto";
import type { ProfileField } from "./repositories/contracts";

type InstitutionalUseCases = {
  getProjectOverview: (actor: AuthUser, projectId: string) => Promise<ProjectOverviewDto>;
  saveProfileField: (
    actor: AuthUser,
    projectId: string,
    field: ProfileField,
    value: string,
  ) => Promise<ProfileFieldViewDto>;
  decideProfileField: (
    actor: AuthUser,
    projectId: string,
    field: ProfileField,
    input: DecisionInput,
  ) => Promise<ProfileFieldViewDto>;
  createResult: (actor: AuthUser, projectId: string, input: CreateResultInput) => Promise<ProjectResultViewDto>;
  updateResult: (
    actor: AuthUser,
    projectId: string,
    resultId: string,
    input: UpdateResultInput,
  ) => Promise<ProjectResultViewDto>;
  decideResult: (
    actor: AuthUser,
    projectId: string,
    resultId: string,
    input: DecisionInput,
  ) => Promise<ProjectResultViewDto>;
  archiveResult: (actor: AuthUser, projectId: string, resultId: string) => Promise<void>;
  registerResultEvidence: (
    actor: AuthUser,
    projectId: string,
    resultId: string,
    input: { title: string; url: string },
  ) => Promise<EapEvidenceDto>;
  setHighlight: (actor: AuthUser, projectId: string, milestoneId: string) => Promise<HighlightDto>;
  removeHighlight: (actor: AuthUser, projectId: string, milestoneId: string) => Promise<void>;
};

export function makeInstitutionalController(useCases: InstitutionalUseCases) {
  return {
    async overview(request: FastifyRequest<{ Params: { id: string } }>) {
      return useCases.getProjectOverview(getAuthUser(request), request.params.id);
    },

    async saveProfile(
      request: FastifyRequest<{ Params: { id: string; field: ProfileField }; Body: { value: string } }>,
    ) {
      return useCases.saveProfileField(
        getAuthUser(request),
        request.params.id,
        request.params.field,
        request.body.value,
      );
    },

    async decideProfile(
      request: FastifyRequest<{ Params: { id: string; field: ProfileField }; Body: DecisionInput }>,
    ) {
      return useCases.decideProfileField(getAuthUser(request), request.params.id, request.params.field, request.body);
    },

    async createResult(
      request: FastifyRequest<{ Params: { id: string }; Body: CreateResultInput }>,
      reply: FastifyReply,
    ) {
      const result = await useCases.createResult(getAuthUser(request), request.params.id, request.body);
      return reply.status(201).send(result);
    },

    async updateResult(
      request: FastifyRequest<{ Params: { id: string; resultId: string }; Body: UpdateResultInput }>,
    ) {
      return useCases.updateResult(getAuthUser(request), request.params.id, request.params.resultId, request.body);
    },

    async decideResult(
      request: FastifyRequest<{ Params: { id: string; resultId: string }; Body: DecisionInput }>,
    ) {
      return useCases.decideResult(getAuthUser(request), request.params.id, request.params.resultId, request.body);
    },

    async registerResultEvidence(
      request: FastifyRequest<{ Params: { id: string; resultId: string }; Body: { title: string; url: string } }>,
      reply: FastifyReply,
    ) {
      const evidence = await useCases.registerResultEvidence(
        getAuthUser(request),
        request.params.id,
        request.params.resultId,
        request.body,
      );
      return reply.status(201).send(evidence);
    },

    async archiveResult(
      request: FastifyRequest<{ Params: { id: string; resultId: string } }>,
      reply: FastifyReply,
    ) {
      await useCases.archiveResult(getAuthUser(request), request.params.id, request.params.resultId);
      return reply.status(204).send();
    },

    async setHighlight(request: FastifyRequest<{ Params: { id: string; milestoneId: string } }>) {
      return useCases.setHighlight(getAuthUser(request), request.params.id, request.params.milestoneId);
    },

    async removeHighlight(
      request: FastifyRequest<{ Params: { id: string; milestoneId: string } }>,
      reply: FastifyReply,
    ) {
      await useCases.removeHighlight(getAuthUser(request), request.params.id, request.params.milestoneId);
      return reply.status(204).send();
    },
  };
}

export type InstitutionalController = ReturnType<typeof makeInstitutionalController>;
