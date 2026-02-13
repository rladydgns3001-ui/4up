const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const pages = [
  'img1-hero.html',
  'img2-app-write.html',
  'img3-problems.html',
  'img4-features.html',
  'img5-howto.html',
  'img6-settings.html',
  'img7-comparison.html',
  'img8-demo.html',
  'img9-demo2.html',
  'img10-pricing.html',
  'img11-faq.html',
  'img12-cta.html'
];

async function generateImages() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/nix/store/lpdrfl6n16q5zdf8acp4bni7yczzcx3h-idx-builtins/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  for (let i = 0; i < pages.length; i++) {
    const page = await browser.newPage();
    const htmlPath = path.join(__dirname, pages[i]);

    // 2x 해상도 (레티나 대응): 뷰포트 860px + deviceScaleFactor 2 = 1720px 이미지
    await page.setViewport({ width: 860, height: 3000, deviceScaleFactor: 2 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get actual content height
    const bodyHeight = await page.evaluate(() => {
      return document.body.scrollHeight;
    });

    await page.setViewport({ width: 860, height: bodyHeight, deviceScaleFactor: 2 });

    const outputPath = path.join(outputDir, `detail-${String(i + 1).padStart(2, '0')}.png`);

    await page.screenshot({
      path: outputPath,
      fullPage: true,
      type: 'png'
    });

    console.log(`Generated: ${outputPath}`);
    await page.close();
  }

  await browser.close();
  console.log('\n✅ All images generated in ./output folder');
}

generateImages().catch(console.error);
