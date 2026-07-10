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

  // Extract post content from .content element
  const content = $post.find('.content').text().trim();

  // Extract timestamp from .author text
  // Format: "av Username day month year, time" e.g., "av Rönken tor 14 sep 2023, 16:34"
  let timestamp = null;
  const authorText = $post.find('.author').text().replace(/\s+/g, ' ').trim();

  // Parse Swedish date format: "14 sep 2023, 16:34" or "14 sep 2023 16:34"
  const dateMatch = authorText.match(/(\d{1,2})\s+(\w+)\s+(\d{4})[,\s]+(\d{2}:\d{2})/i);
  if (dateMatch) {
    const monthMap = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
      'maj': '05', 'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
      'sep': '09', 'okt': '10', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    const month = monthMap[dateMatch[2].toLowerCase().substring(0, 3)] || '01';
    const day = dateMatch[1].padStart(2, '0');
    timestamp = `${dateMatch[3]}-${month}-${day}T${dateMatch[4]}:00`;
  }

  return {
    username,
    content,
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
