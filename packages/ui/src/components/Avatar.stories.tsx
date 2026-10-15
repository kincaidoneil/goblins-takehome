import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar";
import { CREATURE_COUNT, CreatureArt, creature } from "./creatures";

const meta = {
  title: "Components/Avatar",
  component: Avatar,
  args: { kind: "creature", creatureId: 0 },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Creature: Story = { args: { kind: "creature", creatureId: 3, size: "xl" } };

export const Sizes: Story = {
  args: { kind: "creature", creatureId: 5 },
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Avatar key={size} kind="creature" creatureId={5} size={size} />
      ))}
    </div>
  ),
};

export const PersonInitials: Story = {
  args: { kind: "person", name: "Renee Alvarez" },
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Avatar kind="person" name="Renee Alvarez" size="sm" />
      <Avatar kind="person" name="Renee Alvarez" />
      <Avatar kind="person" name="Jordan" size="lg" />
      <Avatar kind="person" name="Broken Image" src="data:," size="lg" />
    </div>
  ),
};

/** Every creature, with its name. */
export const AllCreatures: Story = {
  args: { kind: "creature", creatureId: 0 },
  parameters: { layout: "fullscreen" },
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 96px)",
        gap: "20px 16px",
        padding: 24,
      }}
    >
      {Array.from({ length: CREATURE_COUNT }, (_, i) => i).map((id) => (
        <figure key={id} style={{ margin: 0, textAlign: "center" }}>
          <CreatureArt id={id} size={80} />
          <figcaption style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
            {creature(id).name}
          </figcaption>
        </figure>
      ))}
    </div>
  ),
};
