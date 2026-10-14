export type UpdateReminderSettings = {
  skipped_version: string | null;
  remind_after: number | null;
};

export const updateReminderDelay = 7 * 24 * 60 * 60 * 1_000;
export type UpdateReminderChoice = "later" | "skip";

export function shouldNotifyUpdate(version: string, settings: UpdateReminderSettings, now = Date.now()) {
  return version !== settings.skipped_version && now >= (settings.remind_after ?? 0);
}

export function updateReminderPatch(choice: UpdateReminderChoice, version: string, now = Date.now()) {
  // A new explicit choice replaces the previous one. Merely checking never writes settings.
  return choice === "later"
    ? { reset: ["updates.skipped_version"], updates: { remind_after: now + updateReminderDelay } }
    : { reset: ["updates.remind_after"], updates: { skipped_version: version } };
}
