"use client";

import { useEffect, useRef } from "react";
import { GUEST_DRAFT_FIELD, guestCardWaiting } from "@/lib/creator/guest-draft";

/** The signup form's field for the funnel's `guestDraft` prop (TODO HM3):
 *  "1" when a card built in the guest creator waits in this browser.
 *  Uncontrolled and filled after mount, like AttributionFields. */

export function GuestDraftField() {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current && guestCardWaiting()) ref.current.value = "1";
  }, []);
  return <input ref={ref} type="hidden" name={GUEST_DRAFT_FIELD} defaultValue="" />;
}
