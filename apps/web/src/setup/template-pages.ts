/**
 * URLs of the template worksheet pages, as built assets. Both the server (which stores them as a
 * draft's worksheet pages) and the client import this module, so the client build emits the files
 * and the server records the same hashed URLs.
 */
const pages = import.meta.glob<string>("../../../../packages/templates/templates/*/page-*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Page image URLs for a template, in page order. */
export const templatePageUrls = (templateId: string): ReadonlyArray<string> =>
  Object.entries(pages)
    .flatMap(([path, url]) => {
      const match = /templates\/([a-z0-9-]+)\/page-(\d+)\.png$/.exec(path);
      return match?.[1] === templateId ? [{ page: Number(match[2]), url }] : [];
    })
    .sort((a, b) => a.page - b.page)
    .map((entry) => entry.url);
