import { ClerkProvider } from "@clerk/tanstack-react-start";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LiveStatusBanner } from "../components/LiveStatusBanner";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Goblins Grader" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Pip, the creature in the Goblins Grader wordmark (packages/ui creature 0).
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: Root,
  shellComponent: RootDocument,
});

/** Screens that read live data, where a missing Electric deserves a notice. */
const LIVE_PATHS = /^\/(sessions|play)\//;

function Root() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      {LIVE_PATHS.test(pathname) && <LiveStatusBanner />}
      <Outlet />
    </>
  );
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClerkProvider>{children}</ClerkProvider>
        <Scripts />
      </body>
    </html>
  );
}
