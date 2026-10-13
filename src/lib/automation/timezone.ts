/**
 * IANA timezone validation, shared by the automation schema and the schedule
 * maths. Kept in its own module so neither of those has to import the other.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
