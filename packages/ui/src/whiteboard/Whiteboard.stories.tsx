import type { Meta, StoryObj } from "@storybook/react-vite";
import { Either } from "effect";
import { useState } from "react";
import { Button } from "../components/Button";
import { EMPTY_DOC, parseDoc, serializeDoc, type WhiteboardDoc } from "./doc";
import { SOLVED_EQUATION } from "./fixtures";
import { isDocEmpty, renderWhiteboardPng } from "./render";
import { Whiteboard } from "./Whiteboard";

const meta = {
  title: "Student/Whiteboard",
  component: Whiteboard,
  decorators: [(Story) => <div style={{ maxWidth: 760 }}>{Story()}</div>],
} satisfies Meta<typeof Whiteboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithWork: Story = { args: { initialDoc: SOLVED_EQUATION } };

export const WithWorksheetButton: Story = {
  args: {
    initialDoc: SOLVED_EQUATION,
    accessory: (
      <Button variant="secondary" size="sm">
        See worksheet
      </Button>
    ),
  },
};

export const Disabled: Story = { args: { initialDoc: SOLVED_EQUATION, disabled: true } };

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Draw, then export. Exports the PNG twice and compares hashes, to show the
 * same strokes give the same bytes, and round-trips the doc through JSON.
 */
function ExportDemo() {
  const [doc, setDoc] = useState<WhiteboardDoc>(SOLVED_EQUATION);
  const [result, setResult] = useState<{
    url: string;
    first: string;
    second: string;
    size: number;
    roundTrip: boolean;
  } | null>(null);

  async function exportTwice() {
    const [a, b] = await Promise.all([renderWhiteboardPng(doc), renderWhiteboardPng(doc)]);
    if (Either.isLeft(a) || Either.isLeft(b)) return;
    const restored = parseDoc(serializeDoc(doc));
    setResult({
      url: URL.createObjectURL(a.right),
      first: await sha256(a.right),
      second: await sha256(b.right),
      size: a.right.size,
      roundTrip: Either.isRight(restored) && serializeDoc(restored.right) === serializeDoc(doc),
    });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Whiteboard initialDoc={SOLVED_EQUATION} onChange={setDoc} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button onClick={exportTwice}>Export PNG</Button>
        <span style={{ color: "var(--gb-color-text-muted)" }}>
          {isDocEmpty(doc) ? "Empty: Submit would be blocked" : `${doc.strokes.length} strokes`}
        </span>
      </div>
      {result !== null && (
        <div data-testid="export-result" style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <img
            src={result.url}
            alt="Exported PNG"
            width={512}
            height={384}
            style={{ border: "1px solid var(--gb-color-border)" }}
          />
          <div>
            1024 × 768 PNG, {Math.round(result.size / 1024)} KB · hash {result.first} /{" "}
            {result.second} · {result.first === result.second ? "identical" : "DIFFERENT"} · JSON
            round trip {result.roundTrip ? "ok" : "FAILED"}
          </div>
        </div>
      )}
    </div>
  );
}

export const Export: Story = { render: () => <ExportDemo /> };

export const EmptyIsBlocked: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      <Whiteboard initialDoc={EMPTY_DOC} />
      <Button disabled>Submit</Button>
    </div>
  ),
};
