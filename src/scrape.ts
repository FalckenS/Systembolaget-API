import { chromium } from 'playwright';
import fs from 'fs';

interface Product {
    name: string;
    price: number;
    abv: number;
    volume: number;
    nation: string;
    categories: string[];
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const products: Product[] = [];
    let pageNum = 1;
    const date = new Date().toISOString().slice(0, 10);

    while (true) {
        console.log(`Scraping page ${pageNum}...`);
        await page.goto(
            `https://www.systembolaget.se/sortiment/?sortera-pa=Price&i-riktning=Ascending&sortiment=Fast+sortiment_eller_Lokalt+%26+Sm%C3%A5skaligt_eller_S%C3%A4song_eller_Tillf%C3%A4lligt+sortiment&saljstart-till=${date}&p=${pageNum}`,
            { waitUntil: 'domcontentloaded', timeout: 30000 }
        );

        // Wait for one card to appear on the page
        await page.waitForSelector('div.relative.flex.flex-1.flex-col.px-4', { timeout: 30000 });

        // page.$$eval(css-selector, pageFunction)
        // pageFunction is executed for all elements matching css-selector
        const productsOnPage: Product[] = await page.$$eval(
            'div.relative.flex.flex-1.flex-col.px-4',
            (cards) => cards.map((card) => {
                const name = card.querySelector('p.monopol-250')?.textContent ?? '';
                const price = parseFloat(
                    (card.querySelector('p.sans-strong-175')?.textContent ?? '')
                    .replaceAll('*', '')
                    .replaceAll(':-', '')
                    .replaceAll(':', '.')
                    .replaceAll(' ', ''));
                const categories = (card.querySelector('p.caption-175')?.textContent ?? '')
                    .split(', ');

                // otherProductInfo[0]: Nr
                // otherProductInfo[1]: Nation
                // otherProductInfo[2]: Volume
                // otherProductInfo[3]: Abv
                const otherProductInfo = Array.from(card.querySelectorAll('p.sans-175')).map(
                    p => p.textContent ?? '');

                const nation = otherProductInfo[1] ?? '';
                const volume = parseInt(
                    (otherProductInfo[2] ?? '')
                    .replaceAll('ml', '').trim());
                const abv = parseFloat(
                    (otherProductInfo[3] ?? '')
                    .replaceAll('% vol.', '')
                    .replaceAll(',', '.').trim());

                return { name, price, volume, abv, nation, categories };
                }
            )
        );
        products.push(...productsOnPage);
        pageNum++;
        if (productsOnPage.length < 30) break;
    }
    await browser.close();

    fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
    console.log(`Scraping complete. ${products.length} products saved.`);
})();