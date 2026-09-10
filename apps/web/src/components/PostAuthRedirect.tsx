import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import {
  clearReturnTo,
  readPostAuthDestination,
} from "../lib/auth/continuation";
import { FullPageLoading } from "./ui";

/**
 * Sends an already signed-in visitor to their post-auth destination — a
 * remembered pending invitation wins over the return path. The destination
 * resolves once during the first render (so abandoned StrictMode renders
 * cannot consume it), and the return path is cleared only after commit.
 */
export function PostAuthRedirect() {
  const navigate = useNavigate();
  const [destination] = useState(() => readPostAuthDestination());

  useEffect(() => {
    clearReturnTo();
    void navigate(destination, { replace: true });
  }, [destination, navigate]);

  return <FullPageLoading label="กำลังเข้าสู่ระบบ…" />;
}
