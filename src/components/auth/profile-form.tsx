"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updateProfileAction, type AuthResult } from "@/lib/actions/auth";
import type { SessionUser } from "@/lib/types";

export function ProfileForm({
  user,
  bio,
}: {
  user: SessionUser;
  bio: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const result: AuthResult = await updateProfileAction(formData);
          if (result.error) setError(result.error);
          else toast.success("Profile updated");
        });
      }}
    >
      <div className="space-y-2">
        <Label>Username</Label>
        <Input value={user.username} disabled />
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input value={user.email} disabled />
      </div>
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={user.displayName}
          required
          maxLength={48}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={bio}
          rows={4}
          maxLength={280}
          placeholder="Formats you play, favorite commanders, pet cards…"
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
