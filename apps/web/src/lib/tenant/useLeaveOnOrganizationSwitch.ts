import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useTenant } from "./TenantProvider";

/**
 * True once the server-active Organization moved to one that is not the one this
 * page opened in. A deep link can name an Organization that is not active, so the
 * anchor is the active one at open until the active one becomes the route's; from
 * then on the route's Organization is the anchor.
 */
export function useOrganizationSwitched(routeOrganizationId: string): boolean {
  const { serverActiveOrgId } = useTenant();
  const [anchor, setAnchor] = useState(serverActiveOrgId);
  const [retired, setRetired] = useState(false);
  if (anchor === null && serverActiveOrgId !== null) {
    setAnchor(serverActiveOrgId);
  } else if (
    serverActiveOrgId === routeOrganizationId &&
    anchor !== routeOrganizationId
  ) {
    setAnchor(routeOrganizationId);
  }
  const switched =
    retired ||
    (anchor !== null &&
      serverActiveOrgId !== null &&
      serverActiveOrgId !== anchor &&
      serverActiveOrgId !== routeOrganizationId);
  // A destination loader temporarily withdraws the context. That cannot revive
  // the old page's private state, even if a later intent returns to its scope.
  if (switched && !retired) setRetired(true);
  return switched;
}

/**
 * A page whose route names one Organization's record (a monitor, a Project)
 * cannot follow a switch, so a switch made while it is open sends the user to
 * the new Organization's list of the same `section` (monitors: AC-49). Returns
 * true from the render in which the switch is seen so the page can drop its
 * data instead of showing the old Organization's record for a frame.
 */
export function useLeaveOnOrganizationSwitch(
  routeOrganizationId: string,
  section: "monitors" | "projects" = "monitors",
): boolean {
  const { serverActiveOrgId } = useTenant();
  const navigate = useNavigate();
  const switched = useOrganizationSwitched(routeOrganizationId);
  const destination = useRef<string | null>(null);
  useEffect(() => {
    if (
      switched &&
      serverActiveOrgId !== null &&
      destination.current !== serverActiveOrgId
    ) {
      // Reconfirming the same destination must not supersede its pending loader.
      // A newer confirmed scope still replaces the old navigation.
      destination.current = serverActiveOrgId;
      void navigate(`/organizations/${serverActiveOrgId}/${section}`, {
        replace: true,
      });
    }
  }, [switched, serverActiveOrgId, section, navigate]);
  return switched;
}
