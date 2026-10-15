import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { Card } from "./Card";

const meta = {
  title: "Components/Card",
  component: Card,
  args: { children: null },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

const content = (
  <>
    <div style={{ color: "var(--gb-color-text-muted)", fontSize: 14, fontWeight: 700 }}>
      IM · Grade 7
    </div>
    <h3 style={{ margin: "6px 0 10px", fontSize: 22 }}>Unit 3 · Circles</h3>
    <div style={{ display: "flex", gap: 6 }}>
      <Badge appearance="outline">7.G.B.4</Badge>
      <Badge appearance="outline">7.G.A.2</Badge>
    </div>
  </>
);

export const Tones: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 280px)", gap: 20 }}>
      <Card>{content}</Card>
      <Card tone="sunken">{content}</Card>
      <Card tone="tint">{content}</Card>
    </div>
  ),
};

export const Padding: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      <Card padding="sm">Small</Card>
      <Card padding="md">Medium</Card>
      <Card padding="lg">Large</Card>
    </div>
  ),
};
