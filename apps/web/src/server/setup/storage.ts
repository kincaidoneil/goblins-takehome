/**
 * Where uploaded worksheet pages are stored: Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (every
 * Vercel deploy), otherwise inline as a `data:` URL, so local development and local production
 * builds need no Blob store. Pages are 80–140 KB JPEGs, so inline storage stays small.
 */
import { put } from "@vercel/blob";
import { Data, Effect } from "effect";

export class StorageFailed extends Data.TaggedError("StorageFailed")<{ readonly cause: unknown }> {}

const hasBlob = () => (process.env.BLOB_READ_WRITE_TOKEN ?? "") !== "";

/** Stores a file under `pathname` and returns its URL. */
export const storeFile = (pathname: string, body: Blob, contentType: string) =>
  Effect.tryPromise({
    try: async () => {
      if (hasBlob()) {
        const result = await put(pathname, body, {
          access: "public",
          contentType,
          addRandomSuffix: true,
        });
        return result.url;
      }
      const base64 = Buffer.from(await body.arrayBuffer()).toString("base64");
      return `data:${contentType};base64,${base64}`;
    },
    catch: (cause) => new StorageFailed({ cause }),
  });
