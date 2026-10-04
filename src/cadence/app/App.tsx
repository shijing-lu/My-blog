/**
 * 应用根组件
 * 只做两件事：挂 Provider、挂 Router。
 */

import { RouterProvider } from "@tanstack/react-router";

import { AppProviders } from "./providers/AppProviders";
import { router } from "./router/router";

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
