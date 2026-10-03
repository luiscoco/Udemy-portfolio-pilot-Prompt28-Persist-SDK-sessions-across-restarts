import { PortfolioError } from '@portfolio-pilot/db';

export type RunStopReason = 'cancelled' | 'timeout';
/** A reserved slot. `launch` runs work in the background; the slot is released only when it settles. */
export interface RunAdmission {
  launch(runId: string, work: (signal: AbortSignal) => Promise<void>, timeoutMs?: number): Promise<void>;
  /** Releases a slot whose run never launched (for example, persistence failed). Idempotent. */
  release(): void;
}
/** Historical local coordinator used only by pre-worker regression fixtures. */
export interface RunCoordinator {
  admit(ownerKey: string, conversationId: string): RunAdmission;
  /** Aborts a locally running run with reason "cancelled". False when this process does not hold it. */
  cancel(runId: string): boolean;
  isActive(runId: string): boolean;
}
export function stopReason(signal: AbortSignal): RunStopReason | null {
  return signal.aborted ? (signal.reason === 'cancelled' ? 'cancelled' : 'timeout') : null;
}

export class LocalRunCoordinator implements RunCoordinator {
  private readonly conversations = new Set<string>();
  private readonly owners = new Map<string, number>();
  private readonly runs = new Map<string, AbortController>();
  constructor(private readonly maxActive = 4, private readonly maxPerOwner = 2, private readonly timeoutMs = 90000) {}
  get activeCount() { return this.conversations.size; }
  admit(ownerKey: string, conversationId: string): RunAdmission {
    if (this.conversations.has(conversationId)) throw new PortfolioError(409, 'This conversation is already answering. Wait for it or cancel it first.');
    const count = this.owners.get(ownerKey) ?? 0;
    if (this.conversations.size >= this.maxActive || count >= this.maxPerOwner) throw new PortfolioError(409, 'The assistant is busy. Try again after an active answer finishes.');
    // Reserve synchronously before the first await; no unbounded queue or cross-user shared context.
    this.conversations.add(conversationId); this.owners.set(ownerKey, count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.conversations.delete(conversationId);
      const remaining = (this.owners.get(ownerKey) ?? 1) - 1;
      if (remaining) this.owners.set(ownerKey, remaining); else this.owners.delete(ownerKey);
    };
    return {
      release,
      launch: (runId, work, timeoutMs) => {
        const controller = new AbortController();
        this.runs.set(runId, controller);
        // The watchdog aborts, but the slot stays reserved until the work actually settles, so a
        // dependency that ignores abort cannot create unbounded background work.
        const timer = setTimeout(() => controller.abort('timeout'), timeoutMs ?? this.timeoutMs);
        return Promise.resolve().then(() => work(controller.signal)).catch(() => { /* work persists its own outcome */ }).finally(() => {
          clearTimeout(timer); this.runs.delete(runId); release();
        });
      }
    };
  }
  cancel(runId: string): boolean {
    const controller = this.runs.get(runId);
    if (!controller) return false;
    if (!controller.signal.aborted) controller.abort('cancelled');
    return true;
  }
  isActive(runId: string): boolean { return this.runs.has(runId); }
}
const local = globalThis as typeof globalThis & { portfolioRunCoordinator?: RunCoordinator };
export const chatCoordinator = local.portfolioRunCoordinator ??= new LocalRunCoordinator();
