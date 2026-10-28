# Legacy corpus (2021-22 and 2023-24 threads)

Verbatim output of `node app` (`1.bat`) from the 2018-2024 toolset that ran this
competition before LHFTips v2 — kept at `D:\proj\lhftips`.

Each file is that toolset's own parse of a full forum thread:

- a normal line is a guess it understood, already split into columns:
  `PostID,UserID,GameDate,Game,Guess,Scorer`
- a line starting with `===` is a post it could **not** parse, kept verbatim as
  `=== <postid>,<user> <<< Not a Guess. >>>:<full post text>`

The `===` lines are the valuable part: ~90 real posts that a working parser
failed on, each already adjudicated by a human as guess or not-a-guess. Most are
Rönken's per-round standings posts (genuinely not guesses); the rest are real
guesses buried in commentary, which is exactly the shape v2's parser has to
survive. See `tests/legacy-corpus.test.js`.

One caveat that matters when reading these: the old scraper joined a post's text
without preserving line breaks, so commentary and the tip below it appear glued
together (`...Rönk är Rönk!2023-09-16, Luleå - Timrå, 4-3, Andreasson`). v2's
scraper loses line breaks the same way, so this is a faithful sample of live
input, not a quirk of the dump.
