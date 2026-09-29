import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useTenant } from "../../lib/tenant/TenantProvider";

/**
 * A monitor id belongs to one Organization, so a switch made while the page is
 * open sends the user to the new Organization's Overview (AC-49). Returns true
 * from the render in which the switch is seen so the page can drop its data
 * instead of showing the old Organization's monitor for a frame.
 */
export function useLeaveOnOrganizationSwitch(): boolean {
  const { serverActiveOrgId } = useTenant();
  const navigate = useNavigate();
  const [openedIn, setOpenedIn] = useState(serverActiveOrgId);
  if (openedIn === null && serverActiveOrgId !== null) {
    setOpenedIn(serverActiveOrgId);
  }
  const switched =
    openedIn !== null &&
    serverActiveOrgId !== null &&
    serverActiveOrgId !== openedIn;
  useEffect(() => {
    if (switched) {
      void navigate(`/organizations/${serverActiveOrgId}/monitors`, {
        replace: true,
      });
    }
  }, [switched, serverActiveOrgId, navigate]);
  return switched;
}
