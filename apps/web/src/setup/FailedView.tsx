/** When a worksheet can't be set up: say why in plain words and offer a way forward. */
import { Button, CreatureArt, EmptyState } from "@goblins/ui";

export function FailedView({ reason }: { readonly reason: string }) {
  return (
    <div className="setup-centered">
      <EmptyState
        art={<CreatureArt id={7} size={96} title="" />}
        title="We couldn't set this one up"
        description={reason}
        actions={
          <>
            <Button nativeButton={false} render={<a href="/#templates" />}>
              Try a template
            </Button>
            <Button variant="secondary" nativeButton={false} render={<a href="/" />}>
              Upload a different worksheet
            </Button>
          </>
        }
      />
    </div>
  );
}
