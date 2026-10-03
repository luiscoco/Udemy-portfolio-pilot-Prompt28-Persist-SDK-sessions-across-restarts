# 0018. Durable approvals and explicit cancellation

- Status: Accepted
- Date: 2026-10-02
- Milestone: 25

## Context

Model intent is never authorization. SDK 0.3.276 / bundled CLI 2.1.276 exposes
CanUseTool (with an abort signal and allow/deny results) and PreToolUse ask/deny decisions.
The official permission flow skips canUseTool for preapproved tools and in dontAsk mode.
A JavaScript permission callback cannot be restored by recording an SDK session ID.

## Decision

Register an owner-bound proposeChange MCP tool and a bounded listAlertRules read tool.
Keep writes out of allowedTools, use default permission mode with deny-by-default callbacks,
and require PreToolUse ask on main-thread proposals. Specialists cannot propose writes.
The permission callback parses a discriminated application schema, persists a PostgreSQL
ApprovalRequest and waits for an authenticated endpoint decision. It returns only the exact
validated input, without installing reusable SDK permissions. The handler independently requires
an application receipt bound to the same arguments and run; bypassing the callback cannot write.

Persist owner, run, normalized exact arguments, action, SHA-256 canonical argument hash,
prior resource state, unique mutation UUID, status and UTC expiry (60 seconds). No owner or
approval ID is accepted from the model. UI approval/rejection binds the displayed hash.
The API derives the owner from its current session and applies existing origin/body protections.

Consume in the same PostgreSQL transaction as the mutation and its owner-only outbox event.
Recheck run ownership/status/cancellation, schema, action/hash/exact arguments, expiry,
security identity and current watchlist state, or owned non-deleted alert revision/settings
and allowed security interests. Serialize consumption, cancellation and terminal completion
on the run row. Alert writes use a revision compare-and-set; watchlist insertion uses its
unique constraint. Consumption stores a durable receipt; duplicates return it without writing.
Changed arguments create a new ApprovalRequest. Cancellation invalidates pending and granted
but unconsumed approvals and aborts the local SDK Query through the existing abort/close path.
Already committed, explicitly approved mutations remain committed. Terminal texts say so.

Application records remain durable across process loss. An orphaned waiting run is failed
when reconciled or when its approval is requested, with pending grants invalidated. Approval
cannot resume it. The user must explicitly send a new proposal, producing a new run/approval.
No durable SDK approval or callback restoration API is assumed. The mock follows the same
application approval/handler checks and labels its answers.

## Consequences

This milestone retains the single-process coordinator. Routes and callbacks must reach that
process; no multi-replica or worker recovery is claimed. Worker ownership and fenced recovery
belong to milestones 27/30. PostgreSQL snapshots recover cards after browser reload; browser
disconnect never cancels. Live model behavior still requires a credentialed smoke test.
Approval is limited to watchlist additions and complete alert replacements, never trades.

## References

Checked 2026-10-02 against installed sdk.d.ts and Next 16.3.8 route handler documentation.
- [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [SDK approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
