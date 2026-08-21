# @memmy/backend

The local backend used by the Memmy desktop application. It owns the
ephemeral local API, application state, agent-history ingestion, Memory service
integration, and installation of agent-side Memory skills and hooks.

## Development

Run backend commands from the repository root:

```bash
npm run build -w @memmy/backend
npm run typecheck -w @memmy/backend
npm run lint -w @memmy/backend
npm run test -w @memmy/backend
```

Apply application-state migrations with:

```bash
npm run db:migrate
```

## Architecture

- `adapters/inbound/local-api`: Fastify routes, runtime-token authentication,
  CORS, SSE, and the Composio MCP bridge.
- `adapters/outbound/agent-source`: built-in history readers for Claude Code
  and Codex.
- `adapters/outbound/skill-writer`: Memory skill, hook, command, and plugin
  installation for the supported agents.
- `adapters/outbound/agent-adapter`: manifest, loader, and registry contracts
  for runtime-supplied agent adapters.
- `adapters/outbound/memory-client`: HTTP Memory Layer and local Memmy SQLite
  clients.
- `adapters/outbound/cloud-client`: account, integration, and hosted-service
  requests.
- `infrastructure/app-state-store`: local application state, secrets,
  repositories, and migrations.
- `infrastructure/agent-source-store`: source metadata and ingestion
  deduplication.
- `infrastructure/idempotency-store`: persisted idempotency records for runtime
  operations.
- `infrastructure/memmy-config`: reads and updates the shared Memmy
  configuration.
- `services`: orchestration for bootstrap, account state, ingestion, scans,
  runtime memory operations, skill distribution, integrations, and progress
  events.

## Desktop Runtime

The backend binds its local API to `127.0.0.1` on an ephemeral port. At startup
it writes `~/.memmy/runtime.json` with owner-only permissions. That file
contains the local API URL, runtime token, and optional Memory service URL used
by desktop clients.

The backend also writes the Composio MCP bridge URL and its dedicated token to
`tools.mcpServers.composio` in the shared Memmy configuration.

`infrastructure/cli-binary/installer.ts` can symlink a built `memmy` executable
to `~/.local/bin/memmy`. Packaging or another caller must invoke the installer;
backend startup does not install the symlink automatically.

## Local API

`GET /api/health` is the only unauthenticated local API route. Other `/api/*`
routes require the `x-memmy-local-token` header, with two transport-specific
exceptions:

- `GET /api/events` accepts the same runtime token as `?token=` because browser
  `EventSource` cannot reliably send custom headers.
- `/mcp/composio` uses its dedicated `x-memmy-mcp-token`.

The local API is grouped into these route families:

- Application bootstrap, settings, onboarding, account, quota, and local data
- Claude Code and Codex source discovery, scanning, skills, and hooks
- External tool integrations
- BYOK token usage and speech transcription
- Agent Runtime memory, session, turn, and panel routes

### Agent Runtime Routes

Every route in this table requires the local runtime token.

| Method   | Path                                  | Primary service                          |
| -------- | ------------------------------------- | ---------------------------------------- |
| `POST`   | `/api/v1/admin/reload-config`         | `MemoryClient.reloadConfig`              |
| `GET`    | `/api/v1/health`                      | `MemoryClient.health`                    |
| `POST`   | `/api/v1/sessions/open`               | `SessionService.open`                    |
| `POST`   | `/api/v1/sessions/:sessionId/close`   | `SessionService.close`                   |
| `POST`   | `/api/v1/turns/start`                 | `TurnService.start`                      |
| `POST`   | `/api/v1/turns/:turnId/complete`      | `TurnService.complete`                   |
| `POST`   | `/api/v1/memory/search`               | `SearchService.search`                   |
| `POST`   | `/api/v1/memory/add`                  | `MemoryDetailService.add`                |
| `GET`    | `/api/v1/memory/logs`                 | `PanelService.memoryApiLogs`             |
| `POST`   | `/api/v1/memory/processing/status`    | `MemoryClient.getMemoryProcessingStatus` |
| `POST`   | `/api/v1/memory/:id/processing/retry` | `MemoryClient.retryMemoryProcessing`     |
| `GET`    | `/api/v1/memory/:id`                  | `MemoryDetailService.getById`            |
| `DELETE` | `/api/v1/memory/:id`                  | `MemoryDetailService.delete`             |
| `GET`    | `/api/v1/panel/overview`              | `PanelService.overview`                  |
| `GET`    | `/api/v1/panel/analysis`              | `PanelService.analysis`                  |
| `GET`    | `/api/v1/panel/items`                 | `PanelService.items`                     |
| `GET`    | `/api/v1/panel/tasks`                 | `PanelService.tasks`                     |
| `DELETE` | `/api/v1/panel/tasks/:id`             | `PanelService.deleteTask`                |

## Built-in Agent Integrations

| Agent       | Default history source                         | Installed Memory integration                                                 |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/**/*.jsonl`                | `~/.claude/CLAUDE.md`, `skills/memmy-memory/`, hooks, and the resume command |
| Codex       | `~/.codex/sessions/**/rollout-*.jsonl`         | `~/.codex/AGENTS.md`, `skills/memmy-memory/`, and hooks                      |

Agent roots can be overridden with `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.

## Memory Layer Configuration

| Variable                         | Default | Description                                                                                                                                                             |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEMMY_MEMORY_LAYER_URL`         | Empty   | Memory Layer base URL, such as `http://127.0.0.1:18960`. When empty, the backend discovers a local Memmy SQLite database. Startup fails if neither source is available. |
| `MEMMY_MEMORY_LAYER_TOKEN`       | Empty   | Bearer token forwarded to the Memory Layer.                                                                                                                             |
| `MEMMY_MEMORY_LAYER_TIMEOUT_MS`  | `20000` | Per-request timeout in milliseconds.                                                                                                                                    |
| `MEMMY_MEMORY_LAYER_MAX_RETRIES` | `3`     | Maximum retries for network errors and 5xx responses.                                                                                                                   |
| `MEMMY_DISABLE_MEMOS_SQLITE`     | Empty   | Set to `1` to disable local SQLite discovery.                                                                                                                           |

## SSE Events

- `app.connected`: emitted when the SSE stream opens.
- `app.heartbeat`: periodic connection heartbeat.
- `agent_source.scan_progress`: source-scan progress.
- `agent_source.scan_completed`: source-scan completion summary.
