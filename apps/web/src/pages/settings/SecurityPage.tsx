import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "../../components/shell/Skeleton";
import { Alert } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { fetchMeContext, ME_CONTEXT_QUERY_KEY } from "../../lib/api/me";
import { MfaCard } from "./MfaCard";
import { PasswordCard } from "./PasswordCard";
import { Card } from "../../components/ui/card";

// The server's twoFactorEnabled flag is the only source of the card's enabled state.
export function SecurityPage() {
  const meQuery = useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
  });

  if (meQuery.isPending) {
    return (
      <Card role="status" aria-label="กำลังโหลดข้อมูลความปลอดภัย" padding="md">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full max-w-lg" />
        <Skeleton className="h-16 w-full" />
      </Card>
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

  // Refetching the shared me/context query also updates the shell's account block, which reads the same cache.
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
      <PasswordCard />
    </div>
  );
}
