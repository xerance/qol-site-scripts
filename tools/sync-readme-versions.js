#!/usr/bin/env node
// Keep the versions printed in the docs equal to each script's @version header.
//
//   node tools/sync-readme-versions.js           rewrite the docs
//   node tools/sync-readme-versions.js --check   report drift, change nothing (exit 1 if any)
//
// Two places carry a version: the "Current version" line under a script's own
// README heading, and the Version column of the install table in README.md.
// The .user.js headers are the only source — a bump needs no doc edit, just a run.
//
// Nothing here is hand-listed. Scripts are found by globbing *.user.js, and a
// README heading is matched to one by its @name, so a new script is picked up
// as soon as it exists: its table row gets a version, and so does a `# Name`
// heading in a README-*.md if it has one. A script with no README of its own
// (the no-popunder pair, the video viewer) appears in the table only.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');
const LINE = 'Current version: ';
const INDEX = 'README.md';

const problems = [];
const notes = [];
const changed = new Set();

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const header = (text, field) => {
    const m = new RegExp('@' + field + '\\s+(.+)').exec(text);
    return m ? m[1].trim() : null;
};

// script file -> { name, version }, keyed also by @name for heading lookup
const scripts = new Map();
const byName = new Map();
for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.user.js')).sort()) {
    const text = read(file);
    const version = header(text, 'version');
    const name = header(text, 'name');
    if (!version) { problems.push('no @version header in ' + file); continue; }
    if (!name) { problems.push('no @name header in ' + file); continue; }
    scripts.set(file, { name, version });
    if (byName.has(name)) problems.push('two scripts call themselves ' + name);
    byName.set(name, { file, version });
}
if (!scripts.size) problems.push('no *.user.js files found in ' + ROOT);

function write(file, text, before) {
    if (text === before) return;
    changed.add(file);
    if (!CHECK) fs.writeFileSync(path.join(ROOT, file), text);
}

// 1. the "Current version" line under each `# Name` heading in a per-script README.
//    The index is skipped: its per-script sections are summaries, and its table
//    already carries every version.
for (const file of fs.readdirSync(ROOT).filter(f => /^README-.+\.md$/.test(f)).sort()) {
    const before = read(file);
    const lines = before.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('# ')) continue;
        const heading = lines[i].slice(2).trim();
        // "NiyaTags (companion script)" and "SubtitleCatLangFilter — `…`" both
        // lead with the @name; take the longest @name the heading starts with.
        let hit = null;
        for (const [name, info] of byName) {
            if (heading === name || heading.startsWith(name + ' ')) {
                if (!hit || name.length > hit.name.length) hit = { name, ...info };
            }
        }
        if (!hit) { notes.push('no script matches heading "' + heading + '" in ' + file); continue; }

        const wanted = '**' + LINE + hit.version + '**';
        if ((lines[i + 2] || '').startsWith('**' + LINE)) {
            lines[i + 2] = wanted;
        } else {
            lines.splice(i + 1, 0, '', wanted);
            i += 2;
        }
    }
    write(file, lines.join('\n'), before);
}

// 2. the Version column of the install table in the index
{
    const before = read(INDEX);
    let text = before;

    if (!/^\| Script \| Site \| Version \| \|$/m.test(text)) {
        text = text.replace(/^\| Script \| Site \| \|$\n^\| --- \| --- \| --- \|$/m,
            '| Script | Site | Version | |\n| --- | --- | --- | --- |');
    }

    let rows = 0;
    const missing = new Set(scripts.keys());
    text = text.replace(
        /^\| (\S+) \| ([^|]+?) \|(?: [^|]* \|)? \[install\]\((\S+\/([^/)]+\.user\.js))\) \|$/gm,
        (whole, label, site, url, file) => {
            const info = scripts.get(file);
            if (!info) { problems.push('install table links a script that is not here: ' + file); return whole; }
            missing.delete(file);
            rows++;
            return '| ' + label + ' | ' + site + ' | ' + info.version + ' | [install](' + url + ') |';
        });

    if (!rows) problems.push('no install-table rows matched in ' + INDEX + ' — has the table changed shape?');
    for (const file of missing) notes.push(file + ' has no row in the ' + INDEX + ' install table');
    write(INDEX, text, before);
}

for (const n of notes) console.error('note: ' + n);

if (problems.length) {
    for (const p of problems) console.error('error: ' + p);
    process.exit(2);
}

if (!changed.size) {
    console.log('versions already in sync (' + scripts.size + ' scripts)');
    process.exit(0);
}

const list = [...changed].join(', ');
if (CHECK) {
    console.error('out of date: ' + list);
    console.error('run: node tools/sync-readme-versions.js');
    process.exit(1);
}
console.log('updated: ' + list);
