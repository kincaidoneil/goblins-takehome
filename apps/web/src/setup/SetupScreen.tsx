/**
 * The review screen: the worksheet pages, the problems as the grader will know them, and the chat.
 * Three columns on a wide screen; on narrower ones the pages and chat move into tabs or sheets.
 */
import { Button, CreatureArt, Dialog, Tabs, useToast } from "@goblins/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Draft, DraftProblem } from "../server/setup/draft";
import type { Edit } from "../server/setup/edits";
import { editDraft, sendChatMessage } from "../server/setup/fns";
import { ChatPanel } from "./ChatPanel";
import { EditableText } from "./EditableText";
import { LaunchDialog } from "./LaunchDialog";
import { PagesPanel } from "./PagesPanel";
import { ProblemCard } from "./ProblemCard";
import { groupProblems, totalPoints } from "./problem-groups";
import { useMediaQuery } from "./use-media-query";

export interface SetupScreenProps {
  readonly initial: Draft;
  /** Whether the server sees a signed-in teacher, so launch can skip the sign-in step. */
  readonly signedIn: boolean;
  /** Open the launch dialog on arrival, after returning from sign-in. */
  readonly launchOnArrival: boolean;
  readonly initialTimeLimit: number | null;
}

type SaveState = "saved" | "saving" | "failed";

const suggestionsFor = (problems: ReadonlyArray<DraftProblem>): ReadonlyArray<string> => {
  const whole =
    problems.find((p) => /^\d+$/.test(p.label) && p.rubric.length > 1 && p.label !== "1") ??
    problems.find((p) => p.rubric.length > 1);
  const numbers = problems.map((p) => Number.parseInt(p.label, 10)).filter(Number.isFinite);
  const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  return [
    ...(whole === undefined
      ? []
      : [`Make problem ${whole.label} worth ${totalPoints(whole) + 2} points`]),
    "Accept unsimplified fractions",
    `You missed problem ${next}`,
  ];
};

