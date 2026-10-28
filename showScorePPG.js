/*
 * Standings for a date range, rendered as a BBCode table ready to paste into
 * the forum thread — the layout used in the 2023/2024 thread (t2534), where
 * the table was pasted out of Excel.
 *
 * Successor to showScorePPG.js from the 2018-2024 toolset (D:\proj\lhftips,
 * driven by 5.bat). Same flags, same query, same PPG definition: points
 * divided by the number of distinct game dates the user guessed on.
 *
 * Anv:  node showScorePPG -b 2026-09-19 -e 2027-03-16
 *       node showScorePPG -b ... -e ... -r 12     force the round number
 *       node showScorePPG -b ... -e ... --plain   legacy three-column text
 */
import { getDatabase, closeDatabase } from './src/db/database.js';
import { getResultMeta } from './src/db/queries.js';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FromDate = arg('-b', '1999-01-01');
const ToDate = arg('-e', '2099-12-31');
const roundArg = arg('-r', null);
const plain = process.argv.includes('--plain');

/**
 * PPG the way the 2023/2024 posts showed it: two decimals, but a trailing
 * zero trimmed so whole and half values read "3.0" and "1.5", not "3.00".
 */
function formatPPG(value) {
  const fixed = value.toFixed(2);
  return fixed.endsWith('0') ? fixed.slice(0, -1) : fixed;
}

const db = await getDatabase();

const stmt = `
  select u.forum_username as UserID,
         sum(s.total_pts) as Score,
         (sum(s.total_pts) * 1.0) / (count(distinct m.match_date)) as PPG
    from scores s
    join guesses g on s.guess_id = g.id
    join users u on g.user_id = u.id
    join matches m on g.match_id = m.id
   where g.is_valid = 1
     and m.match_date between '${FromDate}' and '${ToDate}'
   group by u.id
   order by Score DESC, PPG DESC`;

const res = db.exec(stmt);
const rows = res.length ? res[0].values : [];

if (rows.length === 0) {
  console.log('Inga rättade tips i intervallet — inget att posta än.');
  closeDatabase();
  process.exit(0);
}

if (plain) {
  // The original three-column stdout layout, kept for eyeballing.
  for (const [UserID, Score, PPG] of rows) {
    console.log(
      UserID.padStart(20).padEnd(25),
      Score.toString().padStart(4).padEnd(3),
      formatPPG(PPG).padStart(8).padEnd(5)
    );
  }
  closeDatabase();
  process.exit(0);
}

const meta = await getResultMeta(FromDate, ToDate);
const round = roundArg || meta.played;

const out = [];
out.push(`Resultat efter omgång ${round}:`);
out.push('');
out.push('[table]');
out.push('[tr][td][b]Namn:[/b][/td][td][b]Poäng:[/b][/td][td][b]PPG:[/b][/td][/tr]');
for (const [UserID, Score, PPG] of rows) {
  out.push(`[tr][td]${UserID}[/td][td]${Score}[/td][td]${formatPPG(PPG)}[/td][/tr]`);
}
out.push('[/table]');

console.log(out.join('\n'));

closeDatabase();
