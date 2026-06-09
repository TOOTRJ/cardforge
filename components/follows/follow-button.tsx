"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleFollowAction } from "@/lib/follows/actions";

export function FollowButton({
  targetUserId,
  initialFollowing,
  requiresSignIn = false,
}: {
  targetUserId: string;
  initialFollowing: boolean;
  requiresSignIn?: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (requiresSignIn) {
      router.push("/login");
      return;
    }
    startTransition(async () => {
      const previous = following;
      setFollowing(!previous); // optimistic
      const result = await toggleFollowAction(targetUserId);
      if (!result.ok) {
        setFollowing(previous);
        toast.error(result.error);
        return;
      }
      setFollowing(result.following);
      router.refresh();
    });
  }

  return (
    <Button
      onClick={onClick}
      disabled={pending}
      size="sm"
      variant={following ? "secondary" : "primary"}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : following ? (
        <UserCheck className="h-4 w-4" aria-hidden />
      ) : (
        <UserPlus className="h-4 w-4" aria-hidden />
      )}
      {following ? "Following" : "Follow"}
    </Button>
  );
}
