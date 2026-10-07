/** Agent skills module. */
import {
  SkillFreezeDtoSchema,
  SkillPromoteDtoSchema,
  SkillPromoteRequestSchema,
  SkillReconcileDtoSchema,
  SkillStatusDtoSchema
} from "@memmy/local-api-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withErrorEnvelope } from "../../../../services/error-envelope.js";
import type { BackendServices } from "../../../../services/index.js";

/** Contract for register agent skill routes options. */
export interface RegisterAgentSkillRoutesOptions {
  agentSkills: BackendServices["agentSkills"];
  memoryClient: BackendServices["memoryClient"];
  authenticateRuntimeToken: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/** Registers the read, reconcile and freeze routes for the shared skill ledger. */
export function registerAgentSkillRoutes(app: FastifyInstance, options: RegisterAgentSkillRoutesOptions): void {
  app.get(
    "/api/v1/agent-skills",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      return reply.send(SkillStatusDtoSchema.parse(await options.agentSkills.status()));
    })
  );

  app.post(
    "/api/v1/agent-skills/reconcile",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      return reply.send(SkillReconcileDtoSchema.parse(await options.agentSkills.reconcile()));
    })
  );

  app.post(
    "/api/v1/agent-skills/freeze",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      return reply.send(SkillFreezeDtoSchema.parse(await options.agentSkills.freeze()));
    })
  );

  // A skill Memmy distilled from experience stays inside Memmy until someone asks for it:
  // every skill in the shared library is loaded by both agents in every session.
  app.post(
    "/api/v1/agent-skills/promote",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (request, reply) => {
      const input = SkillPromoteRequestSchema.parse(request.body);
      const { item } = await options.memoryClient.getMemory({ memoryId: input.memoryId });
      if (!item.skill) {
        throw new Error(`memory ${input.memoryId} is not a skill`);
      }
      const published = await options.agentSkills.publish({
        name: input.name ?? item.title ?? "",
        description: item.skill.retrievalBlurb ?? item.summary ?? "",
        body: item.skill.invocationGuide,
        why: `Promoted from Memmy skill memory ${input.memoryId}`
      });
      return reply.send(SkillPromoteDtoSchema.parse(published));
    })
  );
}
