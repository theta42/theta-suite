#!/usr/bin/env node
'use strict';

// Regression guard for setup.sh's generated config templates: no backticks
// inside an UNQUOTED heredoc.
//
// setup.sh writes every ./config/*.js file from a heredoc whose delimiter is
// unquoted (`<<PROXYEOF`, not `<<'PROXYEOF'`), because the templates depend on
// $(js_str "$CFG_...") expanding. In that mode bash also treats backticks as
// command substitution -- so a pair of backticks anywhere in the template,
// including inside a // comment, runs the enclosed word as a command.
//
// This shipped once: a comment reading "the public `issuer` ... the token's
// `iss` claim" made a fresh install print
//   ./setup.sh: line 664: issuer: command not found
//   ./setup.sh: line 664: iss: command not found
// and silently emitted the comment with those words deleted. Harmless there
// only because it landed in a comment; the same mistake one line lower, in a
// value, would substitute an empty string into deployed config.
//
// Static, not a run of setup.sh: setup.sh provisions a real stack.

const fs = require('fs');
const path = require('path');

const SETUP_PATH = path.join(__dirname, '..', 'setup.sh');
const lines = fs.readFileSync(SETUP_PATH, 'utf8').split('\n');

// `<<EOF` / `<<-EOF` open an expanding heredoc; `<<'EOF'` and `<<"EOF"` do not
// (bash suppresses every expansion there, backticks included), so those are
// skipped.
const OPEN = /<<-?([A-Za-z_][A-Za-z0-9_]*)\s*$/;

const findings = [];
let delimiter = null;

lines.forEach((line, i) => {
	if (delimiter === null) {
		const m = line.match(OPEN);
		if (m) delimiter = m[1];
		return;
	}
	if (line.trim() === delimiter) {
		delimiter = null;
		return;
	}
	if (line.includes('`')) {
		findings.push({ line: i + 1, delimiter, text: line.trim() });
	}
});

if (findings.length) {
	console.error('check_setup_heredocs: backtick(s) inside an unquoted heredoc in setup.sh.');
	console.error('Bash runs the enclosed text as a command there. Use "double quotes" instead.');
	for (const f of findings) {
		console.error(`  setup.sh:${f.line} (heredoc <<${f.delimiter}): ${f.text}`);
	}
	process.exit(1);
}

console.log('check_setup_heredocs: OK (no backticks in any expanding heredoc)');
