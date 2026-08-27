import type { AppStateStore } from "../infrastructure/app-state-store/index.js";
import {
  mapModelProtocol,
  resolveMemmyAccountApiBase,
  type MemmyConfigWriter
} from "../infrastructure/memmy-config/index.js";
import type { AgentAdapterRegistry } from "../adapters/outbound/agent-adapter/index.js";
import { createBuiltinOnboardingInsightSamplers } from "../adapters/outbound/agent-source/onboarding-insight-samplers.js";
import type { SourceRegistry } from "../adapters/outbound/agent-source/source-registry.js";
import { agentInstructionsTargetsFrom, createAgentRuleWriter, type AgentRuleWriter } from "../adapters/outbound/agent-rules/index.js";
import { createSkillReconciler, type SkillReconciler } from "../adapters/outbound/agent-skills/index.js";
import { createClaudeCodeSkillTarget } from "../adapters/outbound/skill-writer/claude-code/index.js";
import { createCodexSkillTarget } from "../adapters/outbound/skill-writer/codex/index.js";
import { createSkillTargetRegistry, type SkillTargetRegistry } from "../adapters/outbound/skill-writer/target-registry.js";
import { MEMMY_SKILL_DIRECTORY_NAME } from "../adapters/outbound/skill-writer/templates/memmy-skill-directory.js";
import type { CloudClient } from "../adapters/outbound/cloud-client/index.js";
import type { MemoryClient } from "../adapters/outbound/memory-client/index.js";
import type { PermissionManager } from "../permission/index.js";
import {
  createAgentSourceLifecycleAnalytics,
  resolveLoggedInAnalyticsUserId,
} from "../analytics/agent-source-analytics.js";
import { createAgentSourceService, type AgentSourceService } from "./agent-source-service.js";
import { createAgentSourceAutoInjectService, type AgentSourceAutoInjectService } from "./agent-source-auto-inject-service.js";
import { createBuiltinAgentSourceRegistry } from "./builtin-agent-source-registry.js";
import { createAppConfigService, type AppConfigService } from "./app-config-service.js";
import { createAccountService, type AccountService } from "./account-service.js";
import { createAsrService, type AsrService } from "./asr-service.js";
import { createTokenQuotaService, type TokenQuotaService } from "./token-quota-service.js";
import {
  createByokTokenUsageService,
  type ByokTokenUsageService
} from "./byok-token-usage-service.js";
import {
  createBootstrapService,
  type BootstrapScenario,
  type BootstrapService
} from "./bootstrap-service.js";
import { createIntegrationService, type IntegrationService } from "./integration-service.js";
import { createIngestionService, type IngestionService } from "./ingestion-service.js";
import { createLocalDataService, type LocalDataService } from "./local-data-service.js";
import { createMemoryDetailService, type MemoryDetailService } from "./memory-detail-service.js";
import {
  createOnboardingInsightService,
  type OnboardingInsightAgentTaskModelResolver,
  type OnboardingInsightService
} from "./onboarding-insight-service.js";
import { createPanelService, type PanelService } from "./panel-service.js";
import { createProgressBus, type ProgressBus } from "./progress-bus.js";
import { createSearchService, type SearchService } from "./search-service.js";
import { createSessionService, type SessionService } from "./session-service.js";
import {
  createSkillDistributionService,
  type SkillDistributionService
} from "./skill-distribution-service.js";
import { createTurnService, type TurnService } from "./turn-service.js";

export interface BackendServices {
  memoryClient: MemoryClient;
  agentAdapterRegistry: AgentAdapterRegistry;
  bootstrap: BootstrapService;
  appConfig: AppConfigService;
  account: AccountService;
  /** Integrations. */
  integrations: IntegrationService;
  localData: LocalDataService;
  /** Keeps every agent's instructions file in step with ~/.memmy/agent-rules. */
  agentRules: AgentRuleWriter;
  /** Measures the shared skill library against each agent's skills directory. */
  agentSkills: SkillReconciler;
  agentSources: AgentSourceService;
  agentSourceAutoInject: AgentSourceAutoInjectService;
  onboardingInsight: OnboardingInsightService;
  progressBus: ProgressBus;
  session: SessionService;
  turn: TurnService;
  search: SearchService;
  memoryDetail: MemoryDetailService;
  panel: PanelService;
  byokTokenUsage: ByokTokenUsageService;
  /** Asr. */
  asr: AsrService;
  /** Token quota. */
  tokenQuota: TokenQuotaService;
}

export interface CreateBackendServicesOptions {
  appStateStore: AppStateStore;
  agentAdapterRegistry: AgentAdapterRegistry;
  memoryClient: MemoryClient;
  cloudClient: CloudClient;
  permissionManager: PermissionManager;
  bootstrapScenario?: BootstrapScenario;
  sourceRegistry?: SourceRegistry;
  ingestionService?: IngestionService;
  skillDistributionService?: SkillDistributionService;
  skillTargetRegistry?: SkillTargetRegistry;
  progressBus?: ProgressBus;
  /** Memmy config writer. */
  memmyConfigWriter?: MemmyConfigWriter;
  /** Memmy config path. */
  memmyConfigPath?: string;
}

