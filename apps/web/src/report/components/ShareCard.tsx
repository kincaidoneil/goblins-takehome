/**
 * "Share this report": a view-only link with names hidden, ready to send to a department head
 * or principal.
 */
import { Button, Card, Dialog, Input } from "@goblins/ui";
import { useState } from "react";

type LinkState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Creating" }
  | { readonly _tag: "Ready"; readonly url: string }
  | { readonly _tag: "Failed" };

export function ShareCard({
  title,
  createLink,
}: {
  /** The assignment title, for the email subject. */
  readonly title: string;
  /** Returns the share URL, creating the token the first time. Null when it failed. */
  readonly createLink: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<LinkState>({ _tag: "Idle" });
  const [copied, setCopied] = useState(false);

  const openDialog = async () => {
    setOpen(true);
    if (link._tag === "Ready" || link._tag === "Creating") return;
    setLink({ _tag: "Creating" });
    const url = await createLink();
    setLink(url === null ? { _tag: "Failed" } : { _tag: "Ready", url });
  };

  const copyLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  const mailto = (url: string) => {
    const subject = `How my class did on ${title}`;
    const body = [
      "Hi,",
      "",
      `My class just finished ${title}, and Goblins Grader graded it for me. Here's the class report (student names are hidden):`,
      "",
      url,
      "",
      "It shows where students struggled and the common mistakes. I'd like to try Goblins for follow-up practice.",
    ].join("\n");
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h2 className="text-lg">Share this report</h2>
      <p className="m-0 text-sm text-text-muted">
        Send a view-only link to your department head or principal. Student names are hidden.
      </p>
      <Button variant="secondary" onClick={openDialog}>
        Get a share link
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Share this report"
        description="Anyone with the link can see class results and common mistakes. They can’t see student names, and they can’t change anything."
      >
        {link._tag === "Ready" ? (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={link.url}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1"
              />
              <Button variant="brand" onClick={() => copyLink(link.url)}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
              <a href={mailto(link.url)} className="text-brand underline underline-offset-4">
                Email it to your principal
              </a>
              <a
                href={link.url}
                target="_blank"
                rel="noopener"
                className="text-brand underline underline-offset-4"
              >
                See what they’ll see
              </a>
            </div>
          </div>
        ) : link._tag === "Failed" ? (
          <p className="m-0 text-sm text-text">
            We couldn’t make a link just now. Close this and try again.
          </p>
        ) : (
          <p className="m-0 text-sm text-text-muted">Making your link…</p>
        )}
      </Dialog>
    </Card>
  );
}
