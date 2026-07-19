import type { Metadata } from "next";
import { LegalShell } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Impressum — Urivo" };

export default function Impressum() {
  return (
    <LegalShell title="Impressum">
      <p>Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).</p>

      <h2>Diensteanbieter</h2>
      <p>
        <strong>buildwithmb</strong>
        <br />
        Inhaber: Max-Joel Basner
      </p>

      <h2>Ladungsfähige Anschrift</h2>
      <p>
        Mörikestraße 79
        <br />
        73092 Heiningen
        <br />
        Deutschland
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href="mailto:urivosupport@gmail.com">urivosupport@gmail.com</a>
        <br />
        Telefon: <a href="tel:+4915679817171">015679 817171</a>
      </p>

      <h2>Verantwortlich für den Inhalt (§ 18 Abs. 2 MStV)</h2>
      <p>
        Max-Joel Basner
        <br />
        Mörikestraße 79
        <br />
        73092 Heiningen
      </p>
    </LegalShell>
  );
}
