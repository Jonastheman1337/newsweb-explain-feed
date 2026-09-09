# Autoweb — design proposal

September 2026 · Proposal for review

## Direction

A quiet editorial workspace with the text at its centre. Read, edit and copy directly in the feed. Open sources or version history when the task calls for them. Important notices gain a short, usable first version while the existing comprehensive generation continues.

The scope is a UI/UX redesign of existing functions, plus the fast-version system. Editorial policies, importance criteria, full-generation prompts, validation rules, model defaults, length limits and source eligibility remain unchanged. This proposal does not introduce publishing, approvals, assignments, shared editing or a new editorial workflow.

The interactive prototype uses fictional data and simulated generation. It demonstrates the interface, not a connection to production. Its edits last within the preview; the production design retains the application's existing draft storage behaviour.

## 1. Navigation and layout

**Feed** is the home screen. **Saker** gives the existing standalone article tool a clear place in the navigation wherever that tool is intended to be available. This does not expand access. **Signaler** stays under the account menu for users with existing permission. Notifications and appearance remain compact global controls.

| Surface | Proposed treatment |
|---|---|
| Feed | A centred reading column, approximately 680–700 px wide. Inline editing remains the default. |
| Source / detailed work | The same editor beside a source panel; approximately 1,100 px maximum overall width. One clear return to the feed. |
| Versions | Inside the source panel, beside “Kilder”. Named versions and timestamps replace unexplained numbered tabs. |
| Saker | A plain draft list and the same editor, source list and generation controls used elsewhere. |
| Preferences | One compact panel for the existing preferences. Hidden categories remain distinct from temporary search filters. |
| Signaler | A restrained table with filters and expandable evidence. Technical information remains here. |
| Login | Brand, labelled fields and “Logg inn”. Preserve the current login mechanisms. |

The feed's selected version, edits, filters and scroll position survive a visit to sources and back. Opening sources never creates another draft or another feed entry.

## 2. Visual language

Retain **Manrope** for headings and **IBM Plex Sans** for text. Modernisation comes from spacing, consistent alignment and fewer competing controls, rather than a new visual identity.

| Element | Treatment |
|---|---|
| Surfaces | Neutral page, opaque cards, thin borders; no decorative gradients or large shadows. |
| Text | Clear primary text, readable muted metadata. Body text around 15–16 px, headlines around 24–28 px. |
| Spacing | An 8 px rhythm, typically 24 px card padding; reduce on narrow screens. |
| Shape | 6–8 px control and card corners. |
| Important | A muted amber marker and thin top edge. Used only on notices already classified as important. |
| Working | Small spinner and a short status. |
| Ready | A restrained green status strip when a new version becomes available. |
| Error | Muted red plus a concrete label and recovery action. |
| Actions | Neutral controls. One prominent action where the next step deserves attention. |

Both current light and dark appearances receive the same hierarchy. Colour always has a text or shape equivalent.

## 3. Feed and direct editing

Each card presents issuer, ticker and time, followed by the headline and text. The headline and text are directly editable. There is no “Open draft”, “Edit” or “Save” step.

Keep two routine actions visible: **Kilder** and **Kopier**. A compact overflow holds the existing less frequent actions: title suggestions, a new version, version history, AI original and feedback. In the source workspace, omit the redundant “Kilder” button because the source is already visible.

Preserve the existing selection-based formatting controls and keyboard behaviour. Formatting appears for selected text, with keyboard access; it does not occupy a permanent toolbar above every notice.

An edited version gets a small dot and **Redigert**. This reflects the existing saved-draft model and does not imply new cross-device or shared saving. Copy uses the visible version including the user's edits and existing formatting/link behaviour. Button feedback is simply **Kopiert**.

Search stays visible. **Filter** reveals the existing market, category and issuer selectors. Selected filters stay legible and easy to clear. A **Viktige** shortcut uses the existing importance value; it does not change classification.

Preserve chronology. Important styling does not silently reorder the feed. When inserting updates would move the user's reading or editing position, show **2 nye meldinger** and let the user reveal them. Update status inside existing cards without remounting the editor.

## 4. Fast-version system

This is the only new generation functionality. For a notice already identified as important, a separate short generation produces a headline and approximately two sentences. The existing comprehensive pipeline continues in parallel with its current editorial behaviour.

