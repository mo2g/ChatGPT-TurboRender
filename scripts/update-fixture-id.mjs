#!/usr/bin/env node
/**
 * Update fixture conversation ID across all files
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const FIXTURES_DIR = new URL('../tests/fixtures-local/chatgpt', import.meta.url).pathname;
const FILES_TO_UPDATE = [
  'tests/fixtures/chatgpt-fixtures.manifest.json',
  'tests/unit/conversation-bootstrap.test.ts',
  'tests/integration/controller.test.ts',
  'tests/unit/conversation-trim.test.ts',
  'tests/unit/chatgpt-fixtures.test.ts',
  '.tmp-debug-readaloud.mjs',
];

// Load current fixture ID from manifest to avoid hardcoding
const FIXTURES_MANIFEST = new URL('../tests/fixtures/chatgpt-fixtures.manifest.json', import.meta.url).pathname;
const OLD_ID = JSON.parse(readFileSync(FIXTURES_MANIFEST, 'utf-8'))[0]?.conversationId || '';

function updateFile(filePath, oldId, newId) {
  const fullPath = join(process.cwd(), filePath);
  try {
    let content = readFileSync(fullPath, 'utf-8');
    const original = content;

    // Replace all occurrences
    content = content.replace(new RegExp(oldId, 'g'), newId);

    if (content !== original) {
      writeFileSync(fullPath, content, 'utf-8');
      console.log(`✅ Updated: ${filePath}`);
      return true;
    }
    return false;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`⚠️  Skipped (not found): ${filePath}`);
      return false;
    }
    console.error(`❌ Error updating ${filePath}: ${err.message}`);
    return false;
  }
}

function createFixtureJson(fixtureId, conversationId) {
  const dir = join(FIXTURES_DIR, fixtureId);
  const filePath = join(dir, 'fixture.json');

  const fixture = {
    id: fixtureId,
    url: `https://chatgpt.com/c/${conversationId}`,
    conversationId: conversationId,
    expectedMinTurns: 16,
    warmupProfile: 'archive-read-aloud-smoke',
  };

  try {
    writeFileSync(filePath, JSON.stringify(fixture, null, 2), 'utf-8');
    console.log(`✅ Created: ${filePath}`);
    return true;
  } catch (err) {
    console.error(`❌ Error creating fixture.json: ${err.message}`);
    return false;
  }
}

async function main() {
  const newId = process.argv[2];

  if (!newId) {
    console.log('Usage: pnpm legacy:fixtures:update-id <new-conversation-id>');
    console.log('');
    console.log('Example:');
    console.log('  pnpm legacy:fixtures:update-id abc123def-4567-8901-2345-678901234567');
    console.log('');
    console.log('Get your conversation ID from ChatGPT URL:');
    console.log('  https://chatgpt.com/c/[conversation-id]');
    console.log('');
    process.exit(1);
  }

  // Validate ID format (rough check)
  if (!/^[a-f0-9-]{36,}$/i.test(newId)) {
    console.error('❌ Invalid conversation ID format');
    console.log('   Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    process.exit(1);
  }

  console.log(`[Update] Replacing ${OLD_ID} with ${newId}`);
  console.log('');

  let updatedCount = 0;
  for (const file of FILES_TO_UPDATE) {
    if (updateFile(file, OLD_ID, newId)) {
      updatedCount++;
    }
  }

  console.log('');
  console.log('Creating fixture.json files...');
  createFixtureJson('small-real-conversation', newId);

  console.log('');
  console.log(`✅ Updated ${updatedCount} files`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Verify the changes with: git diff');
  console.log('  2. Capture the new fixture:');
  console.log(`     pnpm legacy:fixtures:capture small-real-conversation`);
  console.log('  3. Re-run the fixture health check:');
  console.log('     pnpm legacy:fixtures:check');
}

main();
