import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import {
  clearReturnTo,
  readPostAuthDestination,
} from "../lib/auth/continuation";
import { FullPageLoading } from "./ui";

// Resolved once in the first render so abandoned StrictMode renders can't consume it; cleared after commit.
export function PostAuthRedirect() {
  const navigate = useNavigate();
  const [destination] = useState(() => readPostAuthDestination());

  useEffect(() => {
    clearReturnTo();
    void navigate(destination, { replace: true });
  }, [destination, navigate]);

  return <FullPageLoading label="กำลังเข้าสู่ระบบ…" />;
}
