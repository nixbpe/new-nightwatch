import { replace } from "react-router";
import { fetchInvitation, invitationQueryKey } from "../../api/invitations";
import { resolveQueryClientForIdentity } from "../../queryClient";
import {
  clearReturnTo,
  readInvitation,
  readPostAuthDestination,
} from "../continuation";
import { loadSession } from "./session";

export function rootLoader(): Response {
  return replace("/workspace");
}

export async function requireAnonLoader(): Promise<null | Response> {
  const session = await loadSession();
  if (session === null) {
    return null;
  }
  const destination = readPostAuthDestination();
  clearReturnTo();
  return replace(destination);
}

export async function verifyEmailLoader(): Promise<null> {
  const session = await loadSession();
  const invitationId = session === null ? readInvitation() : null;
  if (invitationId === null) {
    return null;
  }
  await resolveQueryClientForIdentity(null)
    .query({
      queryKey: invitationQueryKey(invitationId),
      queryFn: () => fetchInvitation(invitationId),
      retry: false,
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}
