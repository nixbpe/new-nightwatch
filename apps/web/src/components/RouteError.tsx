import { useEffect } from "react";
import { useRevalidator, useRouteError } from "react-router";

import { ErrorView } from "./ErrorBoundary";

// A throwing loader skips ErrorBoundary: react-router renders the nearest errorElement instead.
export function RouteError({ landmark }: { landmark?: boolean }) {
  const error = useRouteError();
  const revalidator = useRevalidator();
  useEffect(() => {
    console.error("Unhandled route error", error);
  }, [error]);
  return (
    <ErrorView
      message="โหลดหน้านี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
      landmark={landmark}
      onRetry={() => void revalidator.revalidate()}
    />
  );
}
