/**
 * The student avatar set: 48 friendly creatures drawn from parts in SVG.
 * Each creature has a unique color and head-top pair, so no two look alike
 * in a class of 30. Original art; nothing here is traced from Goblins.
 */

const INK = "#1e2b24";

const COLORS = [
  { name: "lime", skin: "#a7e35a", shade: "#86c23a", bg: "#edfbc9" },
  { name: "mint", skin: "#7fd6a8", shade: "#5cb888", bg: "#e3f5ea" },
  { name: "sky", skin: "#8cc8f0", shade: "#68a9d6", bg: "#e4f2fc" },
  { name: "lilac", skin: "#b9a8f5", shade: "#9a86e3", bg: "#eeeafd" },
  { name: "peach", skin: "#ffb98a", shade: "#ee9a65", bg: "#ffebdd" },
  { name: "sun", skin: "#ffd460", shade: "#eab53a", bg: "#fff4d6" },
  { name: "coral", skin: "#f59a8f", shade: "#e2786c", bg: "#fce8e4" },
  { name: "teal", skin: "#5fc4c0", shade: "#3fa6a2", bg: "#ddf4f2" },
] as const;

type Color = (typeof COLORS)[number];
type Top = "goblin" | "bear" | "bunny" | "horns" | "antenna" | "sprout";
type Head = "round" | "squircle" | "egg";
type Eyes = "dots" | "big" | "happy" | "wink";
type Mouth = "smile" | "grin" | "cat" | "fang";

const TOPS: ReadonlyArray<Top> = ["goblin", "bear", "bunny", "horns", "antenna", "sprout"];
const HEADS: ReadonlyArray<Head> = ["round", "squircle", "egg"];
const EYES: ReadonlyArray<Eyes> = ["dots", "big", "happy", "wink"];
const MOUTHS: ReadonlyArray<Mouth> = ["smile", "grin", "cat", "fang"];

const NAMES = [
  "Pip",
  "Moss",
  "Bloop",
  "Juniper",
  "Taffy",
  "Nib",
  "Pickle",
  "Wren",
  "Sprocket",
  "Clover",
  "Mochi",
  "Fig",
  "Bramble",
  "Dot",
  "Noodle",
  "Tansy",
  "Gizmo",
  "Pebble",
  "Sorrel",
  "Waffle",
  "Basil",
  "Quill",
  "Muffin",
  "Fern",
  "Biscuit",
  "Poppy",
  "Zest",
  "Acorn",
  "Tumble",
  "Mango",
  "Rune",
  "Sprig",
  "Button",
  "Kiwi",
  "Thistle",
  "Puddle",
  "Echo",
  "Maple",
  "Doodle",
  "Hazel",
  "Ziggy",
  "Plum",
  "Scout",
  "Bean",
  "Comet",
  "Olive",
  "Jinx",
  "Sage",
] as const;

export const CREATURE_COUNT = NAMES.length;

export interface Creature {
  id: number;
  name: string;
  color: Color;
  top: Top;
  head: Head;
  eyes: Eyes;
  mouth: Mouth;
  blush: boolean;
}

function at<T>(list: ReadonlyArray<T>, index: number): T {
  const item = list[((index % list.length) + list.length) % list.length];
  if (item === undefined) throw new Error("unreachable: list is non-empty");
  return item;
}

/** Creature `id` in [0, CREATURE_COUNT). Ids outside the range wrap around. */
export function creature(id: number): Creature {
  const i = ((Math.trunc(id) % CREATURE_COUNT) + CREATURE_COUNT) % CREATURE_COUNT;
  return {
    id: i,
    name: at(NAMES, i),
    color: at(COLORS, i),
    top: at(TOPS, Math.floor(i / COLORS.length)),
    head: at(HEADS, i * 7 + 1),
    eyes: at(EYES, i * 3 + Math.floor(i / 8)),
    mouth: at(MOUTHS, i * 5 + Math.floor(i / 16)),
    blush: i % 3 !== 1,
  };
}

/** A uniformly random creature id, for assigning to a student who just joined. */
export function randomCreatureId(random: () => number = Math.random): number {
  return Math.floor(random() * CREATURE_COUNT);
}

/** Mirrors a left-side shape to the right side of the 64-unit canvas. */
const MIRROR = "translate(64 0) scale(-1 1)";

function TopBack({ top, color }: { top: Top; color: Color }) {
  switch (top) {
    case "goblin": {
      const ear = (
        <>
          <path d="M17 33 Q6 27 2 17 Q12 20 20 27 Z" fill={color.skin} />
          <path d="M15 30 Q9 26 7 22 Q12 24 17 28 Z" fill={color.shade} />
        </>
      );
      return (
        <>
          <g>{ear}</g>
          <g transform={MIRROR}>{ear}</g>
        </>
      );
    }
    case "bear":
      return (
        <>
          {[0, 1].map((side) => (
            <g key={side} transform={side === 1 ? MIRROR : undefined}>
              <circle cx="18" cy="20" r="7.5" fill={color.skin} />
              <circle cx="18" cy="20" r="4" fill={color.shade} />
            </g>
          ))}
        </>
      );
    case "bunny":
      return (
        <>
          {[0, 1].map((side) => (
            <g key={side} transform={side === 1 ? MIRROR : undefined}>
              <ellipse
                cx="24"
                cy="12"
                rx="5"
                ry="11"
                transform="rotate(-12 24 12)"
                fill={color.skin}
              />
              <ellipse
                cx="24"
                cy="13"
                rx="2.4"
                ry="7"
                transform="rotate(-12 24 13)"
                fill={color.shade}
              />
            </g>
          ))}
        </>
      );
    case "horns":
    case "antenna":
    case "sprout":
      return null;
  }
}

