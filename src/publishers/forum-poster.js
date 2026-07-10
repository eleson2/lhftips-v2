import axios from 'axios';
import * as cheerio from 'cheerio';
import { createDebugger } from '../utils/debug.js';

const debug = createDebugger('poster');
const UA = 'Mozilla/5.0 (compatible; LHFTips-standings-bot/1.0)';

// ---------------------------------------------------------------------------
// Pure helpers (Stage A — fully unit-testable, no network)
// ---------------------------------------------------------------------------

/** Parse Set-Cookie response headers into a { name: value } jar. */
export function parseSetCookie(setCookieHeaders = []) {
  const jar = {};
  for (const c of setCookieHeaders) {
    const pair = String(c).split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

/** Serialise a cookie jar into a Cookie request header. */
export function cookieHeader(jar = {}) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Extract topic id from a forumotion thread URL (…/t2964-slug). */
export function threadId(url) {
  const m = String(url).match(/\/t(\d+)/);
  return m ? m[1] : null;
}

function describeForm($, $form) {
  const hidden = {};
  $form.find('input[type=hidden]').each((i, el) => {
    const name = $(el).attr('name');
    if (name) hidden[name] = $(el).attr('value') ?? '';
  });

  const $textarea = $form.find('textarea').first();
  const $subject = $form.find('input[name=subject], input[name=post_title]').first();

  const buttons = [];
  $form.find('input[type=submit], button[type=submit]').each((i, el) => {
    const name = $(el).attr('name');
    if (name) buttons.push({ name, value: $(el).attr('value') ?? '' });
  });

  return {
    action: $form.attr('action') || '',
    method: ($form.attr('method') || 'post').toLowerCase(),
    hidden,
    messageField: $textarea.attr('name') || 'message',
    subjectField: $subject.attr('name') || 'subject',
    subjectValue: $subject.attr('value') || '',
    buttons,
  };
}

/**
 * Parse a forumotion reply/post form. Returns everything needed to resubmit it,
 * including ALL hidden fields (round-tripped verbatim so we never have to guess
 * forumotion's CSRF/token field names).
 */
export function parsePostForm(html) {
  const $ = cheerio.load(html);
  let $form = $('form').filter((i, f) => $(f).find('textarea').length > 0).first();
  if ($form.length === 0) $form = $('form[action*="post"]').first();
  if ($form.length === 0) throw new Error('No post form found on the page (are we logged in?)');
  return describeForm($, $form);
}

/** Parse the login form (first form containing a password input). */
export function parseLoginForm(html) {
  const $ = cheerio.load(html);
  const $form = $('form').filter((i, f) => $(f).find('input[type=password]').length > 0).first();
  if ($form.length === 0) throw new Error('No login form found');
  const base = describeForm($, $form);
  const userName = $form.find('input[name=username], input[type=text]').first().attr('name') || 'username';
  const passName = $form.find('input[type=password]').first().attr('name') || 'password';
  return { ...base, userField: userName, passField: passName };
}

/**
 * Assemble the POST body: all hidden fields + our message, subject, and the
 * chosen submit button (post vs preview).
 * @param {object} form - from parsePostForm
 * @param {{subject?:string, message:string, mode?:'post'|'preview'}} opts
 * @returns {Record<string,string>}
 */
export function buildPostBody(form, { subject, message, mode = 'post' } = {}) {
  const body = { ...form.hidden };
  body[form.messageField] = message ?? '';
  if (subject !== undefined) body[form.subjectField] = subject;
  else if (form.subjectValue) body[form.subjectField] = form.subjectValue;

  const wantName = mode === 'preview' ? 'preview' : 'post';
  const btn =
    form.buttons.find((b) => b.name === wantName) ||
    form.buttons.find((b) => new RegExp(wantName, 'i').test(b.value));
  if (btn) body[btn.name] = btn.value || '1';
  else body[wantName] = mode === 'preview' ? 'Preview' : 'Send';

  return body;
}

// ---------------------------------------------------------------------------
// Network orchestration (Stages B & C — run these with real credentials)
// ---------------------------------------------------------------------------

function req(config) {
  return axios({
    maxRedirects: 0,
    validateStatus: () => true,
    headers: { 'User-Agent': UA },
    timeout: 30000,
    ...config,
    headers: { 'User-Agent': UA, ...(config.headers || {}) },
  });
}

/**
 * Log in to a forumotion board. Returns a cookie jar. Best-effort — validate
 * against the real board in Stage B (the flow logs what it sees).
 */
export async function login(baseUrl, username, password) {
  const jar = {};
  const loginUrl = `${baseUrl}/login`;

  const g = await req({ method: 'get', url: loginUrl });
  Object.assign(jar, parseSetCookie(g.headers['set-cookie']));
  const form = parseLoginForm(String(g.data));

  const body = { ...form.hidden };
  body[form.userField] = username;
  body[form.passField] = password;
  const loginBtn = form.buttons.find((b) => /log/i.test(b.name) || /log/i.test(b.value));
  if (loginBtn) body[loginBtn.name] = loginBtn.value || 'Login';
  else body.login = 'Login';

  const action = absoluteUrl(baseUrl, form.action || '/login');
  const p = await req({
    method: 'post',
    url: action,
    data: new URLSearchParams(body).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
  });
  Object.assign(jar, parseSetCookie(p.headers['set-cookie']));
  debug(`login status=${p.status}, cookies=[${Object.keys(jar).join(', ')}]`);

  if (Object.keys(jar).length === 0) {
    throw new Error('Login produced no cookies — credentials or login form may be wrong.');
  }
  return jar;
}

function absoluteUrl(baseUrl, action) {
  if (/^https?:\/\//i.test(action)) return action;
  return `${baseUrl}/${String(action).replace(/^\//, '')}`;
}

/** GET the reply form for a thread. Returns raw HTML + parsed form. */
export async function fetchPostForm(target, jar) {
  const baseUrl = new URL(target).origin;
  const id = threadId(target);
  if (!id) throw new Error(`Could not extract topic id from ${target}`);
  const url = `${baseUrl}/post?t=${id}&mode=reply`;
  const res = await req({ method: 'get', url, headers: { Cookie: cookieHeader(jar) } });
  const html = String(res.data);
  return { baseUrl, url, status: res.status, html, form: parsePostForm(html) };
}

/** Submit an assembled body (used for both preview and real post). */
export async function submit(baseUrl, form, body, jar) {
  const action = absoluteUrl(baseUrl, form.action || '/post');
  const res = await req({
    method: 'post',
    url: action,
    data: new URLSearchParams(body).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
  });
  return { status: res.status, html: String(res.data), location: res.headers['location'] || null };
}
