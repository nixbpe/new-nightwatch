/**
 * Bun's HTTP idle timeout defaults to 10 s and cuts a response that writes
 * nothing for that long. A Test writes nothing while its check runs, up to a
 * 30 s timeout (MONITOR_TIMEOUT_MAX_SECONDS) plus the 2 s limiter wait and DNS,
 * so the timeout is set above that (Bun accepts up to 255). Bun 1.3.14 already
 * keeps a POST whose body was read alive past 10 s; this pins the intent so a
 * Bun change cannot cut a Test.
 */
export const API_IDLE_TIMEOUT_SECONDS = 45;
