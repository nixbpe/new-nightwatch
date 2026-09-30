import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useTenant } from "../../lib/tenant/TenantProvider";

/**
 * True once the server-active Organization moved to one that is not the one this
 * page opened in. A deep link can name an Organization that is not active, so the
 * anchor is the active one at open until the active one becomes the route's; from
 * then on the route's Organization is the anchor.
 */
export function useOrganizationSwitched(routeOrganizationId: string): boolean {
  const { serverActiveOrgId } = useTenant();
  const [anchor, setAnchor] = useState(serverActiveOrgId);
  if (anchor === null && serverActiveOrgId !== null) {
    setAnchor(serverActiveOrgId);
  } else if (
    serverActiveOrgId === routeOrganizationId &&
    anchor !== routeOrganizationId
  ) {
    setAnchor(routeOrganizationId);
  }
  return (
    anchor !== null &&
    serverActiveOrgId !== null &&
    serverActiveOrgId !== anchor &&
    serverActiveOrgId !== routeOrganizationId
  );
}

/**
 * A monitor id belongs to one Organization, so a switch made while the page is
 * open sends the user to the new Organization's Overview (AC-49). Returns true
 * from the render in which the switch is seen so the page can drop its data
 * instead of showing the old Organization's monitor for a frame.
 */
export function useLeaveOnOrganizationSwitch(
  routeOrganizationId: string,
): boolean {
  const { serverActiveOrgId } = useTenant();
  const navigate = useNavigate();
  const switched = useOrganizationSwitched(routeOrganizationId);
  useEffect(() => {
    if (switched && serverActiveOrgId !== null) {
      void navigate(`/organizations/${serverActiveOrgId}/monitors`, {
        replace: true,
      });
    }
  }, [switched, serverActiveOrgId, navigate]);
  return switched;
}
