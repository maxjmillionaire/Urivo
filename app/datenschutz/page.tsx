import type { Metadata } from "next";
import { LegalShell, Placeholder } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Datenschutzerklärung — Urivo" };

export default function Datenschutz() {
  return (
    <LegalShell title="Datenschutzerklärung">
      <p>
        Diese Erklärung informiert über die Verarbeitung personenbezogener Daten
        gemäß DSGVO bei der Nutzung von Urivo.
      </p>

      <h2>Verantwortlicher</h2>
      <Placeholder note="Name und Kontaktdaten des Verantwortlichen (siehe Impressum)" />

      <h2>Verarbeitete Daten</h2>
      <p>
        Urivo verarbeitet Konto- und Nutzungsdaten, um den Dienst
        bereitzustellen: E-Mail-Adresse und Authentifizierung (Supabase),
        Store- und Produktdaten, Abrechnungsdaten (Stripe) sowie technische
        Protokolle. Eingegebene Ideen werden zur Generierung an Anthropic
        (Claude) übermittelt.
      </p>

      <h2>Auftragsverarbeiter</h2>
      <p>
        Supabase (Auth, Datenbank), Anthropic (KI-Generierung), Stripe
        (Zahlungen), Resend (E-Mail), Railway (Hosting), Cloudflare (CDN/DNS),
        PostHog und Sentry (Analyse und Fehler-Monitoring).
      </p>
      <Placeholder note="Auftragsverarbeitungsverträge (AVV) bestätigen und Server-Standorte / Drittlandtransfers dokumentieren" />

      <h2>Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft, Berichtigung, Löschung,
        Einschränkung, Datenübertragbarkeit und Widerspruch. Ihr Konto und alle
        zugehörigen Daten können Sie in den Einstellungen selbst löschen.
      </p>

      <h2>Cookies &amp; Analyse</h2>
      <p>
        Notwendige Cookies dienen der Anmeldung. Analyse (PostHog) erfolgt erst
        nach Einwilligung.
      </p>
      <Placeholder note="Rechtsgrundlagen, Speicherfristen und Kontakt der Datenschutz-Aufsichtsbehörde ergänzen" />
    </LegalShell>
  );
}
