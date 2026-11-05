"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";
import { forgetGuestCard } from "@/lib/creator/guest-draft";
import { cn } from "@/lib/utils";

type LogoutButtonProps = {
  className?: string;
  variant?: "ghost" | "secondary" | "outline";
  size?: "sm" | "md";
  label?: string;
};

export function LogoutButton({
  className,
  variant = "ghost",
  size = "sm",
  label = "Sign out",
}: LogoutButtonProps) {
  return (
    // A guest card kept in this browser goes with the session (TODO HM3).
    <form action={logoutAction} onSubmit={() => void forgetGuestCard()} className={cn("inline-flex", className)}>
      <Button type="submit" variant={variant} size={size}>
        <LogOut className="h-4 w-4" aria-hidden />
        {label}
      </Button>
    </form>
  );
}
