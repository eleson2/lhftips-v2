# Migration Assessment: Legacy `lhftips` → AI-Generated `LHFTips`

**Purpose:** decide what, if anything, is worth carrying over from the old hand-written
Node app (`..\OldLHFTips\lhftips`, the 2017–2018 season tool) into this AI-generated
version, which is the one we will build on going forward.

**TL;DR verdict:** Bring over **data, not code.** The legacy *code* and *architecture*
are strictly superseded by this version and should not be ported. The legacy *dataset*
and the *real, messy guess text* it captured are genuinely valuable — as historical
records, as parser regression fixtures, and as an independent check on the scoring model.
The one workflow the legacy app was actually valued for — a human-in-the-loop step to
clean data and approve off-format guesses — **already exists here** and does not need
to be rebuilt.

---

## 1. Side-by-side

| Aspect | Legacy `lhftips` | This version `LHFTips` |
|---|---|---|
| Shape | 8 standalone batch scripts + `load.bat` | Single `commander` CLI (`src/index.js`) with sub-commands |
| Modules | Implicit globals, no `var/const/let`, CommonJS | ES modules, scoped functions, JSDoc |
| Deps | `request` (deprecated), `cheerio@0.22`, `sqlite-sync`, `csvtojson` | `axios`, `cheerio@1`, `sql.js`, `commander`, `fuse.js`, `date-fns` |
| DB access | String-concatenated SQL (injection-prone) | Parameterized queries + transactions (`src/db/`) |
| Results source | Manual CLI entry (`resultat -d -h -b`) | Scraped from swehockey (`swehockey-scraper.js`) incl. goalscorers |
| Name matching | None — required exact manual cleanup | Fuzzy team + player matching w/ alias files (`data/*.json`) |
| Duplicate/late guesses | `valid_guess` SQL view (latest postid wins) | `UNIQUE(user_id,match_id)` upsert + post-timestamp-before-match check |
| Tests | None | `tests/*.test.js` (parser, scoring, matchers) |
| Human review step | Manual edit of scraped CSV before load | **Same idea, built in** (see §2) |

The new version is a superset in every dimension. There is no code path in the legacy
app that does something this one cannot.

---

## 2. The "manual approval" workflow is already here

The legacy value proposition was: scrape → **hand-edit the CSV to fix/approve off-format
guesses** → load. That exact loop exists in this version:

- `scrape guesses` writes `guesses.csv`; any post it **cannot** parse is written as a
  line prefixed with `#` (`src/commands/scrape-guesses.js`), and the command prints
  *"Review `guesses.csv` and fix any lines starting with #"*.
- `import guesses <csv>` reads that reviewed file, treating `#` lines as comments
  (`comment: '#'` in `src/commands/import-guesses.js`).

So a human can still hand-approve a guess that didn't follow the strict format — edit the
`#` line into a valid row and re-import. **Recommendation: keep this loop; don't port
anything from legacy for it.** (Possible enhancement noted in §4.)

---

## 3. What to bring over (ranked)

### 3.1 The historical 2017–2018 dataset — **highest value**
`..\OldLHFTips\lhftips\db\oh2.db` contains real competition data:
- **55 games**, **522 guesses**, **37 distinct users**, dates 2017-09 → 2017-12.
- Tables `games` and `guesses`; view `valid_guess` (latest guess per user/date).

Two independent uses:
1. **Archive / historical leaderboards.** If we ever want cross-season history, this is
   the only surviving record of that season. A one-off migration script can map it into
   the new schema:
   `games → matches`, `guesses → users + guesses`, then run `calculate`.
   (Mapping is straightforward but lossy — see caveats below.)
2. **Real-world parser fixtures** (see 3.2) — even if we never load it as live data.

**Caveats before trusting it as data:**
- **Encoding is broken** in the legacy DB: usernames/scorers show mojibake
  (`Rönken` → `R�nken`, `Lundeström` → `Lundestr�m`) — latin1/utf-8 mismatch.
