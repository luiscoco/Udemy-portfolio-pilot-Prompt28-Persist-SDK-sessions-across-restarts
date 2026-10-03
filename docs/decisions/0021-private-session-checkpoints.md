# 0021. Private SDK completed-turn checkpoints

- Status: Accepted
- Date: 2026-10-03
- Milestone: 28

## Context

SDK 0.3.276 and its installed `sdk.d.ts` expose `Options.sessionStore`, `sessionStoreFlush`,
`SessionStore.append/load/listSubkeys`, and `importSessionToStore`. The latter copies an existing
local JSONL session into a store; it is not an archive export/import pair. There is no standalone
archive export API in this installed version. A session UUID and application ChatMessage rows do
not contain the runtime resume state.

## Required artifacts for this application

- The complete opaque main transcript entries, in order, including summaries/compaction chains,
  message UUID/parent links and runtime metadata. Do not reconstruct them from visible chat.
- Each mirrored subagent transcript under `subagents/agent-<id>`, discovered through `listSubkeys`.
  SDK `agent_metadata` entries are retained verbatim. Installed hydration code reconstructs their
  `.meta.json` sidecars alongside each subagent JSONL transcript.
- The app's current managed skills and policy/configuration, recreated from versioned source for
  every run. Model/runtime and instruction versions must match the binding before resume.

Without a store the CLI writes `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<session-id>.jsonl`,
plus `<session-id>/subagents/agent-<id>.jsonl` and subagent metadata sidecars when present. With our
store the supported SDK resume path materializes the saved entries to its own unique temporary
config directory before spawning the CLI and cleans that directory at query end. The worker gives
the run a separate private cwd/config workspace, created **after** acquiring the conversation lease.
The SDK receives this clean config directory as `options.env.CLAUDE_CONFIG_DIR`; it seeds its resume
directory from that directory, rather than personal credentials/settings. This temporary hydration
directory is SDK-managed under the OS temp root, not the worker's cwd.

This application disables auto-memory, file checkpointing and arbitrary filesystem tools. Therefore
no mutable `CLAUDE.md`, memory directory, file backups, downloads or working-directory artifacts are
needed for conversation continuity. API credentials are reinjected from server configuration; never
checkpoint credentials, `.claude.json`, settings or the whole home directory. App prompts already
present in the opaque SDK transcript remain part of that transcript; there is no separate prompt
archive. If a future feature permits workspace writes or file rewind, this artifact inventory must
be expanded before enabling it. The snapshot still contains sensitive SDK context and tool results;
it is never a browser DTO, log entry or public download.

## Decision

Use an attempt-local SDK `SessionStore` mirror and save its complete state only after the answer and
source validation succeed. Mirror errors fail the run. Fresh and resumed SDK batches enter the same
mirror; UUID duplicates are ignored independently per transcript, while non-UUID metadata keep their
append order. The immutable envelope has format/SDK versions, model/instruction, owner/conversation
hashes, timestamps, full transcripts and a 16 MiB cap. Mock envelopes are explicitly mode `mock`
and contain only deterministic mock memory, not fabricated SDK transcripts.

`SessionArtifactStore` has local and Azure Blob implementations. Object keys use independently hashed
authenticated owner/conversation scopes and unique timestamp/UUID versions. SHA-256 of exact saved
bytes lives in the PostgreSQL pointer and is checked before deserialization/restoration. Scopes and
session/config metadata are checked again. No mutable `latest` object exists. An upload is not a
published checkpoint: the current pointer, generation increment, completed answer, budget and
terminal events commit together under the live run/conversation fence. Failed, cancelled or stale
attempts cannot change it. A transaction failure leaves an orphan version, removed by retention.

Local storage creates directories/files with 0700/0600 and publishes a flushed temporary file with
an exclusive hard link, then flushes the parent on POSIX. Use a private persistent filesystem with
hard-link and fsync semantics. On Windows, Node mode bits do not set ACLs: the operator must restrict
the configured directory ACL to the worker identity, SYSTEM and administrators. Shared-user folders
and network shares without these guarantees are not supported persistent stores.

Azure uses authenticated HTTPS REST against an existing container, Entra workload identity with
token refresh, and `If-None-Match: *` block-blob creation. Container properties must show no anonymous
public access before each operation. No account keys, SAS generation or public download route.
Use container-scoped Storage Blob Data Contributor, disable account public access, encryption at
rest and private networking in the future deployment. This milestone provisions nothing.

## Retention and deletion

Snapshots expire 30 days after creation. Agent workers sweep hourly, including old orphan versions
and local partial-write files; expired pointers become missing and visibly summary-reseed. Immutable
objects older than the window are deleted even if a quiet conversation still references one.
`deleteConversation(authenticatedScope)` deletes all versions in exactly that scope. A future account
or conversation deletion flow must call it server-side; there is no such product deletion endpoint
in the current scope. Once no workers run, scheduled cleanup must continue externally. Configure a
30-day Azure lifecycle rule for the `sessions/v1/` prefix as a backstop; native versioning is not
required because each checkpoint has a new blob name. If soft delete/native versions are enabled,
set matching bounded retention for those copies too; deleting a base blob alone is not immediate
physical erasure. Database message retention is separate.

Normal exits clean the run cwd in `finally`; SDK closes its subprocess and hydration directory.
Marked local run directories left by abrupt process death are swept after 24 hours on subsequent
run setup. The scanner
does not delete unmarked directories or active workspaces. OS temp/pod ephemeral-volume cleanup
must cover SDK hydration directories abandoned by SIGKILL.

## Consequences and crash boundary

A pod dying mid-turn loses its mirror and has no new published checkpoint. Milestone 27 recovery
fails begun attempts without automatic replay, conservatively accounts usage and preserves approved
mutation receipts. The next user turn can resume the last completed checkpoint. A death between
upload and DB commit similarly leaves the old pointer intact. Restored SDK history does not roll
back financial/application state. A missing/corrupt/expired snapshot causes truthful
`reseeded/session_missing` continuity; storage outages fail closed rather than silently falling back.
Legacy host-local bindings are not portable and reseed on their next durable-worker turn.

## References (checked 2026-10-03)

- [Official SDK session persistence](https://code.claude.com/docs/en/agent-sdk/session-storage)
- [Official SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Official hosting behavior](https://code.claude.com/docs/en/agent-sdk/hosting)
- Installed `@anthropic-ai/claude-agent-sdk@0.3.276/sdk.d.ts` and hydration/mirroring code in `sdk.mjs`
- [Azure Put Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob),
  [Get Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/get-blob),
  [Delete Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/delete-blob),
  [List Blobs](https://learn.microsoft.com/en-us/rest/api/storageservices/list-blobs)
- [Federated client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)
