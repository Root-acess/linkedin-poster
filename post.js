const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  if (!email || !password) {
    console.error("Missing env: LINKEDIN_EMAIL / LINKEDIN_PASSWORD");
    process.exit(1);
  }

  // 1) Load & rotate next post
  const path = './posts.txt';
  let lines = fs.readFileSync(path, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) {
    console.log("No posts left in posts.txt");
    return;
  }
  const postText = lines[0];
  lines = lines.slice(1).concat(postText);
  fs.writeFileSync(path, lines.join('\n') + '\n');

  // 2) Launch browser
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 3) Login
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', email);
  await page.fill('#password', password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle' })
  ]);

  // Optional: small settle time
  await page.waitForTimeout(2500);

  // 4) Open composer
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const startBtn = await page.$('button[aria-label^="Start a post"], div[role="button"]:has-text("Start a post")');
  if (!startBtn) throw new Error("Start a post button not found (selector changed?)");
  await startBtn.click();

  // 5) Write post
  const editor = 'div[role="textbox"]';
  await page.waitForSelector(editor, { timeout: 10000 });
  await page.click(editor);
  await page.keyboard.type(postText, { delay: 15 });

  // 6) Click Post
  const postBtn = await page.$('button:has-text("Post")');
  if (!postBtn) throw new Error("Post button not found");
  await page.waitForTimeout(800);
  await postBtn.click();

  console.log("✅ Posted:", postText.slice(0, 120));
  await page.waitForTimeout(2500);
  await browser.close();
})();
