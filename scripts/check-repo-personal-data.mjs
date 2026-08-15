#!/usr/bin/env node
/*
 * check-repo-personal-data.mjs — real people must not enter this repository.
 *
 * WHY THIS EXISTS
 *
 * seed_telent_atw.sql was committed on 18 July 2026: 8,134 lines describing a
 * client's workforce. 316 named employees, their line managers by name, and
 * 6,449 authority-to-work holdings, which are clearance and screening records
 * rather than a staff list. The pilot was torn down on 29 July and the file sat
 * in the repository for a further two weeks, unnoticed, unrunnable (it INSERTs a
 * column that had been dropped) and unreferenced by anything.
 *
 * It was deleted on 12 August. That removed it from HEAD and not from history,
 * because git is append-only: the data is still readable at the commit that
 * introduced it, in every clone and on the remote, and removing it properly means
 * rewriting history and force-pushing.
 *
 * Which is the whole point. There is no cheap fix after the commit. The only
 * control that works is the one that runs before it.
 *
 * WHAT TO DO INSTEAD
 *
 *   - Real customer data goes in through the product: the console sheet upload
 *     writes to D1 directly and never creates a file in this repository.
 *   - A generated SQL file for a one-off load belongs outside the repo, or in a
 *     gitignored path. migrations/seed_course_content_*.sql already works this
 *     way: generated, applied, never committed.
 *   - Demo and test data must be fabricated. Not anonymised real data, which is
 *     re-identifiable from role and reporting line, but invented.
 *
 * HOW IT DECIDES
 *
 * Bulk, not presence. One name in a comment is an author credit; two hundred in
 * one file is a workforce. It counts values that look like a person's name in
 * SQL string position, and fails a file over the threshold. Emails outside the
 * test domains are counted at a much lower threshold, because a real address is
 * a stronger signal than a name and rarely appears by accident.
 *
 * WHAT IT WAS NOT LOOKING AT, FOUND 12 AUGUST 2026
 *
 * The first version of this gate scanned three named directories, migrations,
 * scripts and worker/src, and reported PASS on 176 files. There are 351 files in
 * this checkout once the generated trees are set aside. So it was reading fewer
 * than half of them and calling the other half clean, which is the same failure
 * the seed file itself got away with: green because nobody opened the file.
 *
 * The 175 it never opened were the repository root (42 files, including every
 * page of the product), worker/test (43 files), assets (29), scripts already in
 * but js (8), css (5), library (4) and functions (1). It now walks from the
 * repository root with a deny list instead, so a new directory is scanned the
 * day it is created rather than the day somebody remembers to add it here.
 *
 * The second hole was the extension allow list, /\.(sql|ts|js|mjs|json|csv)$/.
 * The one tracked file in this repository that exists specifically to be filled
 * with a workforce, calibrate-bulk-import-template.xlsx, has columns email,
 * name, cost_centre, department, team and reviewer_email, and could not be read
 * by the gate at all. It holds one fabricated row today. A customer fills it with
 * their staff, and the moment somebody saves a completed copy back into the
 * repository this gate was the thing that would not have noticed. The extension
 * test is now a deny list of formats that genuinely cannot hold readable text,
 * and a spreadsheet is unzipped and read. A spreadsheet whose text cannot be
 * extracted FAILS rather than being skipped, because a workbook nobody can open
 * is exactly where data hides.
 *
 * KNOWN LIMIT ON PLAIN TEXT NAMES
 *
 * The NAME pattern requires SQL single quoting, so a plain CSV of five hundred
 * staff scored zero even though .csv was on the old allowed list. That is now
 * covered for delimited data only: in .csv, .tsv and extracted spreadsheet cells
 * each field is tested whole against CELL_NAME. It is deliberately not applied to
 * source or HTML, where an unanchored two word capitalised pattern matches
 * ordinary prose and page copy in the hundreds. Bulk names sitting unquoted in a
 * .ts or .html file remain uncounted, and closing that needs a real tokeniser
 * rather than a wider regex.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');

// Directory names that are never walked. Every one of these is generated or is
// version control's own storage, so nothing in them was written by a person and
// nothing in them survives a fresh checkout. Anything not on this list IS read,
// which is the point: the old three directory allow list is what left 175 files
// unopened on 12 August 2026.
const DENY_DIR = new Set([
  'node_modules',   // installed, not authored
  '.git',           // git's own object store, and rewriting history is the only fix in there anyway
  '.wrangler',      // wrangler build and local D1 state
  '__pycache__',    // python bytecode
  'dist',           // build output
  'coverage',       // test coverage output
  '.venv',          // python virtual environment
  // _to_delete is gitignored across the estate. It is the holding pen the device
  // bridge forces, because that bridge cannot unlink a file, so anything on its
  // way out is moved here instead of removed. Nothing in it can reach a commit,
  // and this gate's promise is about what the REPOSITORY holds. Scanning it meant
  // a file git will never take could refuse a commit, which happened on
  // 13 August 2026. A gate that blocks over something it has no power to prevent
  // teaches people to bypass it.
  //
  // This does not make the holding pen safe. Real data parked here is still on
  // somebody's disk, and the Telent seed went to _local-archive for exactly that
  // reason. It is out of scope for a check about commits, not out of mind.
  '_to_delete',
]);

// File types that genuinely cannot hold readable text. This is the deny list
// that replaced the extension allow list, and it is deliberately short: if a
// format is not named here it gets opened and read. Spreadsheets are NOT here,
// they are handled below.
const DENY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|zip|gz|tgz|pdf|sqlite3?|db|pyc)$/i;
const DENY_NAME = new Set(['.DS_Store']);

// A workbook is a zip of XML, so it is text once it is unzipped. Reading it is
// not optional: this is the file format the product hands a customer to fill in
// with their workforce.
const SHEET_EXT = /\.(xlsx|xlsm)$/i;

// Names in SQL string position: 'Firstname Lastname', allowing hyphens and
// apostrophes in the surname. Deliberately not matching single words, which
// would hit every product and competency name in the estate.
const NAME = /'[A-Z][a-z]{1,15} [A-Z][a-zA-Z'’-]{1,20}'/g;

// The same shape with no quoting, tested against a WHOLE field rather than
// searched for inside one. Only ever applied to delimited data and spreadsheet
// cells, where a field holding exactly a first name and a surname is a person
// and not a sentence.
const CELL_NAME = /^[A-Z][a-z]{1,15} [A-Z][a-zA-Z'’-]{1,20}$/;
const DELIMITED_EXT = /\.(csv|tsv)$/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

// Addresses that are ours, or that cannot belong to anybody, and are therefore
// not personal data of a third party.
//
// The trailing alternation is the four top-level domains RFC 2606 and RFC 6761
// reserve for exactly this: test, invalid, localhost and example. They are
// guaranteed never to be delegated, so an address at any of them cannot reach a
// person and cannot identify one. It matches them as a SUFFIX, so acme.test and
// other.test are covered and not just a bare @test.
//
// That suffix was missing on 13 August 2026 and this gate refused a commit over
// five addresses in a new test file, every one of them at a .test domain. A gate
// that cries wolf gets an ALLOW entry added to shut it up, and the next entry
// after that is the one that matters. The right fix for a false positive is the
// pattern, not the exception list.
const TEST_DOMAINS = /@(modulesix\.(tech|io|co\.uk)|ipp\.pro|example\.(com|org)|(?:[\w-]+\.)*(?:test|invalid|localhost|example))\b/i;

const NAME_LIMIT = 25;   // a file naming 25 people is describing a workforce
const EMAIL_LIMIT = 5;

// Files known not to describe real people. Each needs a reason, and the list is
// a ratchet in one direction, exactly like check-strict-coverage: a file that has
// become clean and been left here is a FAILURE, so the list can only ever shrink.
// Without that rule an allow list is just a way of turning the gate off one path
// at a time. reset_competency_library_9aug.sql was on this list on 12 August 2026
// carrying zero name shaped values, which is what a stale entry looks like.
const ALLOW = new Map([
  // Empty on purpose. This is a vendored copy of calibrate's gate, and calibrate's
  // ALLOW list names calibrate's files — carrying it across made this check fail in
  // every other repository on its own stale-entry ratchet, before it had read a
  // single line of this one. Each repository maintains its own list.
  //
  // Add an entry ONLY for a file that trips a threshold and genuinely holds no real
  // people, with the reason in the second field. The list is a ratchet: it may only
  // shrink, and an entry left behind after its file was cleaned is a path this gate
  // has stopped watching.
]);

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (DENY_DIR.has(e)) continue;
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function decodeXml(t) {
  return t
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

// A minimal zip reader, central directory then raw inflate. It is written out
// here rather than shelling out to unzip or adding a package because this gate
// runs in a pre-commit hook on developer machines and in CI, and it has to work
// offline in both with nothing installed. Anything it cannot parse throws, and a
// throw is a failure rather than a skip.
function unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no zip end of central directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory entry ${k} is malformed`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const lho = buf.readUInt32LE(p + 42);
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`local header for ${name} is malformed`);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.push([name, raw]);
    else if (method === 8) out.push([name, inflateRawSync(raw)]);
    else throw new Error(`unsupported compression method ${method} for ${name}`);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

// Every cell value in the workbook, one per line, so a field can be tested whole.
// Both storage shapes are read: shared strings, which is what most writers emit,
// and inline strings, which is what this repository's template actually uses.
function sheetText(file) {
  const parts = unzipEntries(readFileSync(file))
    .filter(([n]) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!parts.length) throw new Error('no worksheet or shared string part inside the workbook');
  const cells = [];
  for (const [, data] of parts) {
    const xml = data.toString('utf8');
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) cells.push(decodeXml(m[1]));
  }
  return cells.join('\n');
}

function fields(src) {
  const out = [];
  for (const line of src.split('\n')) {
    for (const f of line.split(/[,\t;]/)) out.push(f.trim().replace(/^["']|["']$/g, ''));
  }
  return out;
}

const problems = [];
const dirty = new Set();
let scanned = 0;
let sheetsRead = 0;
let skipped = 0;

for (const f of walk(ROOT)) {
  const rel = path.relative(ROOT, f);
  if (DENY_NAME.has(path.basename(f)) || DENY_EXT.test(f)) { skipped++; continue; }
  scanned++;

  let src;
  if (SHEET_EXT.test(f)) {
    try { src = sheetText(f); sheetsRead++; }
    catch (e) {
      // Never a silent skip. A spreadsheet this gate cannot open is a spreadsheet
      // nothing is checking, and this repository ships one that is designed to
      // hold a workforce.
      problems.push([rel, `is a tracked spreadsheet whose text could not be extracted (${e.message}), so nothing has read it`]);
      continue;
    }
  } else {
    try { src = readFileSync(f, 'utf8'); }
    catch (e) {
      problems.push([rel, `could not be read as text (${e.message}), so nothing has read it`]);
      continue;
    }
  }

  const names = new Set(src.match(NAME) || []);
  if (SHEET_EXT.test(f) || DELIMITED_EXT.test(f)) {
    for (const v of fields(src)) if (CELL_NAME.test(v)) names.add(v);
  }
  const emails = new Set((src.match(EMAIL) || []).filter((e) => !TEST_DOMAINS.test(e)));

  const overNames = names.size >= NAME_LIMIT;
  const overEmails = emails.size >= EMAIL_LIMIT;
  if (overNames || overEmails) dirty.add(rel);
  if (ALLOW.has(rel)) continue;

  if (overNames) problems.push([rel, `${names.size} distinct values that look like people's names`]);
  if (overEmails) problems.push([rel, `${emails.size} distinct email addresses outside the test domains`]);
}

// The ratchet. An entry that no longer trips any threshold, or whose file has
// gone, is an entry nobody is thinking about any more.
const stale = [...ALLOW.keys()].filter((k) => !dirty.has(k)).sort();

console.log('Personal data in the repository\n');
console.log(`  ${scanned} files read from the repository root, ${skipped} skipped as binary or asset`);
console.log(`  ${sheetsRead} spreadsheet(s) unzipped and read as text`);
console.log(`  ${DENY_DIR.size} directory names never walked: ${[...DENY_DIR].join(', ')}`);
console.log(`  thresholds: ${NAME_LIMIT} names, ${EMAIL_LIMIT} real email addresses`);
console.log(`  ${ALLOW.size} file(s) allowed by name, each with a stated reason\n`);

if (stale.length) {
  console.error('STALE ALLOW LIST');
  for (const f of stale) {
    console.error(`  ${f} no longer trips any threshold but is still on ALLOW ("${ALLOW.get(f)}").`);
  }
  console.error('\nRemove it from ALLOW. This list is a ratchet and may only shrink. An entry');
  console.error('left behind after the file was cleaned is a path the gate has stopped');
  console.error('watching, and the next thing written to it goes in unread.');
  process.exit(1);
}

if (problems.length) {
  console.error('PERSONAL DATA');
  for (const [f, why] of problems) console.error(`  ${f}: ${why}`);
  console.error('\nDo not commit this. Committing is not reversible: git is append-only, so');
  console.error('the data stays readable at that commit in every clone and on the remote');
  console.error('even after the file is deleted. Load real data through the product, keep');
  console.error('generated SQL outside the repository, and fabricate demo data.');
  console.error('\nIf this is a false positive, add the path to ALLOW with a reason.');
  process.exit(1);
}

console.log('PASS. No file in this repository describes a set of real people.');
