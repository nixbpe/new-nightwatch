import { replace, type LoaderFunctionArgs } from "react-router";
import { fetchSessions, SESSIONS_QUERY_KEY } from "../../sessions/sessions";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { loadSession, gateVerifiedSession, prefetchMeContext } from "./session";

export function settingsIndexLoader(): Response {
  return replace("/settings/profile");
}

// Runs in parallel with settingsLoader, which does the redirecting.
export async function sessionsLoader(): Promise<null> {
  const session = await loadSession();
  if (session === null || !session.user.emailVerified) {
    return null;
  }
  await resolveQueryClientForIdentity(session.user.id)
    .query({
      queryKey: SESSIONS_QUERY_KEY,
      queryFn: fetchSessions,
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

export async function settingsLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  await prefetchMeContext(sessionOrRedirect.user.id);
  return null;
}