The first version must be a complete, usable short draft before it appears. Avoid typewriter animation or displaying unfinished model tokens as editable copy. Both versions belong to one notice and retain separate edits.

| State | Visible content | Status / action |
|---|---|---|
| Reading | Source title and metadata | “Førsteutkast lages” |
| Short version ready | Editable headline and short text, labelled “Førsteutkast” | “Utfyllende versjon lages” |
| Full version ready | Keep the current version on screen | “Utfyllende versjon klar” + “Vis versjon” |
| Full version selected | Editable full text, labelled “Utfyllende” | Quiet “Førsteutkast” action to return |
| First version fails | Source remains available; full generation continues | “Utfyllende versjon lages” |
| Full version fails | First version and all edits remain available | “Utfyllende versjon feilet” + “Prøv igjen” |
| Both fail | Source title, original source access | “Generering feilet” + “Prøv igjen” |
| Run interrupted or stale | Preserve all usable content; stop the indefinite spinner | Accurate short status and existing recovery action |

The completion event never switches the selected version, merges text, moves the caret, resets scroll or replaces user edits. A late fast result cannot replace a full version that arrived first. New full versions also remain explicit choices when the user has started working.

Once the user opens the full version, the green arrival strip becomes a quiet version footer. The same new-version pattern applies to the existing manual regeneration flow; generation does not automatically overwrite the version being edited.

**Timing:** aim for a first version within roughly 5–10 seconds after usable source text becomes available, then measure this. It is a target, not a promise or a fabricated UI countdown. If essential content is still being extracted, the interface shows the actual reading state.

This proposal does not redefine what is important, relax factual standards or alter the comprehensive output. The fast branch's precise prompt and implementation belong to a later implementation task.

## 5. Sources, versions and existing generation controls

**Kilder** opens a focused workspace containing the same editable text and the original notice beside it. Attachments have short recognisable filenames and a file-type label. Existing source links remain available. PDF handling keeps the present supported viewer/link behaviour; the mock source excerpt is illustrative, not a proposed new extraction or fact-matching feature.

**Versjoner** lists meaningful names with timestamps: “Førsteutkast”, “Utfyllende”, and subsequent versions. A dot identifies a version with edits. Selecting one changes the text in the existing editor; it does not create a new item. Preserve the existing distinction between a generated original and the user's draft.

The existing instruction field stays below the editor, with a short placeholder such as **Hva skal endres?**. Keep the current **Notis / Utvidet** options and the current reasoning override, with its existing semantics. Put seldom-used generation options in a compact “Valg” disclosure. Rename the submit action **Lag versjon**; its operation remains the current operation.

**Titler** presents the existing title suggestions as short selectable rows. Selecting a suggestion changes the current draft only. **Meld feil** is separate from generation, so sending feedback cannot accidentally create a version. Existing feedback and edit telemetry continue to work.

**AI-original** opens the unedited output for inspection. Restoring it retains the existing reset/undo safeguards. Merely viewing it must not erase the edited draft.

## 6. Existing Sak flow

Use the same text editor and version/source panel. The list shows the draft title, last activity and source count. **Ny sak** opens a compact form containing sources, the optional title, the current character-length presets and the existing instruction field.

Retain the exact current source types, source enable/disable behaviour, optional-title semantics and length validation. Notice materials keep their current Newsweb/PDF/text restrictions; standalone Sak keeps its current URL/PDF/text support. A visual redesign must not broaden those inputs or change how they affect generation.

Use **+ Kilde**, short type labels and **Lag utkast**. A source row displays the file or source title, its enabled state and a remove action. Show reading or failure state on that row. Existing source notes and editorial caveats stay outside the editable/copyable article, under **Merknader** when needed.

This is a new presentation of Sak, not a change to its editorial output or availability policy.

## 7. Preferences, login and Signaler

Notifications retain their present on/off meaning and browser permission handling. Theme preferences keep their current behaviour. Hidden categories have a clear checklist in preferences, separate from temporary feed filters.

Keep the login page minimal: **Brukernavn**, **Passord**, **Logg inn**. An invalid or expired login link gets a short error and the existing recovery path. Do not add a new authentication flow.

Signaler keeps its current data and access rules. Present generations, edits, feedback and title actions as compact views of the existing records. Show detail only when a row is opened. Preserve exports and numeric-monitor evidence. The fast flow can add observed first-version and full-version times to the existing generation details; this does not create a new quality score or editorial ranking.

