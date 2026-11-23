/**
 * Agent-task state machine (pure). External publishing agents are not
 * necessarily running, so the Master MCP queues work; the target profile
 * picks it up on its next connection and reports the result.
 *
 * States: pending → claimed → in_progress → completed | failed | cancelled
 * A paused profile must leave tasks pending (the server refuses claim/start).
 * Never treat a queued task as done until the target agent reports completion.
 */
export const TASK_STATES = ["pending", "claimed", "in_progress", "completed", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed", "failed", "cancelled"];

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  pending: ["claimed", "cancelled"],
  claimed: ["in_progress", "pending", "cancelled"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value);
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`A ${from} task cannot move to ${to}.`);
  }
}

export function isTerminal(state: TaskState): boolean {
  return (TERMINAL_TASK_STATES as readonly string[]).includes(state);
}

/** Claim/start is refused while the target profile is paused or disabled. */
export function canProfileWorkTasks(input: { enabled: boolean; paused: boolean }): { ok: true } | { ok: false; error: string } {
  if (!input.enabled) {
    return { ok: false, error: "That automation profile is disabled, so the task stays pending until the profile is permitted to work." };
  }
  if (input.paused) {
    return { ok: false, error: "That automation profile is paused, so the task stays pending until the profile is permitted to work." };
  }
  return { ok: true };
}

export type TaskPatch = {
  title?: string;
  instructions?: string;
  articleIds?: string[];
  priority?: TaskPriority;
  deadlineAt?: string | null;
};

export function assertPendingUpdate(status: TaskState): void {
  if (status !== "pending") {
    throw new Error(`Only a pending task can be updated. This task is ${status}.`);
  }
}
