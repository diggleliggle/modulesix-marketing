// functions/_middleware.js
//
// Blocks everything on this origin that is not front end.
//
// modulesix.co.uk is a Pages project built from the repository root. The 9 Aug
// Pages exposure note recorded that this repo "tracks zero non-front-end files,
// so there is nothing to expose by construction". That stopped being true when
// patch-ms-calibrate-nod.py was committed, and .DS_Store was tracked at the root
// the whole time. Both were publicly downloadable from modulesix.co.uk.
//
// Untracking them was not enough on its own. Cloudflare revalidates a cached
// object against the origin, gets a 404 for a file that no longer exists, and
// hands out the stale copy rather than evicting it. That is the same mechanism
// that kept serving the retired Activate exam banks after they were deleted, and
// a cache purge did not hold there. Functions answer before static asset
// resolution AND before the cache is consulted, so this returns a real 404.
//
// Do not try to do this with _redirects. Pages matches an existing static asset
// BEFORE it consults _redirects, so a 404 rule there can never block a file that
// exists. That was tried on the Calibrate origin and verified ineffective live.
//
// _routes.json uses a precise include list and an EMPTY exclude list, on purpose.
// Exclude takes precedence over include in Pages, and a broad exclude is exactly
// what left the whole competency library readable on Calibrate after that origin
// had already been audited and fixed.
//
// Deny lists rot. The structural fix is to stop building Pages from the repo root
// and point the build output at a folder holding only front-end files.

const BLOCKED_PREFIXES = ['/.git/', '/.github/', '/.wrangler/', '/functions/', '/node_modules/'];

// Removed from the build, but the edge may still hold a cached copy.
const REMOVED_BUT_CACHED = [
  '/patch-ms-calibrate-nod.py',
  '/.ds_store',
  '/courses/.ds_store',
];

const BLOCKED_EXACT = [
  ...REMOVED_BUT_CACHED,
  '/package.json',
  '/package-lock.json',
  '/readme.md',
];

const BLOCKED_EXTENSIONS = ['.py', '.md', '.sql', '.toml', '.lock', '.mjs', '.yml', '.yaml', '.env', '.bak', '.ts'];

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.toLowerCase();

  const blocked =
    BLOCKED_PREFIXES.some((p) => path.startsWith(p)) ||
    BLOCKED_EXACT.includes(path) ||
    BLOCKED_EXTENSIONS.some((e) => path.endsWith(e));

  if (blocked) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    });
  }

  return context.next();
}
