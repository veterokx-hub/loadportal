"use client";

import { PortalProvider } from "@/context/PortalContext";
import { PortalChrome } from "@/components/PortalChrome";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <PortalChrome>{children}</PortalChrome>
    </PortalProvider>
  );
}
