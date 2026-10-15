import type { Meta, StoryObj } from "@storybook/react-vite";

const palette = [
  ["green", ["950", "800", "700", "600", "500", "400", "200", "100", "50"]],
  ["lime", ["500", "400", "200", "100"]],
  ["paper", ["0", "50", "100", "200", "300", "400"]],
  ["ink", ["900", "700", "500", "400"]],
  ["sun", ["600", "400", "300", "100"]],
  ["coral", ["700", "500", "200", "100"]],
  ["lilac", ["700", "400", "100"]],
] as const;

function Tokens() {
  return (
    <div style={{ display: "grid", gap: 32 }}>
      <section>
        <h2 style={{ fontSize: "var(--gb-text-3xl)", letterSpacing: "var(--gb-tracking-display)" }}>
          Grade your next test for you
        </h2>
        <p style={{ color: "var(--gb-color-text-muted)", maxWidth: 560 }}>
          Nunito, body at 17px and weight 500. Headings at weight 850 in brand green.
        </p>
      </section>
      {palette.map(([hue, steps]) => (
        <section key={hue}>
          <h3 style={{ fontSize: 18, marginBottom: 8 }}>{hue}</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {steps.map((step) => (
              <div
                key={step}
                style={{
                  width: 96,
                  borderRadius: 14,
                  overflow: "hidden",
                  background: "#fff",
                  boxShadow: "var(--gb-shadow-sm)",
                  fontSize: 12,
                }}
              >
                <div style={{ height: 52, background: `var(--gb-${hue}-${step})` }} />
                <div style={{ padding: "6px 8px", fontWeight: 700 }}>
                  {hue}-{step}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h3 style={{ fontSize: 18, marginBottom: 8 }}>Radius and elevation</h3>
        <div style={{ display: "flex", gap: 16 }}>
          {(["sm", "md", "lg", "xl"] as const).map((r, i) => (
            <div
              key={r}
              style={{
                width: 120,
                height: 80,
                display: "grid",
                placeItems: "center",
                background: "#fff",
                borderRadius: `var(--gb-radius-${r})`,
                boxShadow: `var(--gb-shadow-${["xs", "sm", "md", "lg"][i]})`,
                fontWeight: 700,
              }}
            >
              {r}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = { title: "Foundations/Tokens", component: Tokens } satisfies Meta<typeof Tokens>;
export default meta;
export const All: StoryObj<typeof meta> = {};
