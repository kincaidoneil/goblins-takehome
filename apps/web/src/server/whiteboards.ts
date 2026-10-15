/**
 * Whiteboard images. In production they go to Vercel Blob; without a Blob token (local
 * development, E2E against a local server) they go to a folder on disk and are served by
 * `/api/whiteboards/$name`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { put } from "@vercel/blob";
import { Config, Context, Effect, Layer, Option } from "effect";

export class WhiteboardStore extends Context.Tag("@goblins/web/WhiteboardStore")<
  WhiteboardStore,
  {
    /** Stores a PNG and returns the URL to save on the submission. */
    readonly put: (name: string, png: Uint8Array) => Effect.Effect<string>;
  }
>() {}

export const localWhiteboardDir = join(tmpdir(), "goblins-whiteboards");

/** Reads a whiteboard stored on local disk. Names are generated server-side, never paths. */
export const readLocalWhiteboard = (name: string) =>
  /^[a-zA-Z0-9-]+\.png$/.test(name)
    ? Effect.promise(() => readFile(join(localWhiteboardDir, name))).pipe(Effect.option)
    : Effect.succeed(Option.none<Buffer>());

export const WhiteboardStoreLive = Layer.effect(
  WhiteboardStore,
  Effect.gen(function* () {
    const token = yield* Config.option(Config.redacted("BLOB_READ_WRITE_TOKEN"));
    if (Option.isSome(token)) {
      return {
        put: (name, png) =>
          Effect.promise(() =>
            put(`whiteboards/${name}`, Buffer.from(png), {
              access: "public",
              contentType: "image/png",
              addRandomSuffix: true,
            }),
          ).pipe(Effect.map((blob) => blob.url)),
      };
    }
    return {
      put: (name, png) =>
        Effect.promise(async () => {
          await mkdir(localWhiteboardDir, { recursive: true });
          await writeFile(join(localWhiteboardDir, name), png);
          return `/api/whiteboards/${name}`;
        }),
    };
  }),
);
