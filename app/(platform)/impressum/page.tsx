import type { Metadata } from "next";
import { LegalShell, Placeholder } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Impressum — Urivo" };

export default function Impressum() {
  return (
    <LegalShell title="Impressum">
      <p>Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).</p>
      <Placeholder note="Betreiber (Name / Firma buildwithmb), Anschrift, E-Mail, Telefon, ggf. USt-IdNr. und Handelsregister" />
      <h2>Verantwortlich für den Inhalt</h2>
      <Placeholder note="Name und Anschrift des inhaltlich Verantwortlichen (§ 18 Abs. 2 MStV)" />
      <h2>Kontakt</h2>
      <Placeholder note="E-Mail-Adresse und ggf. weitere Kontaktwege" />
    </LegalShell>
  );
}