export function createBackendServices(options: CreateBackendServicesOptions): BackendServices {
  const progressBus = options.progressBus ?? createProgressBus();
  const sourceRegistry =
    options.sourceRegistry ??
    createBuiltinAgentSourceRegistry();
  const ingestionService =
    options.ingestionService ??
    createIngestionService({
      memoryClient: options.memoryClient,
      agentSourceRepository: options.appStateStore.repositories.agentSources
    });
  const skillTargetRegistry =
    options.skillTargetRegistry ??
    createSkillTargetRegistry([
      createClaudeCodeSkillTarget({ memmyConfigPath: options.memmyConfigPath }),
      createCodexSkillTarget({ memmyConfigPath: options.memmyConfigPath })
    ]);
  const skillDistributionService =
    options.skillDistributionService ??
    createSkillDistributionService({
      targetRegistry: skillTargetRegistry
    });
  const accountSessionRepository = options.appStateStore.repositories.accountSession;
  const agentSources = createAgentSourceService({
    sourceRegistry,
    agentSourceRepository: options.appStateStore.repositories.agentSources,
    ingestionService,
    memoryClient: options.memoryClient,
    skillDistributionService,
    getScanPermission: () => options.permissionManager.getScanPermission(),
    agentSourceAnalytics: createAgentSourceLifecycleAnalytics({
      getUserId: () => {
        const session = accountSessionRepository.get();
        if (!session.authenticated) return null;
        return resolveLoggedInAnalyticsUserId({
          cloudUuid: accountSessionRepository.getCloudUuid(),
          userId: session.profile.userId,
        });
      },
      getUserMode: () => {
        const mode = options.appStateStore.repositories.bootstrap.getAppSettings().userMode;
        return mode === "account" || mode === "byok" ? mode : null;
      },
    }),
  });

  return {
    memoryClient: options.memoryClient,
    agentAdapterRegistry: options.agentAdapterRegistry,
    bootstrap: createBootstrapService(options),
    appConfig: createAppConfigService({
      bootstrapRepository: options.appStateStore.repositories.bootstrap,
      modelConfigRepository: options.appStateStore.repositories.modelConfig,
      cloudClient: options.cloudClient,
      accountSessionRepository: options.appStateStore.repositories.accountSession,
      memmyConfigWriter: options.memmyConfigWriter,
      memoryClient: options.memoryClient
    }),
    account: createAccountService({
      cloudClient: options.cloudClient,
      accountSessionRepository: options.appStateStore.repositories.accountSession,
      memmyConfigWriter: options.memmyConfigWriter,
      memoryClient: options.memoryClient
    }),
    integrations: createIntegrationService({
      cloudClient: options.cloudClient,
      composioMachineTokenRepository: options.appStateStore.repositories.composioMachineToken
    }),
    localData: createLocalDataService({
      localDataStore: options.appStateStore.localDataStore
    }),
    agentSources,
    agentRules: createAgentRuleWriter({ targets: agentInstructionsTargetsFrom(skillTargetRegistry.list()) }),
    // The reconciler and the skill distributor both write into <agent>/skills. Only the
    // distributor owns memmy-memory, so the ledger is told to observe it and stay out of it.
    agentSkills: createSkillReconciler({
      targets: skillTargetRegistry.list(),
      managedNames: [MEMMY_SKILL_DIRECTORY_NAME]
    }),
    agentSourceAutoInject: createAgentSourceAutoInjectService({
      agentSources,
      permissionManager: options.permissionManager,
      getScanPreferences: () => options.appStateStore.repositories.bootstrap.getScanPreferences()
    }),
    onboardingInsight: createOnboardingInsightService({
      samplers: createBuiltinOnboardingInsightSamplers(),
      agentModelResolver: createAppStateAgentTaskModelResolver(options.appStateStore)
    }),
    progressBus,
    session: createSessionService({
      memoryClient: options.memoryClient,
      idempotencyStore: options.appStateStore.repositories.idempotency
    }),
    turn: createTurnService({
      memoryClient: options.memoryClient,
      idempotencyStore: options.appStateStore.repositories.idempotency
    }),
    search: createSearchService({
      memoryClient: options.memoryClient
    }),
    memoryDetail: createMemoryDetailService({
      memoryClient: options.memoryClient
    }),
    panel: createPanelService({
      memoryClient: options.memoryClient
    }),
    byokTokenUsage: createByokTokenUsageService({
      repository: options.appStateStore.repositories.byokTokenUsage
    }),
    asr: createAsrService({
      bootstrapRepository: options.appStateStore.repositories.bootstrap,
      accountSessionRepository: options.appStateStore.repositories.accountSession,
      modelConfigRepository: options.appStateStore.repositories.modelConfig,
      cloudClient: options.cloudClient
    }),
    tokenQuota: createTokenQuotaService({
      cloudClient: options.cloudClient,
      accountSessionRepository: options.appStateStore.repositories.accountSession
    })
  };
}

export { createBootstrapService };
export type { BootstrapScenario, BootstrapService };

const MEMMY_ACCOUNT_PROVIDER = "memmy_account";
const MEMMY_ACCOUNT_MODEL = "agent_chat";

function createAppStateAgentTaskModelResolver(appStateStore: AppStateStore): OnboardingInsightAgentTaskModelResolver {
  const { bootstrap, accountSession, modelConfig } = appStateStore.repositories;

  return {
    getAgentTaskModel() {
      const userMode = bootstrap.getAppSettings().userMode;
      if (userMode === "account") {
        const cloudUuid = accountSession.getCloudUuid();
        if (!cloudUuid) {
          return null;
        }
        return {
          providerName: MEMMY_ACCOUNT_PROVIDER,
          model: MEMMY_ACCOUNT_MODEL,
          apiBase: resolveMemmyAccountApiBase(),
          apiKey: cloudUuid
        };
      }

      if (userMode !== "byok") {
        return null;
      }

      const config = modelConfig.get();
      const apiKey = modelConfig.getTestApiKey?.("primary");
      if (!apiKey) {
        return null;
      }
      const projection = mapModelProtocol(config.provider);
      return {
        providerName: projection.agentProvider,
        model: config.modelId,
        apiBase: config.baseUrl,
        apiKey,
        apiType: projection.agentApiType
      };
    }
  };
}
