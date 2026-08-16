# 11 — Ask Urivo Voice Copilot

**Status: specified, not built.** Nothing in this document exists in the
codebase yet. It is the product decision record for post-launch implementation,
written while the decisions were fresh rather than reconstructed later.

---

## 0. What this is, and what it is not

The goal is not "add speech-to-text to the chat".

> A merchant is working in their dashboard. They do not stop what they are
> doing. They press the microphone and say: *"Urivo, my traffic went up this
> week but my sales didn't. What's going on?"* Urivo understands their
> language, their store, their products and their analytics, reasons over the
> data it actually has, and answers calmly in the same language. The merchant
> interrupts mid-sentence — *"okay, what would you test first?"* — and Urivo
> stops speaking, listens, and continues.

The emotional target is *"this is the AI operating alongside me while I build my
business"*, not *"this is a microphone attached to a chatbot"*.

### The inspiration, precisely

J.A.R.V.I.S. is the reference for **behaviour**: calm, intelligent, responsive,
conversational, never frantic, never robotic. It is not a reference for
branding, dialogue, personality or audio, none of which may be copied. Urivo's
voice is its own.

Visually the reference is Apple × Linear × Stripe — a competent operator, not
movie-AI cosplay. **No neon rings, no glowing orbs, no particles, no HUD, no
purple AI gradients.** The behaviour is what should feel advanced; the interface
should feel quiet.

### The precondition

This feature amplifies Ask Urivo's answers; it does not improve them. A generic
answer read aloud in a confident voice is worse than the same answer in text,
because the voice implies a certainty the content does not carry.

> **Build this only after Ask Urivo's text answers have been validated against
> a real store with real numbers.** If the answers are not worth reading, they
> are not worth hearing.

---

## 1. The single intelligence layer

Voice is an interaction layer. It is not a second brain.

```
VOICE → speech recognition → transcript
                                  ↓
                    the existing Ask Urivo message pipeline
                    (merchant context · store · products ·
                     analytics · conversation history)
                                  ↓
                           existing AI reasoning
                                  ↓
                              text response
                                  ↓
                             text-to-speech
```

The transcript becomes exactly the message that typing would have produced.
Everything downstream is untouched.

**Voice must never bypass** entitlement · credits · authorization · merchant
isolation · RLS · safety instructions · analytics · conversation state.

Text input, conversation history, and every existing error path stay exactly as
they are. Voice is additive.

---

## 2. Language: no whitelist

**Hard requirement.** Voice must not be restricted to English and German, and
must not carry a hardcoded language list such as `["en", "de"]`.

The architecture is **provider-capability driven**: whatever languages the
chosen speech-recognition and TTS providers support are the languages Urivo
supports. If the provider exposes its supported set, read it — do not maintain
a parallel list that will drift.

Honesty rule for any later report: do not claim "all languages". Claim exactly
what the provider supports, and say which were actually tested.

### Following the conversation

The user configures nothing. Language follows the conversation:

```
User:  "What should I improve first?"        → English answer
User:  "Und was ist mit meinem zweiten Produkt?" → German answer
```

The user's actual spoken language wins — not the UI language, not the
merchant's country. Do not translate their message. Do not answer in English
because the interface is English, or in German because the merchant is in
Germany. An explicit instruction ("answer me in English") overrides.

---

## 3. The voice: male, calm, mature

**Hard product requirement: the voice is male.**

It should sound intelligent, mature, composed, warm, articulate, confident,
emotionally controlled, professional.

It must not sound childish, overly youthful, aggressive, over-energetic,
robotic, monotone, salesman-like, cheesy, or like a movie-trailer narrator.

### Character

Someone who understands business and data, does not panic, thinks before
answering, speaks precisely, respects the listener's time, and can give a
direct recommendation.

| Situation | Delivery |
|---|---|
| Good news | Calm confidence |
| Bad news | Calm honesty |
| Missing data | Calm transparency |