Raw identifiers, model details, validation traces and infrastructure terminology belong in technical disclosures here, never in normal feed recovery instructions.

## 8. Microcopy and motion

Use labels that name an object or an action. Omit descriptions of obvious controls. No permanent “click here”, “you can edit”, “AI is working on…” or onboarding paragraphs.

| Purpose | Wording |
|---|---|
| Search | Søk |
| Sources | Kilder |
| Generate again | Lag versjon |
| First version | Førsteutkast |
| Full version | Utfyllende |
| Arrival | Utfyllende versjon klar |
| Empty search | Ingen treff · Nullstill filtre |
| No notices yet | Ingen meldinger |
| Loading source | Leser kilde |
| Lost connection | Frakoblet · Koble til |
| Generation failure | Generering feilet · Prøv igjen |
| Draft save failure | Ikke lagret · Prøv igjen |

Use a 200–350 ms arrival transition, a small spinner during real work and a brief highlight on completion. Stop movement when work finishes. Avoid animated card height during editing, looping attention effects after completion, fake percentage bars and estimated phase advancement. Respect reduced-motion preferences.

## 9. Responsive and accessible behaviour

On desktop, preserve a comfortable reading width rather than filling the entire display with text. The source workspace can widen to two columns. On narrow screens, the source panel moves below the editor with clear section controls; the text and actions reflow without horizontal scrolling. Return navigation preserves the user's place.

Use readable labels, visible keyboard focus, native controls, correctly named icon buttons and approximately 44 px touch targets. Status updates use polite live announcements without narrating each spinner frame. Essential actions never depend on hover. Dialogs contain keyboard focus and return it to the triggering control.

## 10. Implementation boundaries and acceptance

Implement the visual system and shared editor/card shell first, followed by the fast-version states, then the supporting existing screens. Keep the existing application functional throughout the transition. This session delivers design only; application code and production remain untouched.

The redesign is ready to implement when these behaviours are agreed:

1. Text is editable immediately in both feed and detailed views.
2. A fast draft and a full draft occupy one notice with separate version identities and edits.
3. Completion never overwrites content or interrupts active editing.
4. The visible version is always the version copied.
5. Reading, ready, failure and disconnected states are distinguishable through short labels.
6. Source navigation and return preserve feed position, filters and the selected version.
7. Every existing action, supported input, editorial setting and permission remains available with its current meaning.
8. Light, dark, keyboard and narrow-screen layouts work without hidden essential actions or clipped text.

The prototype covers the principal screen layouts and interactions. Simulated generation, example source/PDF content and example signal records are for design review; production saving, authentication, parsing, feedback submission and monitoring are not implemented by the prototype.


## Approved September 9 amendment

This amendment supersedes conflicting proposal controls above. Use the full
dateline, Notis / Original / Sammenlign and no important/first-draft badges.
Remove source resizing, source font controls and expanded-workspace controls.
Keep comparison actions under the notis column; Original-only hides editing and
copying. Phone actions occupy two rows, with versions below Endre / Kopier.

Endre opens one field: **Be om endring, lim inn kildetekst eller lenke**. Keep PDFs,
source chips, Legg ved teksten, length presets 300 / 500 / 1 000 / 1 500 / Annet
and the reasoning icon together. Length remains 300–4 000, default 1 000.
Plain Enter inserts a newline; Ctrl/Cmd+Enter submits; custom-length Enter only
applies its value. Public HTTP(S) articles and linked PDFs use the shared importer.

One version control offers Fullstendig melding klar for the first unseen full
draft, then Vis første / Vis nyeste with all versions in its dropdown. Requested
results automatically open only while untouched; otherwise show Ny versjon klar.
Vis endringer compares the submitted snapshot with its requested result. Preserve
independent rich edits and unfinished instructions for each selected version.
Headline suggestions sit beside the headline and require explicit selection.

Manual changes queue behind active full generation. Durable primary-database
request records govern FIFO admission, frozen inputs, exact-result status,
idempotency, cancellation and recovery. Cancellation interrupts actual model calls
and coordinates with publication under the existing notice lock. Backend worker
capability is required before exposing these controls. `/feed` and `/sak` retain
their presentation; production deployment remains a separate task.
