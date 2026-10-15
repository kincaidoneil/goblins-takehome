/**
 * Whiteboard images. In production they go to Vercel Blob. Without a Blob token (local
 * development and local E2E runs) the image is kept inline as a `data:` URL on the submission,
 * which needs no file server.
 */
import { put } from "@vercel/blob";
import { Config, Context, Effect, Layer, Option } from "effect";

export class WhiteboardStore extends Context.Tag("@goblins/web/WhiteboardStore")<
  WhiteboardStore,
  {
    /** Stores a PNG and returns the URL to save on the submission. */
    readonly put: (name: string, png: Uint8Array) => Effect.Effect<string>;
  }
>() {}

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
      put: (_name, png) =>
        Effect.succeed(`data:image/png;base64,${Buffer.from(png).toString("base64")}`),
    };
  }),
);
