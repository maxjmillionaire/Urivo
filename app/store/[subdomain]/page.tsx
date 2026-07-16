import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { parseTheme } from "@/lib/storefront";

export const dynamic = "force-dynamic";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

interface Props {
  params: Promise<{ subdomain: string }>;
}

async function loadStore(subdomain: string) {
  if (!SUBDOMAIN_PATTERN.test(subdomain)) return null;
  const supabase = await supabaseServer();
  const { data: store } = await supabase
    .from("stores")
    .select("id, store_name, theme_config")
    .eq("subdomain", subdomain)
    .eq("is_active", true)
    .single();
  return store ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) return { title: "Store not found" };
  const theme = parseTheme(store.theme_config);
  return {
    title: store.store_name,
    description: theme.tagline || `${store.store_name} — powered by Urivo.`,
  };
}

export default async function StorefrontPage({ params }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();

  const supabase = await supabaseServer();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, description, price_eur")
    .eq("store_id", store.id)
    .order("position", { ascending: true });

  const theme = parseTheme(store.theme_config);
  const catalog = products ?? [];

  return (
    <div
      className="min-h-screen px-6 py-16 sm:px-10 sm:py-20"
      style={{
        backgroundColor: theme.background,
        color: theme.structure,
        fontFamily: theme.bodyFont,
      }}
    >
      <div className="mx-auto w-full max-w-4xl">
        <header
          className="border-b pb-10"
          style={{ borderColor: `${theme.structure}1A` }}
        >
          <h1
            className="text-5xl font-normal tracking-tight sm:text-6xl"
            style={{ fontFamily: theme.headingFont }}
          >
            {store.store_name}
          </h1>
          {theme.tagline && (
            <p className="mt-4 text-lg italic opacity-70">{theme.tagline}</p>
          )}
        </header>

        <main className="mt-12">
          {catalog.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-50">
                Opening soon
              </p>
              <p
                className="mt-4 text-2xl"
                style={{ fontFamily: theme.headingFont }}
              >
                The collection is being curated.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-[0.25em] opacity-60">
                The collection
              </h2>
              <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
                {catalog.map((product) => (
                  <article
                    key={product.id}
                    className="flex flex-col justify-between border p-7 transition-transform duration-300 hover:scale-[1.01]"
                    style={{
                      borderColor: `${theme.structure}1A`,
                      backgroundColor: "rgba(255,255,255,0.25)",
                    }}
                  >
                    <div>
                      <h3
                        className="text-xl"
                        style={{ fontFamily: theme.headingFont }}
                      >
                        {product.title}
                      </h3>
                      {product.description && (
                        <p className="mt-3 text-sm leading-relaxed opacity-75">
                          {product.description}
                        </p>
                      )}
                    </div>
                    <p className="mt-6 text-lg font-medium">
                      €{Number(product.price_eur).toFixed(2)}
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </main>

        <footer
          className="mt-20 border-t pt-8 text-center text-[10px] font-semibold uppercase tracking-[0.25em] opacity-40"
          style={{ borderColor: `${theme.structure}1A` }}
        >
          Powered by Urivo
        </footer>
      </div>
    </div>
  );
}
