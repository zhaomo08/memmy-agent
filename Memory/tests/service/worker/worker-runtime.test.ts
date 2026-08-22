import { afterEach, describe, expect, it } from "vitest";
import { Repositories } from "../../../src/storage/repositories.js";
import {
  createCapturingEmbedder,
  createMemoryServiceFixture
} from "../../fixtures/memory-service-fixture.js";

const {
  cleanup: cleanupMemoryServiceFixture,
  createTestService
} = createMemoryServiceFixture();

afterEach(() => {
  cleanupMemoryServiceFixture();
});

describe("MemoryService / worker / runtime", () => {
  it("settles queued embedding work when its memory was deliberately deleted", async () => {
    const seenTexts: string[] = [];
    const { db, service } = createTestService({
      embedder: createCapturingEmbedder(seenTexts)
    });
    const repos = new Repositories(db.db);
    const at = new Date().toISOString();
    const memoryId = "policy-deleted-before-embedding";
    const jobId = "job-deleted-before-embedding";
    const retryId = "retry-deleted-before-embedding";

    repos.memories.insert({
      id: memoryId,
      timeline: at,
      userId: "deleted-target-user",
      memoryType: "LongTermMemory",
      status: "activated",
      visibility: "private",
      memoryKey: "policy:deleted-before-embedding",
      memoryValue: "Deleted memories must not leave failing embedding jobs.",
      tags: ["worker", "deletion"],
      info: {},
      properties: {
        internal_info: {
          memory_layer: "L2",
          memory_kind: "policy"
        }
      },
      memoryLayer: "L2",
      version: 1,
      createdAt: at,
      updatedAt: at
    });
    repos.runtime.enqueueJob({
      id: jobId,
      jobType: "embedding",
      status: "queued",
      userId: "deleted-target-user",
      targetMemoryId: memoryId,
      payload: {},
      attempts: 0,
      maxAttempts: 3,
      createdAt: at,
      updatedAt: at
    });
    repos.runtime.enqueueEmbeddingRetry({
      id: retryId,
      targetKind: "policy",
      targetId: memoryId,
      vectorField: "vec",
      sourceText: "Deleted memories must not leave failing embedding retries."
    });

    service.deleteMemory(memoryId, {
      namespace: { source: "codex", userId: "deleted-target-user", profileId: "default" }
    });
    expect(repos.processing.get(memoryId)).toBeUndefined();
    const run = await service.runWorkerOnce(10, { targetMemoryIds: [memoryId] });

    expect(run.jobs).toEqual([
      expect.objectContaining({ jobId, status: "succeeded" })
    ]);
    expect(run.embeddingRetries).toMatchObject({
      leased: 1,
      succeeded: 1,
      failed: 0
    });
    expect(seenTexts).toEqual([]);
    expect(db.db.prepare(
      `SELECT status, last_error FROM evolution_jobs WHERE id = ?`
    ).get(jobId)).toEqual({ status: "succeeded", last_error: null });
    expect(db.db.prepare(
      `SELECT status, last_error FROM embedding_retry_queue WHERE id = ?`
    ).get(retryId)).toEqual({ status: "succeeded", last_error: null });

    db.db.prepare(
      `UPDATE evolution_jobs
       SET status = 'dead_letter', last_error = 'legacy deleted-target failure'
       WHERE id = ?`
    ).run(jobId);
    service.reconcileWorkerStartup();
    expect(db.db.prepare(
      `SELECT status, last_error FROM evolution_jobs WHERE id = ?`
    ).get(jobId)).toEqual({ status: "succeeded", last_error: null });

    db.close();
  });

  it("settles a queued user-memory embedding after the user memory is deleted", async () => {
    const { db, service } = createTestService();
    const repos = new Repositories(db.db);
    const at = new Date().toISOString();
    const memoryId = "user-memory-deleted-before-embedding";
    const jobId = "job-user-memory-deleted-before-embedding";

    repos.userMemories.insert({
      id: memoryId,
      sourceTurnId: "turn-deleted-before-embedding",
      userId: "deleted-user-memory-owner",
      memoryTypes: ["User Preference"],
      content: "Prefer concise implementations.",
      normalizedUserTextHash: "deleted-user-memory-hash",
      sourceTurnRefs: ["turn-deleted-before-embedding"],
      status: "active",
      createdAt: at,
      updatedAt: at
    });
    repos.runtime.enqueueJob({
      id: jobId,
      jobType: "user_memory_embedding",
      status: "queued",
      userId: "deleted-user-memory-owner",
      targetMemoryId: memoryId,
      payload: {},
      attempts: 0,
      maxAttempts: 3,
      createdAt: at,
      updatedAt: at
    });

    service.deleteMemory(memoryId, {
      namespace: { source: "claude-code", userId: "deleted-user-memory-owner", profileId: "default" }
    });
    const run = await service.runWorkerOnce(1, { targetMemoryIds: [memoryId] });

    expect(run.jobs).toEqual([
      expect.objectContaining({ jobId, status: "succeeded" })
    ]);
    expect(db.db.prepare(
      `SELECT status, last_error FROM evolution_jobs WHERE id = ?`
    ).get(jobId)).toEqual({ status: "succeeded", last_error: null });

    db.close();
  });

  it("selects the earliest worker wake across evolution and embedding queues", () => {
    const { db, service } = createTestService();
    const repos = new Repositories(db.db);
    const base = Date.now() + 60_000;
    repos.runtime.enqueueJob({
      id: "job-future-worker-wake",
      jobType: "reward",
      status: "queued",
      userId: "worker-wake-user",
      payload: { runAfter: new Date(base + 3_000).toISOString() },
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(base).toISOString(),
      updatedAt: new Date(base).toISOString()
    });
    repos.runtime.enqueueEmbeddingRetry({
      id: "retry-pending-worker-wake",
      targetKind: "trace",
      targetId: "trace-pending-worker-wake",
      vectorField: "vec_summary",
      sourceText: "pending embedding wake",
      now: base + 2_000
    });
    const inProgress = repos.runtime.enqueueEmbeddingRetry({
      id: "retry-in-progress-worker-wake",
      targetKind: "trace",
      targetId: "trace-in-progress-worker-wake",
      vectorField: "vec_summary",
      sourceText: "in-progress embedding wake",
      now: base
    });
    db.db.prepare(
      `UPDATE embedding_retry_queue
       SET status = 'in_progress',
           claimed_by = 'previous-worker',
           lease_until = ?
       WHERE id = ?`
    ).run(base + 1_000, inProgress.id);

    expect(service.nextWorkerRunAt()).toBe(base + 1_000);

    db.close();
  });

  it("retries expired leased evolution jobs", async () => {
    const { db, service } = createTestService();
    const session = service.openSession({
      namespace: {
        source: "codex",
        profileId: "jiang",
        userId: "user-expired-job"
      }
    });
    const complete = service.completeTurn("turn-expired-job", {
      sessionId: session.sessionId,
      query: "recover an expired worker lease",
      answer: "the expired lease should be picked up by the next worker run"
    });
    const old = new Date(Date.now() - 120_000).toISOString();
    const jobId = "job_expired_lease";
    db.db.prepare(
      `INSERT INTO evolution_jobs (
        id, job_type, status, user_id, session_id, episode_id, target_memory_id,
        payload_json, attempts, max_attempts, leased_until, last_error, created_at, updated_at
      ) VALUES (?, 'reflection', 'leased', ?, ?, ?, ?, '{}', 1, 3, ?, NULL, ?, ?)`
    ).run(jobId, "user-expired-job", session.sessionId, complete.episodeId, complete.l1MemoryId, old, old, old);

    const run = await service.runWorkerOnce(10);
    expect(run.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobId,
        jobType: "reflection",
        status: "succeeded"
      })
    ]));
    const row = db.db.prepare(
      `SELECT status, attempts, leased_until
       FROM evolution_jobs
       WHERE id = ?`
    ).get(jobId) as {
      status: string;
      attempts: number;
      leased_until: string | null;
    };
    expect(row.status).toBe("succeeded");
    expect(row.attempts).toBe(2);
    expect(row.leased_until).toBeNull();

    db.close();
  });

  it("persists retryable worker failures before requeueing them on the next tick", async () => {
    const { db, service } = createTestService();
    const jobId = "job_retryable_failure";
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    db.db.prepare(
      `INSERT INTO evolution_jobs (
        id, job_type, status, user_id, session_id, episode_id, target_memory_id,
        payload_json, attempts, max_attempts, leased_until, last_error, created_at, updated_at
      ) VALUES (?, 'unsupported_job_type', 'queued', 'user-job-state', NULL, NULL, NULL, '{}', 0, 3, NULL, NULL, ?, ?)`
    ).run(jobId, createdAt, createdAt);

    const firstRun = await service.runWorkerOnce(1);
    expect(firstRun.jobs).toEqual([
      expect.objectContaining({
        jobId,
        status: "failed"
      })
    ]);
    const failedRow = db.db.prepare(
      `SELECT status, attempts, leased_until, last_error
       FROM evolution_jobs
       WHERE id = ?`
    ).get(jobId) as {
      status: string;
      attempts: number;
      leased_until: string | null;
      last_error: string | null;
    };
    expect(failedRow.status).toBe("failed");
    expect(failedRow.attempts).toBe(1);
    expect(failedRow.leased_until).toBeNull();
    expect(failedRow.last_error).toContain("unsupported job type");

    const secondRun = await service.runWorkerOnce(1);
    expect(secondRun.jobs).toEqual([
      expect.objectContaining({
        jobId,
        status: "failed"
      })
    ]);
    const retriedRow = db.db.prepare(
      `SELECT status, attempts, leased_until
       FROM evolution_jobs
       WHERE id = ?`
    ).get(jobId) as {
      status: string;
      attempts: number;
      leased_until: string | null;
    };
    expect(retriedRow.status).toBe("failed");
    expect(retriedRow.attempts).toBe(2);
    expect(retriedRow.leased_until).toBeNull();
    const ops = db.db.prepare(
      `SELECT op
       FROM memory_change_log
       WHERE entity_id = ?
       ORDER BY seq ASC`
    ).all(jobId) as Array<{ op: string }>;
    expect(ops.map((row) => row.op)).toEqual(["leased", "failed", "queued", "leased", "failed"]);

    db.close();
  });

  it("moves terminal worker failures to dead letter", async () => {
    const { db, service } = createTestService();
    const jobId = "job_terminal_failure";
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    db.db.prepare(
      `INSERT INTO evolution_jobs (
        id, job_type, status, user_id, session_id, episode_id, target_memory_id,
        payload_json, attempts, max_attempts, leased_until, last_error, created_at, updated_at
      ) VALUES (?, 'unsupported_job_type', 'queued', 'user-job-state', NULL, NULL, NULL, '{}', 0, 1, NULL, NULL, ?, ?)`
    ).run(jobId, createdAt, createdAt);

    const run = await service.runWorkerOnce(1);
    expect(run.jobs).toEqual([
      expect.objectContaining({
        jobId,
        status: "dead_letter"
      })
    ]);
    const row = db.db.prepare(
      `SELECT status, attempts, leased_until, last_error
       FROM evolution_jobs
       WHERE id = ?`
    ).get(jobId) as {
      status: string;
      attempts: number;
      leased_until: string | null;
      last_error: string | null;
    };
    expect(row.status).toBe("dead_letter");
    expect(row.attempts).toBe(1);
    expect(row.leased_until).toBeNull();
    expect(row.last_error).toContain("unsupported job type");

    const ops = db.db.prepare(
      `SELECT op
       FROM memory_change_log
       WHERE entity_id = ?
       ORDER BY seq ASC`
    ).all(jobId) as Array<{ op: string }>;
    expect(ops.map((change) => change.op)).toEqual(["leased", "dead_letter"]);

    db.close();
  });
});
