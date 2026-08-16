import "@/app/globals.css";

/*
 * Neutral root layout. It exists for one structural reason: to give the app a
 * single root so the global not-found (app/not-found.tsx) resolves with a
 * correct 404 status. It is deliberately BARE — no font classes, no background,
 * no theme on <html>/<body> — so generated merchant storefronts under (store)
 * stay pristine and paint their own canvas. Urivo's own surfaces apply their
 * theme in the (platform) layout wrapper, never here.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
