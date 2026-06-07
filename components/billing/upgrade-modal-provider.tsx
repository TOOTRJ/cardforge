"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { UpgradeModal, type UpgradeReason } from "./upgrade-modal";

// App-wide upgrade modal. Any client component can call useUpgradeModal().open()
// after hitting a 402/403 (out of credits, premium frame, capacity, …) to nudge
// the user to a plan without prop-drilling. Mounted once in the root layout.

type UpgradeModalContextValue = {
  open: (reason?: UpgradeReason) => void;
};

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(null);

export function useUpgradeModal(): UpgradeModalContextValue {
  // No-op fallback so a component used outside the provider never crashes.
  return useContext(UpgradeModalContext) ?? { open: () => {} };
}

export function UpgradeModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UpgradeReason>("generic");

  const openModal = useCallback((nextReason: UpgradeReason = "generic") => {
    setReason(nextReason);
    setOpen(true);
  }, []);

  return (
    <UpgradeModalContext.Provider value={{ open: openModal }}>
      {children}
      <UpgradeModal open={open} reason={reason} onOpenChange={setOpen} />
    </UpgradeModalContext.Provider>
  );
}
