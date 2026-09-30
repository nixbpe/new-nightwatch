import { validateOutboundUrl, type UrlCheck } from "../outbound-http";

/**
 * The URL a check requests: the saved URL plus the query params, validated by
 * the outbound URL policy (`url.href.length <= 2048`, fragment included). Only
 * the new pairs are serialized, so the saved query keeps its exact bytes
 * (%20, ~, ?flag). Save-time validation calls this to match `runCheck`.
 */
export function buildCheckUrl(
  url: string,
  queryParams: readonly { name: string; value: string }[],
): UrlCheck {
  const checked = validateOutboundUrl(url);
  if (!checked.ok) return checked;
  const target = checked.url;
  if (queryParams.length > 0) {
    const added = new URLSearchParams(
      queryParams.map(({ name, value }): [string, string] => [name, value]),
    ).toString();
    const saved = target.search.slice(1);
    target.search = saved === "" ? added : `${saved}&${added}`;
  }
  // The normalized href can be longer than the raw text (spaces become %20).
  return validateOutboundUrl(target.href);
}
