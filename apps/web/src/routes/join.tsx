import { Avatar, Button, Card, Field, Input, Wordmark } from "@goblins/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { type FormEvent, useState } from "react";
import { join } from "../server/fns/join";

// The router parses `?code=123456` as a number; a code with a leading zero stays a string.
const Search = Schema.Struct({ code: Schema.optional(Schema.Union(Schema.String, Schema.Number)) });

export const Route = createFileRoute("/join")({
  validateSearch: Schema.standardSchemaV1(Search),
  head: () => ({ meta: [{ title: "Join your class · Goblins" }] }),
  component: JoinPage,
});

type Step =
  | { readonly _tag: "Code"; readonly error?: string }
  | { readonly _tag: "Name"; readonly code: string; readonly error?: string };

function JoinPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const prefilled = String(search.code ?? "")
    .replace(/\D/g, "")
    .padStart(search.code === undefined ? 0 : 6, "0");
  const [step, setStep] = useState<Step>(
    prefilled.length === 6 ? { _tag: "Name", code: prefilled } : { _tag: "Code" },
  );
  const [code, setCode] = useState(prefilled);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setStep({ _tag: "Code", error: "The code is 6 numbers. It's on the board." });
      return;
    }
    setStep({ _tag: "Name", code: digits });
  };

  const submitName = async (event: FormEvent) => {
    event.preventDefault();
    if (step._tag !== "Name") return;
    setPending(true);
    const result = await join({ data: { joinCode: step.code, name } });
    setPending(false);
    if (result._tag === "Ok") {
      await navigate({ to: "/play/$sessionId", params: { sessionId: result.value.sessionId } });
      return;
    }
    switch (result.error._tag) {
      case "SessionNotFound":
        setStep({
          _tag: "Code",
          error: "We couldn't find that class. Check the code on the board.",
        });
        return;
      case "InvalidName":
        setStep({
          ...step,
          error:
            result.error.reason === "empty"
              ? "Type your first name."
              : "That's a long name. Try your first name and last initial.",
        });
        return;
    }
  };

  return (
    <main className="min-h-dvh bg-bg px-4 py-10 sm:py-20">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-6">
        <Wordmark product="goblins" />
        <div className="flex -space-x-3" aria-hidden="true">
          {[3, 17, 29].map((id) => (
            <Avatar key={id} kind="creature" creatureId={id} size="lg" />
          ))}
        </div>
        <h1 className="text-center text-2xl">Join your class</h1>
        <Card className="w-full">
          {step._tag === "Code" ? (
            <form onSubmit={submitCode} className="flex flex-col gap-5">
              <Field label="Class code" error={step.error}>
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123 456"
                  maxLength={7}
                  className="text-center text-2xl tracking-[0.3em]"
                />
              </Field>
              <Button type="submit" size="lg">
                Next
              </Button>
            </form>
          ) : (
            <form onSubmit={submitName} className="flex flex-col gap-5">
              <Field
                label="Your name"
                description="First name and last initial, like Maya R."
                error={step.error}
              >
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="words"
                  autoFocus
                  maxLength={40}
                  placeholder="Maya R."
                />
              </Field>
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? "Joining…" : "Join"}
              </Button>
              <button
                type="button"
                className="text-sm text-text-muted underline-offset-4 hover:underline"
                onClick={() => setStep({ _tag: "Code" })}
              >
                Use a different code
              </button>
            </form>
          )}
        </Card>
        {step._tag === "Name" && (
          <p className="text-center text-sm text-text-muted">
            Joined before on another device? Type the same name to pick up where you left off.
          </p>
        )}
      </div>
    </main>
  );
}
