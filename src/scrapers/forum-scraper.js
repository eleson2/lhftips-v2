import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Parse the offset from a forum URL
 * Forum uses pattern: /t2534p{offset}-... where offset = page * 50
 * @param {string} url - Forum URL
 * @returns {number} - Offset value
 */
function getOffsetFromUrl(url) {
  const match = url.match(/\/t\d+p(\d+)-/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Build a forum URL with a specific offset
 * @param {string} baseUrl - Base forum URL (page 1)
 * @param {number} offset - Offset value
 * @returns {string} - URL with offset
 */
function buildUrlWithOffset(baseUrl, offset) {
  if (offset === 0) return baseUrl;

  // Check if URL already has an offset
  if (baseUrl.match(/\/t(\d+)p\d+-/)) {
    return baseUrl.replace(/\/t(\d+)p\d+-/, `/t$1p${offset}-`);
  }

  // Add offset to URL
  return baseUrl.replace(/\/t(\d+)-/, `/t$1p${offset}-`);
}

/**
 * Sponsored content / ad placeholder posts are literally username
 * "Sponsored content" on this forum (id="p0", no real author). Shared by
 * the live scraper and the review-file reader (for old CSVs scraped before
 * this filter existed).
 */
export function isSponsoredUsername(username) {
  return !username || username.toLowerCase().includes('sponsored');
}

/**
 * Parse the authoritative "current/total pages" count from the forum's own
 * pagination widget, e.g. "Sida 1 av 16" / "Page 1 of 16". This is ground
 * truth for whether more pages exist — far more reliable than guessing from
 * an empty page, since it's the same count the forum itself uses.
 * @param {cheerio.CheerioAPI} $ - Cheerio instance for the page
 * @returns {{ current: number, total: number }|null}
 */
function parsePaginationInfo($) {
  const text = $('.pagination, .paging, .page-nav').first().text();
  const match = text.match(/(?:Sida|Page)\s+(\d+)\s+(?:av|of)\s+(\d+)/i);
  if (!match) return null;
  return { current: parseInt(match[1], 10), total: parseInt(match[2], 10) };
}

/**
 * Parse the post timestamp out of a forum post's ".author" line.
 *
 * The board does not render dates one way. The guest date format varies from
 * request to request — three shapes came back within minutes of each other on
 * 2026-09-24 — so every one of them has to parse, and a new one has to be easy
 * to add:
 *  - ISO, 24h:          "av Bamsefar 2026-09-17, 16:32"
 *  - day first, 24h:    "av Rönken tor 14 sep 2023, 16:34"
 *  - month first, 12h:  "av Puckad mån jul 06, 2026 9:51 pm"
 *  - relative:          "av icemask Igår på 11:03" / "av Puckad Idag på 4:20 pm"
 *    Forumotion renders today's and yesterday's posts this way, and those are
 *    exactly the posts nearest a game's deadline, so the LATE check depends on
 *    resolving them.
 *
 * The am/pm marker is part of the match rather than an optional extra: "4:20 pm"
 * read as 04:20 puts the post on the wrong side of both the deadline and any
 * later repost by the same user, which is worse than not reading it at all.
 *
 * @param {string} authorText - Whitespace-collapsed text of the .author element
 * @param {Date} [now] - Reference "today" for relative dates (injectable for tests)
 * @returns {string|null} - Local ISO timestamp "YYYY-MM-DDTHH:MM:00", or null
 */
const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  maj: '05', may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', okt: '10', oct: '10', nov: '11', dec: '12'
};

// A month name in either language, however it is abbreviated: sep, sept, september.
function monthNumber(word) {
  return MONTHS[word.toLowerCase().slice(0, 3)] || null;
}

// "9:51" + "pm" -> "21:51". No marker means the clock was already 24-hour.
function to24Hour(time, meridiem) {
  const [h, m] = time.split(':');
  let hour = parseInt(h, 10);
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith('p');
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, '0')}:${m}`;
}

// Time tail shared by all three patterns: "16:34" | "9:51 pm" | "11:03 a.m."
const TIME = /(\d{1,2}:\d{2})(?:\s*([ap])\.?\s*m\.?)?/;

// The date halves, each glued to TIME below. Written as literals rather than
// strings so the escapes read the way a regex does.
const DATE_SEP = /(?:\s*[,-]\s*|\s+)/;

// "2026-09-17, 16:32" | "2026-09-17 4:32 pm"
const ISO_DATE = new RegExp(
  /(\d{4})-(\d{2})-(\d{2})/.source + DATE_SEP.source + TIME.source, 'i');

// "14 sep 2023, 16:34" | "6 jul 2026 - 21:51"
const DAY_FIRST = new RegExp(
  /(\d{1,2})\s+([a-zåäöé]+)\.?\s+(\d{4})/.source + DATE_SEP.source + TIME.source, 'i');

// "sep 22, 2026 9:16 pm" | "jul 06 2026, 21:51"
const MONTH_FIRST = new RegExp(
  /([a-zåäöé]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.source + DATE_SEP.source + TIME.source, 'i');

// "Idag på 18:18" | "Igår kl. 11:03" | "Today at 4:20 pm" | "Yesterday, 11:03 am"
const RELATIVE = new RegExp(
  /\b(idag|ig[åa]r|today|yesterday)\b\s*(?:p[åa]|kl\.?|at|,|-)?\s*/.source + TIME.source, 'i');

// One line per unreadable shape, not per post: a format change hits every post
// on the page at once, and 50 identical warnings would bury the scrape output.
const warnedAuthorShapes = new Set();

function warnUnreadableAuthorDate(authorText) {
  const shape = authorText.replace(/\d/g, '0');
  if (warnedAuthorShapes.has(shape)) return;
  warnedAuthorShapes.add(shape);
  console.warn(`WARNING: cannot read the post date in "${authorText}" — those posts get no timestamp.`);
  console.warn('  The forum has changed its date format; parseAuthorTimestamp needs the new shape.');
}

export function parseAuthorTimestamp(authorText, now = new Date()) {
  if (!authorText) return null;

  // ISO first: it is the one shape with nothing to disambiguate.
  const iso = authorText.match(ISO_DATE);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}T${to24Hour(iso[4], iso[5])}:00`;
  }

  // Then day-first: its leading digits cannot be mistaken for the weekday that
  // precedes a month-first date, so it never matches one by accident, while the
  // reverse is not true.
  const dayFirst = authorText.match(DAY_FIRST);
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]);
    if (month) {
      const day = dayFirst[1].padStart(2, '0');
      return `${dayFirst[3]}-${month}-${day}T${to24Hour(dayFirst[4], dayFirst[5])}:00`;
    }
  }

  const monthFirst = authorText.match(MONTH_FIRST);
  if (monthFirst) {
    // The weekday sits right before the month ("mån jul 06, 2026"), so a word
    // that is not a month means we matched the wrong token, not a bad date.
    const month = monthNumber(monthFirst[1]);
    if (month) {
      const day = monthFirst[2].padStart(2, '0');
      return `${monthFirst[3]}-${month}-${day}T${to24Hour(monthFirst[4], monthFirst[5])}:00`;
    }
  }

  const relative = authorText.match(RELATIVE);
  if (relative) {
    const word = relative[1].toLowerCase();
    const daysBack = (word === 'idag' || word === 'today') ? 0 : 1;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${date}T${to24Hour(relative[2], relative[3])}:00`;
  }

  return null;
}

/**
 * Parse a forum post from a DOM element
 * @param {cheerio.Element} postElement - Post DOM element
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {object|null} - Parsed post data
 */
function parsePost(postElement, $) {
  const $post = $(postElement);

  // Extract username from .postprofile strong (luleahockeyforum.com structure)
  let username = $post.find('.postprofile strong').first().text().trim();

  // Fallback: extract from .author text which has format "av Username date"
  if (!username) {
    const authorText = $post.find('.author').text();
    const match = authorText.match(/av\s+(\S+)/);
    if (match) username = match[1];
  }

  // Skip sponsored content / ad placeholders
  if (isSponsoredUsername(username)) return null;

  // Post element id is "p{id}" (e.g. id="p411875"), forum-wide and monotonically
  // increasing — used as the incremental-scrape cursor. Fall back to the
  // "post--{id}" class token if the id attribute is ever missing.
  let postId = null;
  const idAttr = $post.attr('id');
  const idMatch = idAttr && idAttr.match(/^p(\d+)$/);
  if (idMatch) {
    postId = parseInt(idMatch[1], 10);
  } else {
    const classMatch = ($post.attr('class') || '').match(/post--(\d+)/);
    if (classMatch) postId = parseInt(classMatch[1], 10);
  }

  // Extract post content from .content element. <br> becomes a newline so a
  // guess and the chat after it stay on separate lines instead of gluing the
  // chat onto the scorer ("LiljaVill poängtera...").
  const $content = $post.find('.content').first().clone();
  $content.find('br').replaceWith('\n');
  const content = $content.text().trim();

  // A post quoting another post is a reply, never a guess — the quoted text
  // may well hold someone else's guess.
  const hasQuote = $content.find('blockquote').length > 0;

  // Extract timestamp from .author text (see parseAuthorTimestamp for the
  // shapes the board serves).
  const authorText = $post.find('.author').text().replace(/\s+/g, ' ').trim();
  const timestamp = parseAuthorTimestamp(authorText);

  // The board keeps changing its date format, and a missing timestamp is not a
  // harmless gap: an empty one counts as "in time" and never beats an earlier
  // guess by the same user. So say so rather than writing a blank column.
  if (!timestamp && /\d{1,2}:\d{2}/.test(authorText)) {
    warnUnreadableAuthorDate(authorText);
  }

  return {
    username,
    content,
    hasQuote,
    timestamp,
    postId
  };
}

/**
 * Scrape a single forum page
 * @param {string} url - Page URL
 * @returns {Promise<{ posts: object[], nextPageUrl: string|null }>}
 */
async function scrapePage(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8'
    },
    timeout: 30000
  });

  const $ = cheerio.load(response.data);
  const posts = [];

  // Find all posts - use selectors that work with luleahockeyforum.com
  // Posts have class like "post row2 post--{id}"
  let postElements = $('div[class*="post row"]').toArray();

  // Fallback selectors for other forum software
  if (postElements.length === 0) {
    const fallbackSelectors = ['.post', '.message', '[id^="post"]', '.forum-post', '.topic-post'];
    for (const selector of fallbackSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        postElements = elements.toArray();
        break;
      }
    }
  }

  for (const element of postElements) {
    const post = parsePost(element, $);
    if (post && post.content) {
      posts.push(post);
    }
  }

  // Authoritative page count straight from the forum's own pager, e.g.
  // "Sida 1 av 16". Used by scrapeForumThread as the real stop condition.
  const pagination = parsePaginationInfo($);

  // Next page URL: this forum's pager renders only numbered links ("2",
  // "3", "16"), never a text-labeled "next" link, so there's nothing
  // reliable to scrape a href from — build it from the offset instead.
  // Whether to actually follow it is decided by `pagination` in
  // scrapeForumThread, not by this URL's existence.
  const nextPageUrl = posts.length > 0
    ? buildUrlWithOffset(url, getOffsetFromUrl(url) + 50)
    : null;

  return { posts, nextPageUrl, pagination };
}

/**
 * Scrape all pages of a forum thread
 * @param {string} startUrl - Starting URL (page 1)
 * @param {object} options - Options
 * @param {number} options.maxPages - Maximum pages to scrape
 * @param {function} options.onPage - Callback for each page
 * @returns {Promise<object[]>} - All posts
 */
export async function scrapeForumThread(startUrl, options = {}) {
  const { maxPages = 100, onPage = null } = options;

  const allPosts = [];
  let currentUrl = startUrl;
  let pageNum = 1;
  let consecutiveEmpty = 0;

  while (currentUrl && pageNum <= maxPages) {
    try {
      console.log(`Scraping page ${pageNum}: ${currentUrl}`);

      const { posts, nextPageUrl, pagination } = await scrapePage(currentUrl);

      if (posts.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        allPosts.push(...posts);
      }

      if (onPage) {
        onPage(pageNum, posts.length);
      }

      // Authoritative stop: the forum's own pager says this was the last
      // page. Trust it over guesswork — it can't be fooled by a transient
      // empty response, and it stops exactly on time instead of needing an
      // extra probe request past the end.
      if (pagination && pagination.current >= pagination.total) {
        break;
      }

      // No pagination info available (parsing changed, or a stray fetch
      // failure) — fall back to the old heuristic: two empty pages in a
      // row means we've run off the end.
      if (!pagination && consecutiveEmpty >= 2) {
        console.log('No more posts found, stopping.');
        break;
      }

      currentUrl = nextPageUrl;
      pageNum++;

      // Be respectful - wait between requests
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      if (error.response?.status === 404) {
        console.log('Page not found, stopping pagination.');
        break;
      }
      console.error(`Error scraping page ${pageNum}:`, error.message);
      break;
    }
  }

  return allPosts;
}

export { getOffsetFromUrl, buildUrlWithOffset, parsePaginationInfo };
