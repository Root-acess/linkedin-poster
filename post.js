const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function saveScreenshot(page, name) {
  const dir = './artifacts';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 Saved screenshot: ${file}`);
}

async function clickIfExists(page, locator, desc) {
  const el = await page.$(locator);
  if (el) {
    console.log(`➡️ Clicking ${desc}`);
    await el.click();
    return true;
  }
  return false;
}

(async () => {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ Missing env: LINKEDIN_EMAIL / LINKEDIN_PASSWORD");
    process.exit(1);
  }

  // 0) Load & rotate next post
  const postsPath = './posts.txt';
  let posts = [];
  try {
    posts = fs.readFileSync(postsPath, 'utf-8')
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    console.error("❌ posts.txt not found");
    process.exit(1);
  }
  if (!posts.length) {
    console.log("⚠️ No posts found in posts.txt");
    process.exit(0);
  }
  const postText = posts[0];
  fs.writeFileSync(postsPath, posts.slice(1).concat(postText).join('\n') + '\n');

  console.log(`📝 Will post: "${postText.slice(0, 100)}..."`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1) Login
    console.log("🌐 Navigating to login...");
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // If already logged in (cookie/session from last run), /login may redirect to /feed
    if (/linkedin\.com\/login/.test(page.url())) {
      await page.fill('#username', email, { timeout: 20000 });
      await page.fill('#password', password, { timeout: 20000 });

      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForLoadState('networkidle', { timeout: 60000 })
      ]);
    }

    // 1a) Handle checkpoint / verification (we can’t complete 2FA in CI)
    if (/checkpoint|challenge|verification/.test(page.url())) {
      await saveScreenshot(page, 'blocked-checkpoint');
      throw new Error('Hit LinkedIn checkpoint/verification. Use cookie-based login or disable 2FA for this bot account.');
    }

    // 2) Go to feed + try to open composer with different strategies
    console.log("🏠 Going to /feed ...");
    await page.goto('https://www.linkedin.com/feed/?shareBox=true', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Handle cookie dialog / overlays (names vary; try broad patterns)
    await clickIfExists(page, 'button:has-text("Accept")', 'cookie accept');
    await clickIfExists(page, 'button:has-text("I agree")', 'cookie agree');
    await clickIfExists(page, 'button:has-text("Got it")', 'got it');
    await page.waitForTimeout(1000);

    // Strategy A: Role-based (more resilient)
    const roleBtn = await page.getByRole('button', { name: /start a post|create a post|post/i }).first();
    if (await roleBtn.count().catch(() => 0)) {
      console.log('🟢 Found composer button via role/name');
      await roleBtn.click();
    } else {
      // Strategy B: Known CSS variants
      const selectors = [
        'button[aria-label^="Start a post"]',
        'button[aria-label*="Start a post"]',
        'div[role="button"]:has-text("Start a post")',
        'button.share-box-feed-entry__trigger',
        'div.share-box-feed-entry__closed',
        '[data-test-global-nav-create-menu-trigger]'
      ];

      let opened = false;
      for (const sel of selectors) {
        const ok = await clickIfExists(page, sel, sel);
        if (ok) {
          opened = true;
          break;
        }
      }

      // Strategy C: Fallback — open composer by URL param again
      if (!opened) {
        console.log('🔁 Fallback: reloading with shareBox param');
        await page.goto('https://www.linkedin.com/feed/?shareBox=true', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      }
    }

    // 3) Find the editor and type
    // The editor might take time to mount. Try multiple candidates.
    const editorCandidates = [
      'div[role="textbox"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];

    let editorFound = false;
    for (const sel of editorCandidates) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        await page.click(sel);
        await page.keyboard.type(postText, { delay: 15 });
        editorFound = true;
        console.log(`✍️ Typed post into editor: ${sel}`);
        break;
      } catch (_) {
        // try next selector
      }
    }

    if (!editorFound) {
      await saveScreenshot(page, 'no-editor');
      throw new Error("Could not find the post editor (composer didn't open).");
    }

    // 4) Click Post
    const postButtons = [
      'button:has-text("Post")',
      'button[aria-label*="Post"]',
      'button.share-actions__primary-action',
      'button[role="button"]:has-text("Post")'
    ];

    let posted = false;
    for (const sel of postButtons) {
      const ok = await page.$(sel);
      if (ok) {
        await page.waitForTimeout(1200);
        await ok.click();
        posted = true;
        break;
      }
    }

    if (!posted) {
      await saveScreenshot(page, 'no-post-button');
      throw new Error('Could not find the Post button.');
    }

    console.log("🎯 Successfully posted!");
    await page.waitForTimeout(2500);
  } catch (err) {
    console.error("🚨 Error:", err.message);
    await saveScreenshot(page, 'error-final');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
