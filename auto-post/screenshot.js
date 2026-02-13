const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/nix/store/wsdanhm606q4wzv2y98bxc5hpfbi3sap-idx-builtins/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.goto('file://' + path.join(__dirname, 'instagram-ad.html'), { waitUntil: 'networkidle0' });

    // Wait for Google Fonts to load
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 3000));

    const element = await page.$('.ad-container');
    await element.screenshot({
        path: path.join(__dirname, 'instagram-ad.png'),
        type: 'png'
    });

    console.log('Screenshot saved: instagram-ad.png');
    await browser.close();
})();
