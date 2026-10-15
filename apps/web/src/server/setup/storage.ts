/**
 * Where uploaded worksheet pages are stored. Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (every
 * Vercel deploy); otherwise `public/_local-blob`, which the Vite dev server serves as static files,
 * so local development needs no Blob store.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { put } from "@vercel/blob";
import { Data, Effect } from "effect";

export class StorageFailed extends Data.TaggedError("StorageFailed")<{ readonly cause: unknown }> {}

const LOCAL_DIR = "_local-blob";

const hasBlob = () => (process.env.BLOB_READ_WRITE_TOKEN ?? "") !== "";

/** Stores a file under `pathname` and returns its public URL. */
export const storeFile = (pathname: string, body: Blob, contentType: string) =>
  hasBlob()
    ? Effect.tryPromise({
        try: () =>
          put(pathname, body, { access: "public", contentType, addRandomSuffix: true }).then(
            (result) => result.url,
          ),
        catch: (cause) => new StorageFailed({ cause }),
      })
    : Effect.tryPromise({
        try: async () => {
          const path = join(process.cwd(), "public", LOCAL_DIR, pathname);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, Buffer.from(await body.arrayBuffer()));
          return `/${LOCAL_DIR}/${pathname}`;
        },
        catch: (cause) => new StorageFailed({ cause }),
      });
