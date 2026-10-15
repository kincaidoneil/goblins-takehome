// Fails when a workspace package skips the shared conventions, so CI can't pass
// by silently not typechecking a package. See AGENTS.md, "Code".
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors pnpm-workspace.yaml.
const children = (root: string) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name))
    : [];
const packageDirs = [...children("apps"), ...children("packages"), "e2e"].filter((dir) =>
  existsSync(join(dir, "package.json")),
);

const problems: Array<string> = [];
for (const dir of packageDirs) {
  const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const scripts =
    typeof manifest === "object" && manifest !== null && "scripts" in manifest
      ? manifest.scripts
      : undefined;
  if (typeof scripts !== "object" || scripts === null || !("typecheck" in scripts)) {
    problems.push(`${dir}: package.json has no "typecheck" script`);
  }
  const tsconfigPath = join(dir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    problems.push(`${dir}: no tsconfig.json`);
  } else if (!readFileSync(tsconfigPath, "utf8").includes("tsconfig.base.json")) {
    problems.push(`${dir}: tsconfig.json does not extend the root tsconfig.base.json`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
