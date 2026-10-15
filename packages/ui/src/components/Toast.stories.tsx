import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { useToast } from "./Toast";

function Demo({ autoShow }: { autoShow: boolean }) {
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (!autoShow || shown.current) return;
    shown.current = true;
    toast({ title: "Report link copied", tone: "success", timeout: 0 });
    toast({
      title: "3 grades need you",
      description: "The grader wasn't sure about problem 4.",
      tone: "attention",
      timeout: 0,
    });
    toast({ title: "Maya R. joined", timeout: 0 });
  }, [autoShow, toast]);
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <Button variant="secondary" onClick={() => toast({ title: "Maya R. joined" })}>
        Neutral
      </Button>
      <Button
        variant="secondary"
        onClick={() => toast({ title: "Report link copied", tone: "success" })}
      >
        Success
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: "3 grades need you",
            description: "The grader wasn't sure about problem 4.",
            tone: "attention",
          })
        }
      >
        Attention
      </Button>
    </div>
  );
}

const meta = {
  title: "Components/Toast",
  component: Demo,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ padding: 24, minHeight: 420 }}>{Story()}</div>],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Stack: Story = { args: { autoShow: true } };
export const Triggers: Story = { args: { autoShow: false } };