> "I don't have enough traffic data to make that conclusion yet."

not

> "Unfortunately, I'm afraid I can't…"

### Delivery

Moderate pace, never rushed. Natural pauses between observation, reasoning and
recommendation. Clear pronunciation of numbers, percentages, currency, product
names and business terms. Subtle emphasis on what matters — never overacted.

### Multilingual voice selection

TTS follows the response language: an English answer in an English male voice, a
Japanese answer in a Japanese male voice. **Never use an English voice to
pronounce another language.**

When no male voice exists for a language: use the closest high-quality male
voice that does, preserving pronunciation. When no suitable voice exists at all:
show the text response and disable spoken output for that response. **Never
silently change the response language to fit an available voice.**

---

## 4. States

```
IDLE · REQUESTING_PERMISSION · LISTENING · PROCESSING
THINKING · SPEAKING · INTERRUPTED · ERROR · UNAVAILABLE
```

Each must be visually distinct. Every asynchronous state needs a recovery path —
nothing may sit in `Listening…`, `Thinking…` or `Speaking…` forever.

**Idle** communicates availability without animating. No constantly moving orb,
no battery drain.

**Listening** must be unmistakable: a state change on the control, a restrained
pulse or small waveform responding to amplitude if available. The visualiser
exists to communicate state, not to impress.

**Live transcript** shows what Urivo heard while the user speaks, with interim
results visually distinct from final ones. This serves two purposes: the user
knows they were heard, and they can catch a recognition mistake before it
becomes a question.

---

## 5. Interruption

The single most important conversational behaviour.

```
SPEAKING → user starts speaking → STOP AUDIO IMMEDIATELY → LISTENING
```

The user never waits for Urivo to finish. A manual stop control must also
always be available. Conversation, not turn-taking.

Follow-ups continue the same conversation with history intact — *"Why?"* must
work.

---

## 6. Continuous conversation mode

Optional, and **never the default**.

```
listen → think → speak → return to listening
```

Entered explicitly. While active, the interface must make it unmistakable that
the microphone stays open between turns.

---

## 7. Privacy

- The microphone never activates without clear user intent.
- Microphone state is always visible: `● Listening` / `○ Microphone off`.
- No raw audio is stored by default.
- No audio is sent anywhere unnecessary; where a provider receives audio, that
  flow is intentional and documented.
- Analytics record metadata (`voice_started`, `voice_interrupted`, …), never
  microphone audio and never speech content beyond what the conversation
  already stores.

### Wake word

**Not in this design.** A background process consuming audio to listen for
"Hey Urivo" is not worth its privacy and compatibility cost. Push-to-talk /
click-to-talk is preferred and sufficient. If a wake word is ever added it
requires explicit opt-in, a persistent indicator, an obvious disable control,
and no hidden recording.

---

## 8. Voice actions

Natural language is enough; do not build a command grammar.

Navigation is safe to execute directly ("Open Market Research"). **Destructive
or financially consequential actions require explicit confirmation** — deleting
a product, cancelling a subscription, publishing a store, spending on ads:

> "I can do that. Do you want me to continue?"

Voice input is untrusted input, exactly like text. The model never executes
arbitrary code; actions go through a structured, validated schema:

```ts
type UrivoVoiceAction =
  | { type: "navigate"; destination: "dashboard" | "research" | "ads" | "evolution" }
  | { type: "open_product"; productId: string }
  | { type: "request_confirmation"; action: string };
```

Every action is validated, authorized, scoped to the current merchant, and
executed through existing application functions.

---

## 9. Credits

A voice request that invokes Ask Urivo consumes credits exactly as the
equivalent text request does. **No free path may exist through voice.** TTS
itself does not consume AI credits unless that is explicitly designed and
documented.

---

## 10. Speaking well

The written answer always appears in full — for accessibility, verification,
scanning, and noisy environments. Voice never replaces text.

Spoken responses are shorter than written ones without becoming less grounded,
specific or honest.

