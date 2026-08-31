#!/usr/bin/env node
/*
 * check-published-figures.mjs — a number published on this site is declared once.
 *
 * WHY THIS EXISTS
 *
 * On 31 August 2026 the Educate course count "15" appeared seven times across
 * index.html and courses.html: in body copy, in a proof stat, in a hero meta
 * line, in a call to action, and twice in meta tags that nobody edits when a
 * course launches. The count was correct that day. Nothing made it stay correct,
 * and the failure mode is silent: the site keeps saying 15 and reads as
 * confident while it is wrong, which is worse than saying nothing.
 *
 * The feedback that surfaced it proposed deleting the number. That trades a
 * true proof point away to avoid maintaining it. This is the other fix: the
 * number is declared once, in figures.json, and this gate fails if any page
 * disagrees with the declaration.
 *
 * WHAT TO DO WHEN A COURSE LAUNCHES
 *
 * Edit figures.json. Run this script. It tells you every file and line that
 * still carries the old number, so the sweep is a list rather than a memory.
 *
 * WHAT THIS DOES NOT DO
 *
 * It cannot tell you the declaration is TRUE. This repository has no access to
 * the course catalogue: educate-content is a separate repository and the live
 * count lives in D1. This gate proves the site is internally consistent, not
 * that it is accurate. Accuracy is still a person checking educate-content
 * against figures.json when they change one.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const figures = JSON.parse(readFileSync(join(root, "figures.json"), "utf8"));

const CHECKS = [
  {
    key: "educateCourses",
    label: "Educate open courses",
    // Any integer immediately before these words is claiming the course count.
    patterns: [
      /(\d+)\s+open,?\s+self-directed courses/gi,
      /(\d+)\s+open courses/gi,
      /(\d+)\s+courses live/gi,
      /(\d+)\s+live courses/gi,
      /Browse\s+(\d+)\s+live/gi,
      /<div class="n">(\d+)<\/div>\s*<div class="l">open courses live in Educate<\/div>/gi,
    ],
  },
  {
    key: "products",
    label: "Products built and deployed",
    patterns: [
      /<div class="n">(\d+)<\/div>\s*<div class="l">products built and deployed<\/div>/gi,
    ],
  },
];

const pages = readdirSync(root).filter((f) => f.endsWith(".html"));
const failures = [];
let checked = 0;

for (const page of pages) {
  const text = readFileSync(join(root, page), "utf8");
  const lines = text.split("\n");
  for (const check of CHECKS) {
    const expected = figures[check.key];
    if (expected === undefined) {
      failures.push(`figures.json has no "${check.key}" but a check requires it`);
      continue;
    }
    for (const pattern of check.patterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        checked += 1;
        if (Number(m[1]) === expected) continue;
        const line = text.slice(0, m.index).split("\n").length;
        failures.push(
          `${page}:${line} claims ${m[1]} for ${check.label}, figures.json declares ${expected}\n` +
            `    ${lines[line - 1].trim().slice(0, 160)}`
        );
      }
    }
  }
}

if (failures.length) {
  console.error("Published figures disagree with figures.json:\n");
  for (const f of failures) console.error("  " + f);
  console.error(
    `\n${failures.length} disagreement(s). Either the page is stale or figures.json is.\n` +
      "Decide which is true, then make them match."
  );
  process.exit(1);
}

console.log(
  `Published figures consistent: ${checked} claim(s) across ${pages.length} page(s) ` +
    `agree with figures.json (${Object.entries(figures.declared ? figures.declared : figures)
      .filter(([k]) => k !== "note")
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}).`
);
