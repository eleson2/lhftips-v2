import { writeFileSync } from 'fs';
import { buildStandingsText } from './standings.js';
import { login, fetchPostForm, buildPostBody, submit } from '../publishers/forum-poster.js';

/**
 * Publish (or dry-run/preview) the standings post to the forum thread.
 *
 * Safety-by-construction:
 *   - default (no --preview/--post): Stage B — log in, fetch the reply form,
 *     assemble the POST body, and PRINT it. Nothing is submitted.
 *   - --preview: Stage C — submit to the forum's Preview endpoint (renders but
 *     saves nothing).
 *   - --post: Stage E — actually publish; additionally requires --confirm.
 *   - --dump-form <file>: save the raw reply-form HTML (feeds Stage A tests).
 *
 * Credentials come from env: LHF_FORUM_USER, LHF_FORUM_PASS.
 *
 * @param {object} options
 */
export async function publishStandings(options = {}) {
  const { target, from, to, round, subject, preview = false, post = false, confirm = false, dumpForm = null } = options;

  if (!target) {
    console.error('Missing --target <thread-url> (the forum thread to post to).');
    return;
  }

  const user = process.env.LHF_FORUM_USER;
  const pass = process.env.LHF_FORUM_PASS;
  if (!user || !pass) {
    console.error('Set credentials in the environment first:');
    console.error('  export LHF_FORUM_USER="botname"');
    console.error('  export LHF_FORUM_PASS="secret"');
    return;
  }

  const text = await buildStandingsText({ from, to, round });
  if (text === null) {
    console.log('No scored guesses in range — nothing to publish yet.');
    return;
  }

  console.log('--- Standings to publish ---\n' + text + '\n----------------------------\n');

  console.log('Logging in...');
  const jar = await login(new URL(target).origin, user, pass);
  console.log(`  OK — session cookies: [${Object.keys(jar).join(', ')}]`);

  console.log(`Fetching reply form for ${target} ...`);
  const { baseUrl, url, status, html, form } = await fetchPostForm(target, jar);
  console.log(`  GET ${url} -> HTTP ${status}`);
  console.log(`  Form action: ${form.action || '(none)'} | method: ${form.method}`);
  console.log(`  Detected fields: message="${form.messageField}", subject="${form.subjectField}"`);
  console.log(`  Hidden fields: [${Object.keys(form.hidden).join(', ')}]`);
  console.log(`  Submit buttons: [${form.buttons.map((b) => `${b.name}=${b.value}`).join(', ')}]`);

  if (dumpForm) {
    writeFileSync(dumpForm, html);
    console.log(`  Saved raw form HTML -> ${dumpForm} (use it as a Stage-A test fixture)`);
  }

  if (status !== 200 || Object.keys(form.hidden).length === 0) {
    console.error('\nThe reply form did not look right (not logged in, or layout differs).');
    console.error('Inspect the dumped HTML before going further. Nothing was submitted.');
    return;
  }

  // --- Stage C: preview (renders, saves nothing) ---
  if (preview) {
    const body = buildPostBody(form, { subject, message: text, mode: 'preview' });
    console.log('\n[preview] Submitting to the Preview endpoint (nothing is published)...');
    const res = await submit(baseUrl, form, body, jar);
    console.log(`  POST -> HTTP ${res.status}`);
    const hasPreview = /preview/i.test(res.html);
    console.log(`  Response ${hasPreview ? 'contains a preview block ✓' : 'did NOT clearly contain a preview — inspect manually'}`);
    return;
  }

  // --- Stage E: real publish (guarded) ---
  if (post) {
    if (!confirm) {
      console.error('\nRefusing to publish without --confirm. (Re-run with --post --confirm.)');
      return;
    }
    const body = buildPostBody(form, { subject, message: text, mode: 'post' });
    console.log('\n[post] Publishing to the thread...');
    const res = await submit(baseUrl, form, body, jar);
    console.log(`  POST -> HTTP ${res.status}${res.location ? ` (redirect: ${res.location})` : ''}`);
    console.log('  Verify the post in your browser.');
    return;
  }

  // --- Stage B: default dry-run (assemble body, submit nothing) ---
  const body = buildPostBody(form, { subject, message: text, mode: 'post' });
  console.log('\n[dry-run] Assembled POST body (NOT submitted):');
  for (const [k, v] of Object.entries(body)) {
    const shown = k === form.messageField ? `<${String(v).length} chars of standings text>` : String(v);
    console.log(`  ${k} = ${shown.length > 80 ? shown.slice(0, 80) + '…' : shown}`);
  }
  console.log('\nDry-run only. Use --preview for a server-side preview, or --post --confirm to publish.');
}

export default publishStandings;
