/** Agent skills module. */
import { SkillFreezeDtoSchema, SkillReconcileDtoSchema, SkillStatusDtoSchema } from "@memmy/local-api-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withErrorEnvelope } from "../../../../services/error-envelope.js";
import type { BackendServices } from "../../../../services/index.js";

/** Contract for register agent skill routes options. */
export interface RegisterAgentSkillRoutesOptions {
  agentSkills: BackendServices["agentSkills"];
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
}
