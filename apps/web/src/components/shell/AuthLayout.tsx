import { Outlet } from "react-router";

// Groups the chrome-less routes. No session redirect here: /two-factor owns its challenge rules
// and a generic guard would contradict them.
export function AuthLayout() {
  return <Outlet />;
}
