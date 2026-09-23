// Bahrain wall-clock date math that does not depend on the host process's own time zone.
//
// Bahrain has a fixed UTC+3 offset year-round (no daylight saving), so "what day/hour is it in
// Bahrain right now" can always be computed from an instant with plain arithmetic. This matters
// because Supabase Edge Functions run in UTC: code that used local Date methods (setHours,
// getDay, ...) silently returned UTC-based results there instead of Bahrain ones. Every place
// that used to rely on process.env.TZ === "Asia/Bahrain" (the parser, the day-plan grouping)
// should use these helpers instead, so behaviour is identical whatever zone the process runs in.

const OFFSET_MINUTES = 180; // UTC+3, all year.

export interface BahrainParts {
  year: number;
  /** 0-based, like Date#getMonth. */
  month: number;
  day: number;
  /** 0 = Sunday, like Date#getDay. */
  weekday: number;
  hours: number;
  minutes: number;
}

/** Bahrain wall-clock fields for the given instant. */
export function bahrainParts(at: Date): BahrainParts {
  const shifted = new Date(at.getTime() + OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/**
 * The instant at the given Bahrain wall-clock date/time. Fields outside their normal range
 * (day 0, day 32, month 12, ...) roll over the same way Date's own constructor does.
 */
export function bahrainDate(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0) - OFFSET_MINUTES * 60000);
}

/** "YYYY-MM-DD" for the instant's Bahrain calendar day. */
export function bahrainDateKey(at: Date): string {
  const p = bahrainParts(at);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
