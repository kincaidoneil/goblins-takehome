/**
 * Whiteboard images, kept inline as a `data:` URL on the submission. The model reads it
 * directly, and it needs no file server.
 *
 * Vercel Blob is set up but its store is private, and `access: "public"` uploads fail
 * there, which broke every submit in production. Reading private blobs needs signed
 * reads for the model and the dashboard; until that lands, set
 * `WHITEBOARD_STORE=blob` only against a public store.
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
    const useBlob = (yield* Config.option(Config.string("WHITEBOARD_STORE"))).pipe(
      Option.exists((store) => store === "blob"),
    );
    if (useBlob && Option.isSome(token)) {
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