- **Inconsistent date encoding**: some `gameDate` values are ISO strings (`'2017-12-02'`),
  at least one is a bare integer (`20171012`). Must be normalized on import.
- **Scoring columns are unreliable**: many `Points` are `0` (scoring wasn't consistently
  run), so don't treat the stored points as ground truth (see §3.3).

### 3.2 Real messy guess text — **best test material we have**
The legacy `guesses.Scorer`/`guess` fields captured exactly the kind of noise the new
tolerant parser and player-matcher must survive. Real examples pulled from `oh2.db`:

```
"Petter EmanuelssonBara så att jag inte glömmer att tippa"   ← scorer + freetext commentary, no separator
"Patrik Cehlin."                                              ← trailing period
"Cehlin"        "Hishon"                                      ← surname-only
```
Plus `loadGuesses.js` documents `===`-marked malformed rows (wrong delimiters, mashed
date/teams/score). **Recommendation:** extract a corpus of these strings into
`tests/fixtures/legacy-guesses.txt` and add regression cases to
`tests/guess-parser.test.js` / `player-matcher.test.js`. This is the single most useful
thing to salvage — it's real adversarial input this app will face again.

### 3.3 Scoring model — legacy as an independent confirmation
The legacy scoring (`resultat.js` / `updateScores.js`) awards, per guess:
`+1 home goals correct`, `+1 away goals correct`, `+3 if both correct`,
`+1 correct outcome`, `+1 correct scorer` → **max 7**.

That decomposes to *exactly* the same 7-point model in `rules.txt` and implemented in
`src/utils/scoring.js` (exact 3 / outcome 1 / scorer 1 / Luleå-goals 1 / conceded 1).
The only difference is orientation: legacy scored raw home/away goals; this version scores
Luleå-relative goals-for/goals-against — **numerically identical** for the points.

**Recommendation:** treat legacy as a sanity oracle, *not* gospel. Once the 2017–18 data
is imported, spot-check a handful of `calculate` outputs against a manual re-score to
confirm parity. (Don't diff against stored legacy `Points` — those are incomplete.)

### 3.4 Name-spelling variants — minor alias enrichment
The 37 legacy users wrote player/team names many ways. Harvesting the distinct spellings
from `oh2.db` and folding the useful ones into `data/player-aliases.json` /
`data/team-aliases.json` would harden fuzzy matching for free. Low effort, low priority.

---

## 4. What NOT to bring over
- **Any legacy source code** — globals, string-built SQL, deprecated `request`/`sqlite-sync`.
  All superseded.
- **Hardcoded season URL + manual `p350/p400` pagination** (`app.js`) — this version
  paginates automatically (`forum-scraper.js`).
- **The `emp` table** and `latest_guess-wrong` view in `oh2.db** — leftover scratch/dead objects.
- **Manual result entry** (`resultat.js`) — replaced by swehockey scraping.

## 5. Optional enhancement (inspired by legacy, not ported from it)
The legacy negative-`postid` trick was a crude "manually mark this as correct" override.
If we want first-class manual overrides in this version, the clean equivalent would be an
`import guesses` that also accepts already-scored/approved rows, or an explicit
`is_approved` flag on `guesses`. Flagging as an idea only — not required.

---

## 6. Suggested next steps
1. Copy `..\OldLHFTips\lhftips\db\oh2.db` into `data/legacy/` as a read-only archive.
2. Write a throwaway `scripts/import-legacy.js` that: fixes encoding, normalizes dates,
   maps `games→matches` / `guesses→users+guesses`, then run `calculate` + `report` to
   reproduce the 2017–18 leaderboard as a smoke test of the whole pipeline on real data.
3. Extract messy guess/scorer strings into `tests/fixtures/` and add parser regression tests.
4. (Optional) merge new name spellings into `data/*-aliases.json`.

*Nothing here blocks building forward on this version — items 2–4 are hardening, not prerequisites.*
