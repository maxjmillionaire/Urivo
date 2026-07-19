import type { Metadata } from "next";
import { LegalShell } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Legal Notice — Urivo" };

export default function LegalNotice() {
  return (
    <LegalShell title="Legal Notice">
      <p>Information pursuant to § 5 DDG (German Digital Services Act).</p>

      <h2>Service provider</h2>
      <p>
        <strong>buildwithmb</strong>
        <br />
        Owner: Max-Joel Basner
      </p>

      <h2>Registered address</h2>
      <p>
        Mörikestraße 79
        <br />
        73092 Heiningen
        <br />
        Germany
      </p>

      <h2>Contact</h2>
      <p>
        Email: <a href="mailto:urivosupport@gmail.com">urivosupport@gmail.com</a>
        <br />
        Phone: <a href="tel:+4915679817171">+49 15679 817171</a>
      </p>

      <h2>Responsible for content pursuant to § 18 (2) MStV</h2>
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
