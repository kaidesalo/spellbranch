"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction } from "@/lib/actions/comments";

type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string } | null;
};

export function CommentSection({
  deckId,
  comments,
  canComment,
}: {
  deckId: string;
  comments: CommentItem[];
  canComment: boolean;
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await addCommentAction(deckId, body);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Comment posted");
        setBody("");
      }
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Comments</h2>

      {canComment && (
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share feedback on this list or branch…"
            rows={3}
            maxLength={1000}
          />
          <Button onClick={submit} disabled={pending || !body.trim()}>
            {pending ? "Posting…" : "Post comment"}
          </Button>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No comments yet. Be the first to leave a note.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-xl border border-border/70 bg-background/50 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {comment.author?.displayName ?? "Unknown"}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    @{comment.author?.username ?? "unknown"}
                  </span>
                </p>
                <time className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.createdAt), {
                    addSuffix: true,
                  })}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
