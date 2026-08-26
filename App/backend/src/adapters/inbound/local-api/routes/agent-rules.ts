/** Agent rules module. */
import { AgentRuleApplyDtoSchema, AgentRuleStatusDtoSchema } from "@memmy/local-api-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveAgentRulesDirectory } from "../../../outbound/agent-rules/index.js";
import type { AgentRuleWriter } from "../../../outbound/agent-rules/index.js";
import { withErrorEnvelope } from "../../../../services/error-envelope.js";

/** Contract for register agent rule routes options. */
export interface RegisterAgentRuleRoutesOptions {
  agentRules: AgentRuleWriter;
  authenticateRuntimeToken: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/** Registers the read and apply routes for shared agent instruction rules. */
export function registerAgentRuleRoutes(app: FastifyInstance, options: RegisterAgentRuleRoutesOptions): void {
  app.get(
    "/api/v1/agent-rules",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      const status = await options.agentRules.status();
      return reply.send(AgentRuleStatusDtoSchema.parse({ rulesDirectory: resolveAgentRulesDirectory(), ...status }));
    })
  );

  app.post(
    "/api/v1/agent-rules/apply",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      return reply.send(AgentRuleApplyDtoSchema.parse(await options.agentRules.apply()));
    })
  );
}
