import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { MfaCard } from "./MfaCard";

/**
 * Security tab of /settings. The layout's loader already gates the
 * session and prefetches me/context; the server's twoFactorEnabled flag
 * is the only source of the card's enabled state.
 */
export function SecurityPage() {
  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });

  if (meQuery.isPending) {
    return (
      <div
        role="status"
        aria-label="กำลังโหลดข้อมูลความปลอดภัย"
        className="flex flex-col gap-4 rounded-md border border-foreground/10 bg-surface p-6"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full max-w-lg" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">
          ไม่สามารถตรวจสอบสถานะยืนยันสองขั้นตอนได้ กรุณาลองใหม่อีกครั้ง
        </Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={meQuery.isRefetching}
            onClick={() => {
              void meQuery.refetch();
            }}
          >
            {meQuery.isRefetching ? "กำลังโหลด…" : "ลองใหม่"}
          </Button>
        </div>
      </div>
    );
  }

  // Refetching the shared me/context query is what flips the card (and
  // the shell's account block, which reads the same cache) to the server's
  // current answer.
  const refreshStatus = async (): Promise<boolean | undefined> => {
    const refreshed = await meQuery.refetch();
    return refreshed.data?.user.twoFactorEnabled;
  };

  return (
    <div className="flex flex-col gap-6">
      <MfaCard
        enabled={meQuery.data.user.twoFactorEnabled}
        refreshStatus={refreshStatus}
      />
    </div>
  );
}
