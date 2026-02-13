const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/nix/store/lpdrfl6n16q5zdf8acp4bni7yczzcx3h-idx-builtins/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 800 });
    await page.goto('file://' + path.join(__dirname, 'product-thumbnail.html'), { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 3000));

    await page.screenshot({
        path: path.join(__dirname, '..', 'detail-page', 'output', 'product-thumbnail.png'),
        type: 'png'
    });
    console.log('Thumbnail saved: detail-page/output/product-thumbnail.png');
    await browser.close();
})();
