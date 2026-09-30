import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useTenant } from "../../lib/tenant/TenantProvider";

export function hasLeftOrganization(
  openedIn: string | null,
  active: string | null,
  routeOrganizationId: string,
): boolean {
  return (
    openedIn !== null &&
    active !== null &&
    active !== openedIn &&
    active !== routeOrganizationId
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
  const [openedIn, setOpenedIn] = useState(serverActiveOrgId);
  if (openedIn === null && serverActiveOrgId !== null) {
    setOpenedIn(serverActiveOrgId);
  }
  // A deep link can name an Organization that is not the server-active one. Only a change
  // of the active Organization to one the route does not name counts as leaving it.
  const switched = hasLeftOrganization(
    openedIn,
    serverActiveOrgId,
    routeOrganizationId,
  );
  useEffect(() => {
    if (switched && serverActiveOrgId !== null) {
      void navigate(`/organizations/${serverActiveOrgId}/monitors`, {
        replace: true,
      });
    }
  }, [switched, serverActiveOrgId, navigate]);
  return switched;
}
