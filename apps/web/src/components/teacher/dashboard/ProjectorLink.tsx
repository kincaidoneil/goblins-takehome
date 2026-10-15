import type { ReactNode } from "react";

/**
 * Opens the projector in its own window. It is a real link: a click first tries a sized popup,
 * and if the browser blocks it (window.open returns null), the link opens the projector in a new
 * tab instead, so the click never does nothing.
 */
export function ProjectorLink(props: {
  readonly sessionId: string;
  readonly variant: "primary" | "secondary";
  readonly size: "sm" | "md";
  readonly children: ReactNode;
}) {
  const href = `/sessions/${props.sessionId}/projector`;
  const name = `projector-${props.sessionId}`;
  return (
    <a
      href={href}
      target={name}
      className="gb-button no-underline"
      data-variant={props.variant}
      data-size={props.size}
      onClick={(event) => {
        const opened = window.open(href, name, "popup,width=1280,height=800");
        if (opened !== null) event.preventDefault();
      }}
    >
      {props.children}
    </a>
  );
}
