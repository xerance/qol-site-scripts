#!/usr/bin/env node
// Keep the versions printed in the docs equal to each script's @version header.
//
//   node tools/sync-readme-versions.js          rewrite the docs
//   node tools/sync-readme-versions.js --check   report drift, change nothing (exit 1 if any)
//
// Two places carry a version: the "Current version" line under a script's own
// README heading, and the Version column of the install table in README.md.
// The headers in the .user.js files are the only source — nothing here is typed
// by hand, so a bump needs no doc edit, just a run.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');

// Each script's own README, and the heading its version line sits under.
const HEADINGS = [
    ['README-niya.md',        '# NiyaVisited',                 'niya-visited.user.js'],
    ['README-niya.md',        '# NiyaTags (companion script)',  'niya-tags.user.js'],
    ['README-cumst.md',       '# CumstVisited',                 'cumst-visited.user.js'],
    ['README-pawchive.md',    '# PawchiveVisited',              'pawchive-visited.user.js'],
    ['README-f95.md',         '# F95Visited',                   'f95-visited.user.js'],
    ['README-subtitlecat.md', '# SubtitleCatLangFilter — `subtitlecat-lang-filter.user.js`', 'subtitlecat-lang-filter.user.js'],
];

const LINE = 'Current version: ';
const problems = [];
const changed = [];

function version(script) {
    const p = path.join(ROOT, script);
    if (!fs.existsSync(p)) { problems.push('no such script: ' + script); return null; }
    const m = /@version\s+(\S+)/.exec(fs.readFileSync(p, 'utf8'));
    if (!m) { problems.push('no @version header in ' + script); return null; }
    return m[1];
}

function write(file, text, before) {
    if (text === before) return;
    changed.push(file);
    if (!CHECK) fs.writeFileSync(path.join(ROOT, file), text);
}

// 1. the line under each heading
for (const [file, heading, script] of HEADINGS) {
    const v = version(script);
    if (!v) continue;
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) { problems.push('no such README: ' + file); continue; }

    const before = fs.readFileSync(p, 'utf8');
    const lines = before.split('\n');
    const i = lines.indexOf(heading);
    if (i < 0) { problems.push('heading not found in ' + file + ': ' + heading); continue; }

    const wanted = '**' + LINE + v + '**';
    // The line lives two below the heading, past the blank line. Replace it if
    // it's already there, insert it if it isn't.
    if ((lines[i + 2] || '').startsWith('**' + LINE)) lines[i + 2] = wanted;
    else lines.splice(i + 1, 0, '', wanted);
    write(file, lines.join('\n'), before);
}

// 2. the Version column of the install table in README.md
{
    const file = 'README.md';
    const p = path.join(ROOT, file);
    const before = fs.readFileSync(p, 'utf8');
    let text = before;

    if (!/^\| Script \| Site \| Version \| \|$/m.test(text)) {
        text = text.replace(/^\| Script \| Site \| \|$\n^\| --- \| --- \| --- \|$/m,
            '| Script | Site | Version | |\n| --- | --- | --- | --- |');
    }

    let rows = 0;
    text = text.replace(
        /^\| (\S+) \| ([^|]+?) \|(?: [^|]* \|)? \[install\]\((\S+\/([^/)]+\.user\.js))\) \|$/gm,
        (whole, name, site, url, script) => {
            const v = version(script);
            if (!v) return whole;
            rows++;
            return '| ' + name + ' | ' + site + ' | ' + v + ' | [install](' + url + ') |';
        });

    if (!rows) problems.push('no install-table rows matched in README.md');
    write(file, text, before);
}

if (problems.length) {
    for (const p of problems) console.error('error: ' + p);
    process.exit(2);
}

if (!changed.length) {
    console.log('versions already in sync');
    process.exit(0);
}

const list = [...new Set(changed)].join(', ');
if (CHECK) {
    console.error('out of date: ' + list);
    console.error('run: node tools/sync-readme-versions.js');
    process.exit(1);
}
console.log('updated: ' + list);
