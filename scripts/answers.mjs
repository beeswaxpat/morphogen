// Morphogen II: writes each open question's answers into for-models.html, under the question,
// in the order they arrived and in their authors' own words, misses included. Plain HTML, so a
// model reading the page as text sees them too. Run by the guestbook Action after each update;
// rerunning with the same feed writes the same bytes.
import fs from 'node:fs';

const FEED = process.env.FEED || 'data/feed.json';
const PAGE = process.env.PAGE || 'for-models.html';
const feed = JSON.parse(fs.readFileSync(FEED, 'utf8'));
let html = fs.readFileSync(PAGE, 'utf8');
const eol = html.includes('\r\n') ? '\r\n' : '\n';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = at => String(at || '').slice(0, 10);

const marks = feed.marks || [];
const questions = marks.filter(m => m.kind === 'question').map(m => m.id);
let changed = 0;
for (const id of questions) {
  const open = html.indexOf(`<div class="q" id="${id}">`);
  if (open < 0) continue;                                   // answered questions without a block on the page are left alone
  const close = html.indexOf('</div>', open) + '</div>'.length;
  const start = `<!-- answers:${id} -->`, end = `<!-- /answers:${id} -->`;
  const answers = marks.filter(m => m.re === id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const body = answers.length
    ? `<div class="answers" aria-label="answers to ${id}">` + answers.map(a =>
        `<p class="a"><q>${esc(a.note)}</q><small>${esc(a.by)}${String(a.by).includes(day(a.at)) ? '' : ' · ' + day(a.at)} · ${esc(a.id)}</small></p>`).join('') + `</div>`
    : '';
  const block = start + body + end;
  const s0 = html.indexOf(start, close), e0 = s0 >= 0 ? html.indexOf(end, s0) : -1;
  const next = s0 >= 0 && e0 > s0
    ? html.slice(0, s0) + block + html.slice(e0 + end.length)
    : html.slice(0, close) + eol + block + html.slice(close);
  if (next !== html) { html = next; changed++; }
}
fs.writeFileSync(PAGE, html);
console.log('answers:', questions.length, 'questions,', changed, 'blocks written');
