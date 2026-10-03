export class AgentConfigurationError extends Error {}
export class AgentExecutionError extends Error {}
/** Sanitized failure with a fixed public code; never carries SDK/provider error text. */
export class AgentRunFailure extends AgentExecutionError {
  constructor(readonly code: string, message = `Agent run failed: ${code}`) { super(message); }
}
export class AgentTimeoutError extends AgentRunFailure { constructor() { super('timeout', 'Claude did not answer within the time limit.'); } }
export class AnswerTooLongError extends AgentRunFailure { constructor() { super('answer_too_long'); } }
/** The caller's signal aborted the run (explicit cancellation or the coordinator watchdog). */
export class AgentCancelledError extends Error { constructor() { super('The run was cancelled.'); } }
