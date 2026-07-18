import type { Metadata } from "next";
import { LegalShell, Placeholder } from "../legal/legal-shell";

export const metadata: Metadata = { title: "AGB — Urivo" };

export default function AGB() {
  return (
    <LegalShell title="Allgemeine Geschäftsbedingungen">
      <h2>1. Geltungsbereich</h2>
      <p>
        Diese AGB gelten für die Nutzung der Urivo-Plattform, einer
        SaaS-Anwendung zur KI-gestützten Erstellung und Verwaltung von
        Online-Storefronts.
      </p>

      <h2>2. Leistungen</h2>
      <p>
        Urivo stellt Funktionen zur Marktrecherche, Markenerstellung,
        Storefront-Generierung und -Verwaltung bereit. Die Nutzung erfolgt über
        ein Kredit- und Abomodell.
      </p>

      <h2>3. Preise &amp; Abrechnung</h2>
      <p>
        Es gelten die auf urivo.ai angegebenen Preise (Core, Pro sowie ein
        kostenloser Tarif). Während des Launch-Zeitraums gebuchte Abonnements
        behalten ihren Launch-Preis für die Laufzeit des Abonnements. Die
        Abrechnung erfolgt über Stripe.
      </p>

      <h2>4. Widerruf</h2>
      <Placeholder note="Widerrufsbelehrung für Verbraucher inkl. Muster-Widerrufsformular ergänzen" />

      <h2>5. Kündigung</h2>
      <p>Abonnements sind jederzeit zum Ende des Abrechnungszeitraums kündbar.</p>

      <h2>6. Haftung &amp; Inhalte</h2>
      <p>
        Für generierte Inhalte ist der jeweilige Händler verantwortlich. Urivo
        übernimmt keine Gewähr für die rechtliche Zulässigkeit der vom Nutzer
        veröffentlichten Store-Inhalte.
      </p>
      <Placeholder note="Haftungsbeschränkung, Gewährleistung und Gerichtsstand durch Rechtsberatung final prüfen lassen" />
    </LegalShell>
  );
}
