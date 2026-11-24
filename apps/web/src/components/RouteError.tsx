import { useEffect } from "react";
import { useRevalidator, useRouteError } from "react-router";

import { ErrorView } from "./ErrorBoundary";

// A loader that throws never reaches ErrorBoundary: react-router renders the nearest errorElement,
// or its own default screen, in place of the route. Retry runs the loaders again.
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
