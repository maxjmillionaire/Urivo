/*
 * The dashboard's loading state — the CONTENT region only.
 *
 * This used to render ShellSkeleton, the whole frame including a skeleton
 * sidebar and rail, because the shell lived inside each page and there was
 * nothing else on screen to keep. With the shell in layout.tsx the navigation
 * stays mounted and real, so a loading state that redrew it would be replacing
 * live furniture with a picture of itself.
 *
 * Deliberately quieter than the old one: three settling blocks in the same
 * geometry the content occupies, so nothing moves when the real page arrives.
 * ShellSkeleton is still used for the first paint of the shell itself
 * (app/(platform)/loading.tsx covers the cold load).
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="flex items-center justify-between">
        <div className="space-y-2.5">
          <div className="u-skel h-6 w-52 rounded-md" />
          <div className="u-skel h-3 w-40 rounded-md" />
        </div>
        <div className="u-skel h-9 w-32 rounded-lg" />
      </div>
      <div className="u-skel mt-7 h-24 rounded-2xl" />
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_264px]">
        <div className="u-skel h-56 rounded-2xl" />
        <div className="u-skel h-56 rounded-2xl" />
      </div>
      <div className="u-skel mt-8 h-40 rounded-2xl" />
    </div>
  );
}
