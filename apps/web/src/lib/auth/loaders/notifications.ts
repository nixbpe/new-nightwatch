import { type LoaderFunctionArgs } from "react-router";
import { selectActiveOrganization } from "../../tenant/activeOrganization";
import {
  fetchNotifications,
  fetchOrganizationNotificationSettings,
  notificationQueryKey,
  organizationNotificationSettingsQueryKey,
} from "../../api/notifications";
import { resolveQueryClientForIdentity } from "../../queryClient";
import { gateVerifiedSession, prefetchMeContext } from "./session";

export async function notificationsLoader({
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (context === undefined) return null;
  const activeOrganizationId = selectActiveOrganization(context)?.id ?? null;
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: notificationQueryKey(activeOrganizationId),
      queryFn: () => fetchNotifications(activeOrganizationId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}

export async function notificationSettingsLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<null | Response> {
  const sessionOrRedirect = await gateVerifiedSession(request);
  if (sessionOrRedirect instanceof Response) {
    return sessionOrRedirect;
  }
  const organizationId = params.organizationId;
  if (organizationId === undefined) {
    return null;
  }
  const context = await prefetchMeContext(sessionOrRedirect.user.id);
  if (context?.organizations.some((org) => org.id === organizationId) !== true)
    return null;
  await resolveQueryClientForIdentity(sessionOrRedirect.user.id)
    .query({
      queryKey: organizationNotificationSettingsQueryKey(organizationId),
      queryFn: () => fetchOrganizationNotificationSettings(organizationId),
      staleTime: "static",
    })
    .catch(() => undefined);
  return null;
}
