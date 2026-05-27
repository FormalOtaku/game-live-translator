#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'test', 'scripts'];

function collectJavaScriptFiles(absoluteDir) {
  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Expected ${path.relative(repoRoot, absoluteDir)}/ to exist before syntax checking`);
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDir, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolutePath);
    }
  }

  return files;
}

const files = sourceRoots
  .flatMap((relativeDir) => collectJavaScriptFiles(path.join(repoRoot, relativeDir)))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.error(`No JavaScript files found under ${sourceRoots.map((root) => `${root}/`).join(', ')}.`);
  process.exit(1);
}

let hasFailure = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`Failed to run node --check for ${path.relative(repoRoot, file)}: ${result.error.message}`);
    hasFailure = true;
    continue;
  }

  if (result.status !== 0) {
    const detail = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    console.error(`Syntax check failed for ${path.relative(repoRoot, file)} (${detail}).`);
    hasFailure = true;
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log(`Syntax check passed (${files.length} files).`);
