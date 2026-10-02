import { useQuery } from "@tanstack/react-query";

import {
  fetchMonitorList,
  MONITOR_LIST_PAGE_SIZE,
  monitorQueryKeys,
} from "../../lib/api/monitors";
import {
  fetchUnreadCount,
  notificationQueryKey,
} from "../../lib/api/notifications";
import { useTenant } from "../../lib/tenant/TenantProvider";

/** One unread-count query for the bell badge and the inbox nav row. */
export function useUnreadCount() {
  const { serverActiveOrgId } = useTenant();
  return useQuery({
    queryKey: [...notificationQueryKey(serverActiveOrgId), "count"],
    queryFn: () => fetchUnreadCount(serverActiveOrgId),
  });
}

// Same key and params as the monitor list's unfiltered first page (and its route
// loader), so the list page and the nav row share one cached response.
const FIRST_PAGE = { limit: MONITOR_LIST_PAGE_SIZE, offset: 0 };

/** `summary.total` of the organization's monitors; undefined while unknown or failed. */
export function useMonitorTotal(organizationId: string | null) {
  const query = useQuery({
    queryKey: monitorQueryKeys.list(organizationId ?? "", FIRST_PAGE),
    queryFn: () => fetchMonitorList(organizationId ?? "", FIRST_PAGE),
    enabled: organizationId !== null,
    select: (data) => data.summary.total,
  });
  return query.isError ? undefined : query.data;
}