> **Bad:** "There are several potential considerations you may wish to evaluate…"
>
> **Good:** "I'd start with your product page. Your traffic is healthy, but
> conversion is weak. I'd test the headline and the primary CTA first, then
> watch conversion for seven days."

For a long analysis: *"I've put the full analysis on screen. The short version
is…"*

### Chunking

Split at sentence and paragraph boundaries. Never split numbers, currency,
decimals, URLs, abbreviations or product names.

> Never: "Your conversion is one point" … "two percent."
> Always: "Your conversion is 1.2 percent." as one unit.

Where the pipeline streams, speak at sentence boundaries rather than per token —
fragmented speech is worse than a short wait.

---

## 11. Reliability

- **No duplicate submissions.** Interim results, final results, restarts,
  retries and interruptions must never submit the same utterance twice.
- **No race conditions.** Speaking during an in-flight request, or interrupting
  playback, must never corrupt conversation state or overlap audio.
- **Clean teardown.** Recognition instances, media streams, audio objects,
  timers, abort controllers and listeners are released on unmount.
- **Failure never destroys the conversation.** A TTS failure still shows the
  text. A recognition failure returns to text input with an explanation.

### Error copy

| Failure | What the user is told |
|---|---|
| Permission denied | Microphone access is blocked. You can still use Ask Urivo by typing. |
| Recognition unsupported | Voice input isn't available in this browser. You can continue by typing. |
| Network | I couldn't reach Urivo. Your message wasn't lost. |
| Autoplay blocked | Tap to hear Urivo's response. |

Mobile browsers restrict autoplay; the first interaction must be designed so the
user gesture unlocks playback naturally.

---

## 12. Accessibility and motion

Keyboard accessible, proper button semantics, visible focus, accurate
`aria-label` per state, screen-reader announcements for listening/speaking/error,
live transcript accessible, no state communicated by colour alone. Global
keyboard shortcuts are not hijacked, and typing in the chat never triggers the
microphone.

All motion respects `prefers-reduced-motion`. Reduced motion changes appearance
only — never functionality.

---

## 13. Mobile

First-class, not an afterthought: iOS Safari and Android Chrome, comfortable
touch targets, safe areas, keyboard interaction, permission behaviour, audio
restrictions. No horizontal overflow.

---

## 14. Phases

Build in order. Do not attempt them simultaneously.

| Phase | Scope |
|---|---|
| **1** | Voice input — microphone → recognition → transcript → existing Ask Urivo |
| **2** | Voice output — response → multilingual male TTS |
| **3** | Interruption — user speech stops playback immediately |
| **4** | Continuous conversation mode |
| **5** | Optional safe voice navigation and actions |

---

## 15. Acceptance

Not satisfied by code inspection. The microphone must actually be used, multiple
languages actually spoken, the male voice actually heard, playback actually
interrupted, and the conversation actually continued.

**Browsers:** Chrome, Safari, Edge, iOS Safari, Android Chrome.

**Languages:** at minimum English, German, one Romance language, one Asian
language and one right-to-left language, where the provider supports them.

**Failure injection, not only the happy path:** permission denied · microphone
unavailable · recognition error · recognition timeout · empty transcript ·
network failure · AI failure · TTS failure · user interruption · duplicate
recognition result · unmount while listening · navigation while speaking ·
logout while voice is active · unsupported language · unavailable male voice ·
autoplay restriction.

**Tests must prove something.** Where browser APIs cannot be unit tested
honestly, use browser-level tests rather than mocks that assert their own
fixtures.

### The final question

> Does Ask Urivo feel like a genuine voice copilot, or like a microphone
> attached to a chatbot?

Only the first is done.

---

## 16. Scope discipline

This feature touches the Ask Urivo components and nothing else. It is not an
occasion to redesign the dashboard, landing page, pricing, navigation, billing,
store editor, analytics, Evolution Lab or Ad Studio.
