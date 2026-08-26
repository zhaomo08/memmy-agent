/** Types module. */
import type {
  AddMemoryInput,
  AddMemoryOutput,
  CloseSessionInput,
  CloseSessionOutput,
  DeleteMemoryInput,
  DeleteMemoryOutput,
  DeletePanelTaskOutput,
  CompleteTurnInput,
  CompleteTurnOutput,
  EnqueueImportSummariesOutput,
  GetMemoryOutput,
  MemoryApiLogsInput,
  MemoryApiLogsOutput,
  MemoryHealthSnapshot,
  MemoryProcessingStatusOutput,
  MemoryReloadConfigInput,
  MemoryReloadConfigOutput,
  RecallEvidenceOutput,
  PanelAnalysisOutput,
  PanelItemsInput,
  PanelItemsOutput,
  PanelProjectsOutput,
  PanelOverviewOutput,
  PanelTasksInput,
  PanelTasksOutput,
  OpenSessionInput,
  OpenSessionOutput,
  SearchInput,
  SearchOutput,
  StartTurnInput,
  StartTurnOutput,
  RetryMemoryProcessingOutput,
  WorkerRunOutput
} from "@memmy/local-api-contracts";

/** Per-request metadata forwarded to the Memory service. */
export interface MemoryRequestContext {
  timeZone?: string;
}

/** Contract for memory client. */
export interface MemoryClient {
  health(): Promise<MemoryHealthSnapshot>;
  reloadConfig(input?: MemoryReloadConfigInput): Promise<MemoryReloadConfigOutput>;

  openSession(input: OpenSessionInput): Promise<OpenSessionOutput>;
  closeSession(input: CloseSessionInput & { sessionId: string }): Promise<CloseSessionOutput>;

  startTurn(input: StartTurnInput): Promise<StartTurnOutput>;
  completeTurn(input: CompleteTurnInput & { turnId: string }): Promise<CompleteTurnOutput>;

  search(input: SearchInput, context?: MemoryRequestContext): Promise<SearchOutput>;
  addMemory(input: AddMemoryInput, context?: MemoryRequestContext): Promise<AddMemoryOutput>;
  getMemory(input: { memoryId: string }, context?: MemoryRequestContext): Promise<GetMemoryOutput>;
  deleteMemory(input: DeleteMemoryInput & { memoryId: string }, context?: MemoryRequestContext): Promise<DeleteMemoryOutput>;
  recallEvidence(queryId: string, context?: MemoryRequestContext): Promise<RecallEvidenceOutput>;

  enqueueImportSummaries(memoryIds?: string[]): Promise<EnqueueImportSummariesOutput>;
  getMemoryProcessingStatus(memoryIds: string[]): Promise<MemoryProcessingStatusOutput>;
  retryMemoryProcessing(memoryId: string): Promise<RetryMemoryProcessingOutput>;
  runWorker(input: {
    limit: number;
    targetMemoryIds?: string[];
    priorityCohortOnly?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<WorkerRunOutput>;

  panelOverview(): Promise<PanelOverviewOutput>;
  panelAnalysis(): Promise<PanelAnalysisOutput>;
  panelItems(input: PanelItemsInput): Promise<PanelItemsOutput>;
  panelProjects(): Promise<PanelProjectsOutput>;
  panelTasks(input: PanelTasksInput): Promise<PanelTasksOutput>;
  deletePanelTask(taskId: string): Promise<DeletePanelTaskOutput>;
  memoryApiLogs(input: MemoryApiLogsInput): Promise<MemoryApiLogsOutput>;
}
