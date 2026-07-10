import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parsePostForm,
  parseLoginForm,
  buildPostBody,
  parseSetCookie,
  cookieHeader,
  threadId,
} from '../src/publishers/forum-poster.js';

// A representative forumotion reply form. NOTE: replace this with the real
// captured HTML from `publish --dump-form` (Stage B) to lock the parser to
// reality — the field/token names below are illustrative.
const REPLY_FORM = `
<html><body>
  <form action="/post" method="post" name="post">
    <input type="hidden" name="t" value="2964">
    <input type="hidden" name="mode" value="reply">
    <input type="hidden" name="tid" value="abc123token">
    <input type="hidden" name="auth" value="9f8e7d">
    <input type="text" name="subject" value="Re: Tipstävling">
    <textarea name="message"></textarea>
    <input type="submit" name="post" value="Send">
    <input type="submit" name="preview" value="Preview">
  </form>
</body></html>`;

describe('parsePostForm', () => {
  const form = parsePostForm(REPLY_FORM);

  test('round-trips ALL hidden fields (incl. csrf/token names we do not hardcode)', () => {
    assert.deepStrictEqual(form.hidden, {
      t: '2964', mode: 'reply', tid: 'abc123token', auth: '9f8e7d',
    });
  });

  test('detects message, subject and submit buttons', () => {
    assert.strictEqual(form.messageField, 'message');
    assert.strictEqual(form.subjectField, 'subject');
    assert.strictEqual(form.subjectValue, 'Re: Tipstävling');
    assert.deepStrictEqual(form.buttons.map((b) => b.name).sort(), ['post', 'preview']);
    assert.strictEqual(form.action, '/post');
  });

  test('throws when there is no post form (e.g. not logged in)', () => {
    assert.throws(() => parsePostForm('<html><body>Please log in</body></html>'));
  });
});

describe('buildPostBody', () => {
  const form = parsePostForm(REPLY_FORM);

  test('includes hidden fields + message and selects the post button', () => {
    const body = buildPostBody(form, { message: 'STANDINGS', mode: 'post' });
    assert.strictEqual(body.t, '2964');
    assert.strictEqual(body.tid, 'abc123token');
    assert.strictEqual(body.auth, '9f8e7d');
    assert.strictEqual(body.message, 'STANDINGS');
    assert.strictEqual(body.post, 'Send');
    assert.ok(!('preview' in body), 'does not also send the preview button');
  });

  test('preview mode selects the preview button instead', () => {
    const body = buildPostBody(form, { message: 'X', mode: 'preview' });
    assert.strictEqual(body.preview, 'Preview');
    assert.ok(!('post' in body));
  });

  test('keeps the form subject unless overridden', () => {
    assert.strictEqual(buildPostBody(form, { message: 'X' }).subject, 'Re: Tipstävling');
    assert.strictEqual(buildPostBody(form, { message: 'X', subject: 'Ny' }).subject, 'Ny');
  });
});

describe('parseLoginForm', () => {
  test('finds username/password field names and hidden fields', () => {
    const html = `<form action="/login" method="post">
      <input type="hidden" name="redirect" value="/">
      <input type="text" name="username">
      <input type="password" name="password">
      <input type="submit" name="login" value="Logga in">
    </form>`;
    const f = parseLoginForm(html);
    assert.strictEqual(f.userField, 'username');
    assert.strictEqual(f.passField, 'password');
    assert.strictEqual(f.hidden.redirect, '/');
  });
});

describe('cookie helpers', () => {
  test('parses Set-Cookie headers into a jar', () => {
    const jar = parseSetCookie([
      'fa_1234_sid=abcd; path=/; HttpOnly',
      'fa_1234_data=xyz; path=/',
    ]);
    assert.deepStrictEqual(jar, { fa_1234_sid: 'abcd', fa_1234_data: 'xyz' });
  });

  test('serialises a jar into a Cookie header', () => {
    assert.strictEqual(cookieHeader({ a: '1', b: '2' }), 'a=1; b=2');
  });
});

describe('threadId', () => {
  test('extracts the topic id from a forumotion url', () => {
    assert.strictEqual(threadId('https://www.luleahockeyforum.com/t2964-tipstavling-2026-2027'), '2964');
    assert.strictEqual(threadId('https://x/t2343p550-slug#323707'), '2343');
    assert.strictEqual(threadId('https://x/no-topic-here'), null);
  });
});
