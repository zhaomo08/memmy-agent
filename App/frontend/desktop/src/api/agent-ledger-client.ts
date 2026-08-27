import {
  AgentRuleApplyDtoSchema,
  AgentRuleStatusDtoSchema,
  SkillFreezeDtoSchema,
  SkillReconcileDtoSchema,
  SkillStatusDtoSchema,
  type AgentRuleApplyDto,
  type AgentRuleStatusDto,
  type RuntimeConfig,
  type SkillFreezeDto,
  type SkillReconcileDto,
  type SkillStatusDto
} from "@memmy/local-api-contracts";
import { requestJson } from "./http.js";

/**
 * Reads and acts on the two ledgers that keep every agent in step: the standing rules
 * rendered into each agent's instructions file, and the shared skill library mounted
 * into each agent's skills directory.
 */
export interface AgentLedgerClient {
  /** Reads rule state. Changes nothing. */
  getRuleStatus(): Promise<AgentRuleStatusDto>;
  /** Rewrites each agent's rule blocks from the shared source. */
  applyRules(): Promise<AgentRuleApplyDto>;
  /** Reads skill state. Changes nothing. */
  getSkillStatus(): Promise<SkillStatusDto>;
  /** Creates declared-but-absent links and removes undeclared ones. Never touches real directories. */
  reconcileSkills(): Promise<SkillReconcileDto>;
  /** Records the current layout as the declared intent. */
  freezeSkills(): Promise<SkillFreezeDto>;
}

export function createHttpAgentLedgerClient(config: RuntimeConfig): AgentLedgerClient {
  return {
    async getRuleStatus() {
      return requestJson({ config, path: "/api/v1/agent-rules", schema: AgentRuleStatusDtoSchema });
    },

    async applyRules() {
      return requestJson({ config, path: "/api/v1/agent-rules/apply", schema: AgentRuleApplyDtoSchema, body: {} });
    },

    async getSkillStatus() {
      return requestJson({ config, path: "/api/v1/agent-skills", schema: SkillStatusDtoSchema });
    },

    async reconcileSkills() {
      return requestJson({ config, path: "/api/v1/agent-skills/reconcile", schema: SkillReconcileDtoSchema, body: {} });
    },

    async freezeSkills() {
      return requestJson({ config, path: "/api/v1/agent-skills/freeze", schema: SkillFreezeDtoSchema, body: {} });
    }
  };
}
