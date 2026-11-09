"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A visitor's Print: the browser's own print dialog — `.table-sheet` in
 *  app/globals.css lays the sheet out on one clean page. */
export function PrintSheetButton() {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print
    </Button>
  );
}
