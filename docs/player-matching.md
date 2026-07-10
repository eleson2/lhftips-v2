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

`SCORER_UNMATCHED` is the one thing generic matching can't resolve on its own (a
true nickname that resembles nothing). It's surfaced, not guessed at.

### Clearing a nickname — `map-player`

The first time a genuine nickname appears, map it once; the registry remembers it
forever:

```
node src/index.js map-player "Isac Brännström" "Brasse"
node src/index.js calculate      # the withheld scorer point is now awarded
```

## Confidence summary

- Deterministic variants (surname, initial+surname, accents, minor misspellings):
  **high confidence, fully automatic.**
- Nickname-only scorer guesses: **cannot** be auto-derived — surfaced via
  `SCORER_UNMATCHED` for a one-time `map-player`, after which they're automatic.
- Nothing is ever silently mis-scored: unmatched scorers withhold only their own
  point and are always reported.