function TopFront({ top, color }: { top: Top; color: Color }) {
  switch (top) {
    case "horns": {
      const horn = (
        <path
          d="M22 21 Q17 12 21 7 Q23 14 28 18 Z"
          fill="#fff8e7"
          stroke={INK}
          strokeOpacity="0.25"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      );
      return (
        <>
          {horn}
          <g transform={MIRROR}>{horn}</g>
        </>
      );
    }
    case "antenna":
      return (
        <>
          <path
            d="M32 18 Q30 11 33 6"
            fill="none"
            stroke={color.shade}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="33" cy="6" r="3.5" fill="#ffe29a" stroke={color.shade} strokeWidth="1.5" />
        </>
      );
    case "sprout":
      return (
        <>
          <path d="M32 19 L32 12" stroke="#2f8a5c" strokeWidth="2" strokeLinecap="round" />
          <path d="M32 13 Q24 12 23 5 Q31 5 32 13 Z" fill="#7fc952" />
          <path d="M32 12 Q39 10 41 4 Q33 3 32 12 Z" fill="#a4f600" />
        </>
      );
    case "goblin":
    case "bear":
    case "bunny":
      return null;
  }
}

function HeadShape({ head, color }: { head: Head; color: Color }) {
  switch (head) {
    case "round":
      return <circle cx="32" cy="36" r="18.5" fill={color.skin} />;
    case "squircle":
      return <rect x="13.5" y="18" width="37" height="36" rx="15" fill={color.skin} />;
    case "egg":
      return (
        <path
          d="M32 16 C44 16 50 28 50 38 C50 48 42 55 32 55 C22 55 14 48 14 38 C14 28 20 16 32 16 Z"
          fill={color.skin}
        />
      );
  }
}

function EyePair({ eyes }: { eyes: Eyes }) {
  const happy = (x: number) => (
    <path
      d={`M${x - 3.5} 37 Q${x} 32.5 ${x + 3.5} 37`}
      fill="none"
      stroke={INK}
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  );
  const dot = (x: number) => <circle cx={x} cy="35.5" r="3" fill={INK} />;
  switch (eyes) {
    case "dots":
      return (
        <>
          {dot(25)}
          {dot(39)}
          <circle cx="26" cy="34.5" r="1" fill="#fff" />
          <circle cx="40" cy="34.5" r="1" fill="#fff" />
        </>
      );
    case "big":
      return (
        <>
          {[25, 39].map((x) => (
            <g key={x}>
              <circle cx={x} cy="35" r="5.5" fill="#fff" />
              <circle cx={x + 0.8} cy="35.8" r="3.2" fill={INK} />
              <circle cx={x + 1.8} cy="34.4" r="1.2" fill="#fff" />
            </g>
          ))}
        </>
      );
    case "happy":
      return (
        <>
          {happy(25)}
          {happy(39)}
        </>
      );
    case "wink":
      return (
        <>
          {dot(25)}
          <circle cx="26" cy="34.5" r="1" fill="#fff" />
          {happy(39)}
        </>
      );
  }
}

function MouthShape({ mouth }: { mouth: Mouth }) {
  const stroke = { fill: "none", stroke: INK, strokeWidth: 2.4, strokeLinecap: "round" } as const;
  switch (mouth) {
    case "smile":
      return <path d="M27 44 Q32 49 37 44" {...stroke} />;
    case "grin":
      return (
        <>
          <path
            d="M26 43 Q32 52 38 43 Z"
            fill={INK}
            stroke={INK}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M29 47.6 Q32 45.5 35 47.6 Q32 49.6 29 47.6 Z" fill="#f58f9a" />
        </>
      );
    case "cat":
      return <path d="M27 44 Q29.5 47.5 32 44 Q34.5 47.5 37 44" {...stroke} />;
    case "fang":
      return (
        <>
          <path d="M26.5 43.5 Q32 49 37.5 43.5" {...stroke} />
          <path
            d="M33.5 45.6 L34.8 49 L36.2 44.9 Z"
            fill="#fff"
            stroke={INK}
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        </>
      );
  }
}

export interface CreatureArtProps {
  id: number;
  /** Rendered width and height in pixels. */
  size?: number;
  /** Accessible name. Defaults to the creature's name; pass "" to hide it from screen readers. */
  title?: string;
  className?: string;
}

/** One creature as an inline SVG. */
export function CreatureArt({ id, size = 64, title, className }: CreatureArtProps) {
  const c = creature(id);
  const label = title ?? c.name;
  const clipId = `gb-creature-clip-${c.id}`;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={label === "" ? undefined : "img"}
      aria-hidden={label === "" ? true : undefined}
      aria-label={label === "" ? undefined : label}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="64" height="64" fill={c.color.bg} />
        <ellipse cx="32" cy="68" rx="22" ry="14" fill={c.color.shade} />
        <TopBack top={c.top} color={c.color} />
        <HeadShape head={c.head} color={c.color} />
        <TopFront top={c.top} color={c.color} />
        {c.blush && (
          <>
            <ellipse cx="20" cy="43" rx="3.2" ry="2.2" fill="#f2786c" opacity="0.35" />
            <ellipse cx="44" cy="43" rx="3.2" ry="2.2" fill="#f2786c" opacity="0.35" />
          </>
        )}
        <EyePair eyes={c.eyes} />
        <MouthShape mouth={c.mouth} />
      </g>
    </svg>
  );
}