export function SetupScreen({
  initial,
  signedIn,
  launchOnArrival,
  initialTimeLimit,
}: SetupScreenProps) {
  const [draft, setDraft] = useState(initial);
  const [save, setSave] = useState<SaveState>("saved");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [newProblemIds, setNewProblemIds] = useState<ReadonlySet<string>>(new Set());
  const [activeProblemId, setActiveProblemId] = useState<string | null>(null);
  const [focusPage, setFocusPage] = useState<{ page: number; at: number } | null>(null);
  const [enlargedPage, setEnlargedPage] = useState<number | null>(null);
  const [launchOpen, setLaunchOpen] = useState(launchOnArrival);
  const [timeLimit, setTimeLimit] = useState<number | null>(initialTimeLimit);
  const [titleError, setTitleError] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 1200px)");
  const phone = !useMediaQuery("(min-width: 800px)");
  const titleRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // Marks the screen interactive, so tests wait for hydration instead of a timeout.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const groups = useMemo(() => groupProblems(draft.problems), [draft.problems]);
  const points = draft.problems.reduce((sum, p) => sum + totalPoints(p), 0);
  const activeProblem = draft.problems.find((p) => p.id === activeProblemId);

  // Clear the highlight a few seconds after a chat change.
  useEffect(() => {
    if (highlighted.size === 0) return;
    const timer = setTimeout(() => setHighlighted(new Set()), 2600);
    return () => clearTimeout(timer);
  }, [highlighted]);

  const scrollToProblem = (id: string) =>
    document
      .getElementById(`problem-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  // Edits run one at a time, each built from the draft as the previous one left it, so two quick
  // changes to the same rubric can't overwrite each other.
  const latest = useRef(draft);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);

  const applyEdits = (build: ReadonlyArray<Edit> | ((latest: Draft) => ReadonlyArray<Edit>)) => {
    inFlight.current++;
    setSave("saving");
    queue.current = queue.current.then(async () => {
      const edits = typeof build === "function" ? build(latest.current) : build;
      const outcome = edits.length === 0 ? null : await runEdits(edits);
      inFlight.current--;
      if (outcome === "failed") setSave("failed");
      else if (inFlight.current === 0) setSave("saved");
    });
    return queue.current;
  };

  const runEdits = async (edits: ReadonlyArray<Edit>): Promise<"saved" | "failed"> => {
    const result = await editDraft({ data: { draftId: draft.id, edits: [...edits] } }).catch(
      () => null,
    );
    if (result === null) {
      toast({
        title: "That change didn't save",
        description: "Check your connection and try again.",
        tone: "attention",
      });
      return "failed";
    }
    if (result._tag === "Ok") {
      latest.current = result.value;
      setDraft(result.value);
      return "saved";
    }
    switch (result.error._tag) {
      case "DraftLocked":
        toast({
          title: "This assignment is live",
          description: "Its rubric is locked now that students can join.",
          tone: "attention",
        });
        return "failed";
      case "EditRejected":
        toast({
          title:
            result.error.reason === "last_problem"
              ? "An assignment needs at least one problem"
              : "That change didn't save",
          tone: "attention",
        });
        return "failed";
      case "DraftNotFound":
        toast({
          title: "That change didn't save",
          description: "Reload the page and try again.",
          tone: "attention",
        });
        return "failed";
    }
  };

  const sendChat = async (message: string) => {
    setPendingMessage(message);
    const result = await sendChatMessage({ data: { draftId: draft.id, message } });
    setPendingMessage(null);
    if (result._tag !== "Ok") {
      toast({
        title: "The chat couldn't make that change",
        description: "Try again, or edit the problem directly.",
        tone: "attention",
      });
      return;
    }
    const before = new Set(draft.problems.map((p) => p.id));
    latest.current = result.value.draft;
    setDraft(result.value.draft);
    setHighlighted(new Set(result.value.changed));
    setNewProblemIds(
      new Set(result.value.draft.problems.filter((p) => !before.has(p.id)).map((p) => p.id)),
    );
    const [first] = result.value.changed;
    if (first !== undefined) {
      if (phone) setChatOpen(false);
      requestAnimationFrame(() => scrollToProblem(first));
    }
  };

  const showPage = (page: number) => {
    if (wide) setFocusPage({ page, at: Date.now() });
    else setEnlargedPage(page);
  };

  const openLaunch = () => {
    if (draft.title.trim() === "") {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    setLaunchOpen(true);
  };

  const onProblemNeedsText = (label: string) => {
    const problem = draft.problems.find((p) => p.label === label);
    if (problem === undefined) return;
    setNewProblemIds(new Set([problem.id]));
    setHighlighted(new Set([problem.id]));
    scrollToProblem(problem.id);
    toast({
      title: `Problem ${label} isn't finished`,
      description: "It needs its text and an answer key before students can be graded on it.",
      tone: "attention",
    });
  };

  const problems = (
    <div className="setup-problems">
      {groups.map((group) => (
        <div
          key={group.problems[0]?.id ?? group.number}
          className="setup-group"
          data-parts={group.stem !== null || undefined}
        >
          {group.stem !== null && (
            <div className="setup-group-header">
              <h3 className="setup-group-title">
                Problem {group.number}
                <span className="setup-group-count">
                  {group.problems.length} parts, graded separately
                </span>
              </h3>
              {group.stem !== "" && (
                <EditableText
                  value={group.stem}
                  label={`Problem ${group.number} shared text`}
                  placeholder="Text shared by every part."
                  className="setup-stem"
                  onSave={(stem) => {
                    const old = group.stem ?? "";
                    const ids = new Set(group.problems.map((p) => p.id));
                    void applyEdits((current) =>
                      current.problems
                        .filter((p) => ids.has(p.id) && p.text.startsWith(old))
                        .map((p) => ({
                          _tag: "SetField",
                          problemId: p.id,
                          field: "text",
                          value: `${stem}${p.text.slice(old.length)}`,
                        })),
                    );
                  }}
                />
              )}
            </div>
          )}
          {group.problems.map((problem) => {
            const index = draft.problems.indexOf(problem);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover only outlines the matching page
              <div
                key={problem.id}
                onMouseEnter={() => setActiveProblemId(problem.id)}
                onFocusCapture={() => setActiveProblemId(problem.id)}
              >
                <ProblemCard
                  problem={problem}
                  earlier={draft.problems.slice(0, index)}
                  usedBy={draft.problems
                    .filter((p) => p.dependsOn.includes(problem.id))
                    .map((p) => p.label)}
                  stem={group.stem === "" ? null : group.stem}
                  highlighted={highlighted.has(problem.id)}
                  isNew={newProblemIds.has(problem.id) && problem.text.trim() === ""}
                  needsAnswerKey={newProblemIds.has(problem.id) && problem.answerKey.trim() === ""}
                  onEdit={(build) =>
                    void applyEdits((current) => {
                      if (typeof build !== "function") return build;
                      const fresh = current.problems.find((p) => p.id === problem.id);
                      return fresh === undefined ? [] : build(fresh);
                    })
                  }
                  onShowPage={showPage}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  const chat = (
    <ChatPanel
      messages={draft.chat}
      pending={pendingMessage}
      onSend={(message) => void sendChat(message)}
      suggestions={suggestionsFor(draft.problems)}
    />
  );

  const pages = (
    <PagesPanel
      pages={draft.pages}
      activePages={activeProblem?.pageNumbers ?? []}
      focusPage={focusPage}
      onOpenPage={setEnlargedPage}
    />
  );

  return (
    <div className="setup-screen" data-testid="setup-review" data-hydrated={hydrated || undefined}>
      <header className="setup-topbar">
        <Link to="/" className="setup-wordmark" aria-label="Goblins Grader home">
          <CreatureArt id={0} size={32} title="" />
          <span>
            Goblins <span className="setup-wordmark-sub">Grader</span>
          </span>
        </Link>
        <div className="setup-title-field">
          <input
            ref={titleRef}
            className="setup-title-input"
            aria-label="Assignment name"
            aria-invalid={titleError || undefined}
            placeholder="Name this assignment"
            defaultValue={draft.title}
            maxLength={120}
            onChange={() => setTitleError(false)}
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (title !== draft.title) void applyEdits([{ _tag: "SetTitle", title }]);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <p className="setup-title-meta">
            {titleError ? (
              <span className="setup-error">Name it so you can find it later.</span>
            ) : (
              <>
                {draft.problems.length} problems · {points} points ·{" "}
                <span data-state={save}>
                  {save === "saving" ? "Saving…" : save === "saved" ? "Saved" : "Not saved"}
                </span>
              </>
            )}
          </p>
        </div>
        <Button
          size="lg"
          onClick={openLaunch}
          className="setup-launch-button"
          data-testid="setup-launch"
        >
          Launch
        </Button>
      </header>

      {wide ? (
        <div className="setup-columns" data-layout="three">
          <aside className="setup-column setup-column-pages">{pages}</aside>
          <main className="setup-column setup-column-main">{problems}</main>
          <aside className="setup-column setup-column-chat">{chat}</aside>
        </div>
      ) : phone ? (
        <main className="setup-column-main setup-phone">
          {problems}
          <button type="button" className="setup-chat-fab" onClick={() => setChatOpen(true)}>
            <CreatureArt id={0} size={28} title="" /> Ask for changes
          </button>
          <Dialog
            open={chatOpen}
            onOpenChange={setChatOpen}
            title="Ask for changes"
            className="setup-chat-sheet"
          >
            {chat}
          </Dialog>
        </main>
      ) : (
        <div className="setup-columns" data-layout="two">
          <main className="setup-column setup-column-main">{problems}</main>
          <aside className="setup-column setup-column-chat">
            <Tabs
              items={[
                { value: "chat", label: "Ask for changes", content: chat },
                { value: "pages", label: "Worksheet", content: pages },
              ]}
            />
          </aside>
        </div>
      )}

      <Dialog
        open={enlargedPage !== null}
        onOpenChange={(open) => !open && setEnlargedPage(null)}
        title={`Page ${enlargedPage ?? ""}`}
        size="lg"
      >
        {enlargedPage !== null && (
          <img
            className="setup-enlarged-page"
            src={draft.pages.find((p) => p.pageNumber === enlargedPage)?.imageUrl}
            alt={`Worksheet page ${enlargedPage}`}
          />
        )}
      </Dialog>

      <LaunchDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        draftId={draft.id}
        title={draft.title}
        problemCount={draft.problems.length}
        points={points}
        timeLimitMinutes={timeLimit}
        onTimeLimitChange={setTimeLimit}
        saving={save === "saving"}
        signedIn={signedIn}
        onProblemNeedsText={onProblemNeedsText}
      />
    </div>
  );
}
