# `memmy-memory timeline`

Intent map:
- see what was going on around a search hit -> `memmy-memory timeline <id>`;
- find the turns that led up to, or followed, a remembered decision -> `memmy-memory timeline <id> --before 5 --after 5`.

Use this command when:
- a concrete memory id is available from `search` or `get`;
- one hit is not enough and the surrounding turns of the same session would explain it.

API shape:
- endpoint: `GET /memory/:id/timeline`;
- returns the traces recorded in the same session, oldest first, each with `id`, `at`, `summary`, and `anchor: true` on the one asked about;
- `--before` and `--after` default to 3 and are capped at 20;
- a memory with no session returns only itself.

Do not use this command to:
- search without an id;
- read full content -- follow up with `memmy-memory get <id>` on the items that matter.

Command:

```bash
memmy-memory timeline <id>
```

Common flags:

- `--id <id>`
- `--before <n>`
- `--after <n>`
