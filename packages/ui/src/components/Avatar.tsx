import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cx } from "../cx";
import { CreatureArt, creature } from "./creatures";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const PIXELS: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 44, lg: 64, xl: 112 };

export type AvatarProps = {
  size?: AvatarSize;
  className?: string;
} & (
  | {
      /** A student: one of the generated creatures. */
      kind: "creature";
      creatureId: number;
      /** The student's name, used as the accessible label. */
      name?: string;
    }
  | {
      /** A teacher: their Google photo, falling back to initials. */
      kind: "person";
      name: string;
      src?: string;
    }
);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar(props: AvatarProps) {
  const size = props.size ?? "md";
  const px = PIXELS[size];
  if (props.kind === "creature") {
    const label = props.name ?? creature(props.creatureId).name;
    return (
      <span className={cx("gb-avatar", props.className)} data-size={size}>
        <CreatureArt id={props.creatureId} size={px} title={label} />
      </span>
    );
  }
  return (
    <BaseAvatar.Root
      className={cx("gb-avatar", "gb-avatar-person", props.className)}
      data-size={size}
      aria-label={props.name}
      role="img"
    >
      {props.src !== undefined && (
        <BaseAvatar.Image
          className="gb-avatar-image"
          src={props.src}
          alt=""
          width={px}
          height={px}
        />
      )}
      <BaseAvatar.Fallback className="gb-avatar-fallback" aria-hidden="true">
        {initials(props.name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
