#!/usr/bin/env node
/**
 * Fixture Diagnostic Tool
 * Quickly checks if a conversation is accessible in the controlled browser
 */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = new URL('../tests/fixtures-local/chatgpt', import.meta.url).pathname;
const CHROME_DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';

// Inline fixture helpers (avoid TS import issues)
function readFixtureJsonSync(fixtureId, fixturesDir) {
  const filePath = join(fixturesDir, fixtureId, 'fixture.json');
  if (!existsSync(filePath)) {
    // Try reading from manifest
    return readFixtureFromManifest(fixtureId);
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return readFixtureFromManifest(fixtureId);
  }
}

function readFixtureFromManifest(fixtureId) {
  try {
    const manifestPath = join(process.cwd(), 'tests/fixtures/chatgpt-fixtures.manifest.json');
    const content = readFileSync(manifestPath, 'utf-8');
    const fixtures = JSON.parse(content);
    return fixtures.find((f) => f.id === fixtureId) || null;
  } catch {
    return null;
  }
}

async function main() {
  const fixtureId = process.argv[2];

  if (!fixtureId) {
    console.log('Usage: pnpm legacy:fixtures:diagnose <fixture-id>');
    console.log('');
    console.log('Examples:');
    console.log('  pnpm legacy:fixtures:diagnose small-real-conversation');
    console.log('');
    process.exit(1);
  }

  console.log(`[Diagnose] Checking fixture: ${fixtureId}`);
  console.log(`[Diagnose] Connecting to controlled browser at ${CHROME_DEBUG_URL}...`);

  const fixture = readFixtureJsonSync(fixtureId, FIXTURES_DIR);

  if (!fixture) {
    console.error(`❌ Fixture "${fixtureId}" not found in ${FIXTURES_DIR}`);
    console.log('');
    console.log('Available fixtures:');
    // TODO: List available fixtures
    process.exit(1);
  }

  console.log(`[Diagnose] Target URL: ${fixture.url}`);
  console.log('');

  let browser = null;
  try {
    browser = await chromium.connectOverCDP(CHROME_DEBUG_URL);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();

    // Navigate to the conversation
    console.log('[Diagnose] Navigating to conversation...');
    const response = await page.goto(fixture.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Wait a bit for any redirects
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    const title = await page.title().catch(() => 'N/A');

    console.log('');
    console.log('=== DIAGNOSIS RESULTS ===');
    console.log('');
    console.log(`Initial HTTP Status: ${response?.status() ?? 'N/A'}`);
    console.log(`Final URL: ${finalUrl}`);
    console.log(`Page Title: ${title}`);
    console.log('');

    // Check if we were redirected to home
    const isRedirectedToHome = finalUrl === 'https://chatgpt.com/' || finalUrl === 'https://chatgpt.com';
    if (isRedirectedToHome) {
      console.log('❌ STATUS: Redirected to homepage');
      console.log('');
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║           CONVERSATION ACCESS DENIED                             ║');
      console.log('╚════════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('DIAGNOSIS:');
      console.log('  The conversation exists in config but is not accessible from');
      console.log('  the current browser session. This usually means:');
      console.log('');
      console.log('  1. 🔐 NOT LOGGED IN');
      console.log('     The browser needs to login to ChatGPT first');
      console.log('');
      console.log('  2. 🔒 WRONG ACCOUNT');
      console.log('     The conversation belongs to a different ChatGPT account');
      console.log('');
      console.log('  3. 🗑️  CONVERSATION DELETED');
      console.log('     The conversation no longer exists or was deleted');
      console.log('');
      console.log('  4. 🏢 WORKSPACE/TEAM ISSUE');
      console.log('     The conversation is in a workspace you have no access to');
      console.log('');
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║  IMMEDIATE FIX STEPS                                            ║');
      console.log('╚════════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('STEP 1: Check if logged in');
      console.log('  👉 Look at the controlled browser window');
      console.log(`  👉 Visit: ${fixture.url}`);
      const pageSummary = await page.evaluate(() => {
        return {
          hasLoginButton: document.querySelector('[data-testid="login-button"]') !== null,
          hasChatHistory: document.querySelector('[data-testid="chat-history"]') !== null,
        };
      });
      if (pageSummary.hasLoginButton) {
        console.log('  🔴 DETECTED: Login button present - You need to login!');
      } else if (pageSummary.hasChatHistory) {
        console.log('  🟡 DETECTED: Chat history sidebar visible - Logged in but');
        console.log('     conversation not in history');
      }
      console.log('');
      console.log('STEP 2: If not logged in');
      console.log('  1. Click "Log in" in the controlled browser');
      console.log('  2. Enter your ChatGPT credentials');
      console.log('  3. Complete any 2FA if required');
      console.log('  4. After login, manually visit the conversation URL');
      console.log('  5. Confirm the conversation loads and shows messages');
      console.log('');
      console.log('STEP 3: If conversation still not found');
      console.log('  1. Open https://chatgpt.com in the controlled browser');
      console.log('  2. Look for the conversation in your history sidebar');
      console.log('  3. If not there, the conversation may be deleted or in');
      console.log('     another account/workspace');
      console.log('');
      console.log('STEP 4: Alternative - Use a different conversation');
      console.log('  1. Create a new conversation in ChatGPT');
      console.log('  2. Copy the conversation ID from the URL');
      console.log('  3. Update the fixture:');
      console.log(`     pnpm legacy:fixtures:update-id <new-conversation-id>`);
      console.log('');
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║  QUICK VERIFICATION                                             ║');
      console.log('╚════════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('After fixing, run this diagnostic again:');
      console.log(`  pnpm legacy:fixtures:diagnose ${fixtureId}`);
      console.log('');
      console.log('Once this passes, capture the fixture:');
      console.log(`  pnpm legacy:fixtures:capture ${fixtureId}`);
      console.log('');
      process.exit(1);
    }

    // Check if we're on the conversation page
    if (finalUrl.includes(fixture.conversationId)) {
      console.log('✅ STATUS: Successfully accessed conversation');
      console.log('');

      // Check for conversation data in the page
      const hasConversationData = await page.evaluate(() => {
        return (
          document.querySelector('[data-testid="conversation-turn"]') !== null ||
          document.querySelector('[data-message-author-role]') !== null ||
          document.querySelector('.text-token-text-primary') !== null
        );
      });

      if (hasConversationData) {
        console.log('✅ Conversation content is visible');
        console.log('');
        console.log('You can now capture this fixture:');
        console.log(`  pnpm legacy:fixtures:capture ${fixtureId}`);
      } else {
        console.log('⚠️  On conversation page but content may not be fully loaded');
        console.log('   Try waiting a moment and re-running this diagnostic');
      }
    } else {
      console.log(`⚠️  STATUS: Unexpected final URL: ${finalUrl}`);
      console.log('   The page may be showing an error or different content');
    }

    await page.close();
  } catch (error) {
    console.error('');
    console.error('❌ CONNECTION ERROR');
    console.error('');
    if (error.message.includes('ECONNREFUSED')) {
      console.error('Could not connect to controlled browser.');
      console.error('Make sure Chrome is running with remote debugging enabled:');
      console.error('  pnpm debug:mcp-chrome');
    } else {
      console.error(error.message);
    }
    console.error('');
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

main();
