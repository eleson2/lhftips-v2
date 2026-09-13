# Player-name matching & guess review

This documents how LHFTips matches guessed scorer names automatically, and the
review loop that catches everything it can't resolve with confidence. It
supersedes the player-name parts of [`legacy-migration.md`](./legacy-migration.md)
(§3.4 alias harvesting and the 2017–18 import are **not** used — that data is too
old and those players are gone).

## Principles

1. **Ground truth is the actual goalscorers of each game** (scraped from
   swehockey), not the roster. A scorer guess earns its point only if it matches
   a player who really scored that night — see `src/utils/scoring.js` `checkScorer`.
   Because the match target is the 1–4 players who actually scored, ambiguous
   surnames resolve themselves per game.
2. **Matching is generic**, derived from names, not hand-curated per season:
   accent folding (`Brännström`→`brannstrom`), surname-only, first-initial+surname,
   and fuzzy spelling. No season-specific alias list is required.
3. **The registry only *assists* and *learns*** — it never overrides per-game
   evidence, and it only remembers a spelling when a match was confident and
   unambiguous.

## The player registry — `data/player-registry.json`

A self-maintaining store, one entry per player:

```json
"Isac Brännström": {
  "number": 17, "position": "forward",
  "variations": ["brännström", "brannstrom", "i. brännström", ...],
  "seasonsActive": ["2026-27"], "active": true, "source": "roster",
  "learned": [ { "variation": "brasse", "game": 99999, "date": "2026-10-01" } ]
}
```

- `variations` — deterministic spellings auto-derived from the name, plus any
  manual mappings.
- `learned` — spellings the pipeline auto-confirmed, each stamped with the game
  and date it was seen (auditable, reversible).

### Syncing the roster — `sync roster`

Manual command (roster changes are rare and you want to see the diff):

```
node src/index.js sync roster [--dry-run]        # in-season: additive only
node src/index.js sync roster --new-season        # between seasons: full reconcile
```

- **In-season** — add new players, refresh existing ones, **never deactivate**
  anyone. A player traded away mid-season still scored earlier games.
- **New-season** — carry over returning players **and their learned variations**,
  add newcomers, mark players no longer on the roster `active: false`. Nothing is
  ever hard-deleted.

Source URL is `config.rosterUrl` (defaults to the current season's page). The
page is server-rendered, so a plain axios+cheerio fetch is enough.

## Learning (automatic, conservative)

During `calculate`, when a guessed scorer matches a real goalscorer **confidently
(≥ 0.85), unambiguously, and resolves to a known player**, the guessed spelling is
remembered in `learned`. Low-confidence fuzzy matches still *score* the point
(per-game, recomputed every run) but are **not** remembered — awarding is cheap and
reversible; a permanent registry entry needs a higher bar. This is what keeps the
registry from being poisoned.

## The review loop

`import` and `calculate` never silently drop questionable rows — they write
`review-report.txt`, grouped by reason. Every flagged row is reviewable; the
"held from scoring" behaviour depends on the reason:

| Reason | Meaning | Held? |
|---|---|---|
| `UNPARSEABLE` / `INCOMPLETE` | post didn't parse / missing fields | whole guess not imported |
| `DATE_NO_FIXTURE` | no scheduled game matches date+teams | whole guess not imported |
| `LATE` | posted after the match started | whole guess not imported |
| `SCORER_UNMATCHED` | named a scorer no real goalscorer matches | **only the scorer point** is withheld; the rest of the guess still scores |
| `SCORER_AMBIGUOUS` | matched two real goalscorers equally well | no — awarded to the best match, but flagged |
| `SCORER_LOW_CONF` | matched only on a loose fuzzy score | no — awarded to the best match, but flagged |
| `SCORER_VERDICT_STALE` | a human verdict exists but the guess changed under it | the stale verdict is not applied |

`SCORER_UNMATCHED` is the one thing generic matching can't resolve on its own (a
true nickname that resembles nothing). It's surfaced, not guessed at.

### Clearing a nickname — `map-player`

The first time a genuine nickname appears, map it once; the registry remembers it
forever:

```
node src/index.js map-player "Isac Brännström" "Brasse"
node src/index.js calculate      # the withheld scorer point is now awarded
```

## Human judgement on scorers — the verdict store

Automatic matching decides most scorers. The rest are settled by a person, and
that ruling is recorded so it survives every later run. This is the successor to
the old handwritten sheet's negative post-ID, which meant "I have looked at this
one and it counts".

### Where verdicts live — `data/scorer-verdicts.json`

```json
"bamsefar|2026-10-14|luleå hf|frölunda hc": {
  "username": "Bamsefar", "date": "2026-10-14",
  "homeTeam": "Luleå HF", "awayTeam": "Frölunda HC",
  "guessedScorer": "Brasse",
  "verdict": "correct",
  "resolvedTo": "Isac Brännström",
  "note": "known nickname, confirmed in the thread",
  "decidedAt": "2026-10-15T08:12:00.000Z",
  "ai": { "player": "Isac Brännström", "confidence": 0.9, "model": "llama3.1:8b", "reasoning": "..." }
}
```

Three properties matter:

- **Keyed on `(user, match)`, not on `guesses.id`.** Row ids are autoincrement and
  do not survive a re-import; a verdict has to outlive a rebuilt database. That is
  also why this is a file rather than a table.
- **Tied to the spelling it was about.** If that guess is later edited to name
  someone else, the old verdict is *not* applied — it comes back as
  `SCORER_VERDICT_STALE` and is put back in the queue.
- **Auditable.** Who/when/why, plus whatever the AI had suggested at the time, so
  a disputed point can be reconstructed. The file sorts its keys, so it diffs
  cleanly in git.

A verdict is absolute in both directions: `correct` awards the scorer point even
when the matcher found nothing, `incorrect` withholds it even when the matcher
was happy. `checkScorer` stays pure — `calculate` looks the verdict up and passes
the result in.

### What reaches the queue

`calculate` and the review UI share one enumerator
(`src/utils/scorer-cases.js`), so they can never disagree about what is pending:

| Status | Meaning | Point meanwhile |
|---|---|---|
| `AUTO_MATCHED` | confident, unambiguous match | awarded, never queued |
| `UNMATCHED` | matched no actual goalscorer | withheld |
| `AMBIGUOUS` | matched two goalscorers equally well | awarded to the best match |
| `LOW_CONFIDENCE` | matched only on a loose fuzzy score (< 0.85) | awarded to the best match |
| `STALE_VERDICT` | a verdict exists but the guess changed under it | matcher result only |

`LOW_CONFIDENCE` exists because loose fuzzy matching is confidently wrong more
often than it looks: "Brasse" scores 0.67 against *Linus Nässén* on
fuzzy-lastname, which is not Brännström at all. Those cases used to pass
silently; now they are shown to a person. The threshold is the same 0.85 the
registry already required before it would learn a spelling — a match too weak to
learn from is a match too weak to apply unseen.

### Ruling on them — `review`, Scorers tab

```
node src/index.js review
```

Each card shows the guess, the players who actually scored, and what the matcher
made of it. Pick the player, or "Not correct". **Ask AI** pre-fills a suggestion
(below). Optionally tick *also teach the registry* to generalise the ruling into a
`map-player`-style variation, so the spelling resolves by itself from then on —
otherwise the verdict stays a one-off. Re-run `calculate` and the verdict applies.

## The AI suggestion layer (optional, local)

A local [Ollama](https://ollama.com) model proposes which goalscorer a guess
meant. It is **suggestion only**: it pre-fills the choice in the review UI and
never writes a verdict or awards a point. With it switched off
(`"aiEnabled": false`), the review loop works exactly as before, just without a
pre-filled answer.

Configured in `config/settings.json`:

```json
"aiEnabled": true,
"ollamaUrl": "http://127.0.0.1:11434",
"ollamaModel": "llama3.1:8b",
"ollamaTimeoutMs": 60000
```

### Why it is built the way it is

An 8B model asked "which of these players did the user mean?" will always pick
one. Measured on this task, `llama3.1:8b` matched *Zetterberg* — a player who did
not score — to Nässén at 0.9 confidence, and did the same for the invented
word *Puckdrottningen*, inventing a fluent justification each time. Three things
hold that down:

1. **"None of these" is a numbered option**, not a `null`. Picking from a list is
   much easier for a small model than declining to answer. The nullable-union
   version also had a failure mode where the model never terminated — one probe
   ran past 8,700 tokens before being cut off. Generation is capped regardless.
2. **The model answers with an index**, never a name, and the index is
   range-checked. A hallucinated player cannot reach the UI as a real one.
3. **A deterministic guard** (`plausibleLink`) filters the proposal: Swedish
   hockey nicknames keep the *beginning* of the surname they come from
   (Brännström→Brasse, Söderberg→Södde, Karlsson→Kalle), so a proposal
   sharing no opening bigram with the guess is confabulation and is dropped. It
   is shown as a rejected proposal rather than hidden, so the reviewer can still
   see what the model wanted to say.

With all three, the 12-case probe set (real nicknames, misspellings, first names,
non-scorers, and nonsense words) resolves 12/12 correctly. Treat that as a smoke
test, not a benchmark.

Runs at temperature 0 and stays resident for 30 minutes, so the first call after
a cold start takes ~50s to load the model and subsequent ones ~1s.

## Confidence summary

- Deterministic variants (surname, initial+surname, accents, minor misspellings):
  **high confidence, fully automatic.**
- Nickname-only scorer guesses: **cannot** be auto-derived — surfaced via
  `SCORER_UNMATCHED` for a one-time `map-player`, after which they're automatic.
- Weak fuzzy matches: **awarded but surfaced**, because a loose match is wrong
  often enough that it should not stand unseen.
- Human verdicts: **absolute and durable**, in both directions, and they survive a
  rebuilt database.
- AI: **never decides anything.** It pre-fills a human's choice, and its proposal
  is range-checked and plausibility-filtered before it is even shown.
- Nothing is ever silently mis-scored: unmatched scorers withhold only their own
  point and are always reported.
