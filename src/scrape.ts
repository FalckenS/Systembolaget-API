import { chromium, Browser, Page } from 'playwright';
import fs from 'fs';

const numOfProductsBreak = Infinity;
const concurrentLoadedPages = 30;
const date = new Date().toISOString().slice(0, 10);


interface Product {
    name: string;
    price: number;
    nation: string;
    volume: number;
    abv: number;
    categories: string[];
}


function buildUrl(pageNum: number) {
    return `https://www.systembolaget.se/sortiment/?sortera-pa=Price&i-riktning=Ascending&sortiment=Fast+sortiment_eller_Lokalt+%26+Sm%C3%A5skaligt_eller_S%C3%A4song_eller_Tillf%C3%A4lligt+sortiment&saljstart-till=${date}&alkoholhalt-fran=3.6&p=${pageNum}`;
}


function extractCardDetails(cards: Element[]): Product[] {
    return cards
        // Filter out products (cards) not available
        .filter((card) => {
            return (card.querySelector('.flex.h-6.items-center.justify-center.bg-rose-100.mb-4.last-of-type\\:mb-0') === null);
        })
        // Extract product info
        .map((card) => {
            const name = card.querySelector('p.monopol-250')?.textContent ?? '';

            const price = parseFloat((card.querySelector('p.sans-strong-175')?.textContent ?? '')
                .replaceAll(':', '.')
                .replaceAll('*', '')
                .replaceAll(':-', '')
                .replaceAll(' ', '') // For price >= 1 000
            );

            /*
            otherProductInfo[]:

            otherProductInfo[0]: Nr
            otherProductInfo[1]: Nation
            otherProductInfo[2]: Volume
            otherProductInfo[3]: Abv
            */
            const otherProductInfo = Array.from(card.querySelectorAll('p.sans-175'))
                .map((p: Element) => p.textContent ?? '');

            const nation = otherProductInfo[1];

            const volume = parseInt(otherProductInfo[2]
                .replaceAll('ml', '')
                .trim()
            );

            const abv = parseFloat(otherProductInfo[3]
                .replaceAll(',', '.')
                .replaceAll('% vol.', '')
                .trim()
            );

            const categories = (card.querySelector('p.caption-175')?.textContent ?? '')
                .split(', ');

            return { name, price, nation, volume, abv, categories };
        });
}


async function getProductsOnPage(page: Page, pageNum: number) {
    let productsOnPage: Product[] = []

    try {
        const url = buildUrl(pageNum);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait for one card to appear on the page
        await page.waitForSelector('div.relative.flex.flex-1.flex-col.px-4', { timeout: 30000 });

        // page.$$eval(css-selector, pageFunction)
        // pageFunction is executed for all elements (cards) matching css-selector
        productsOnPage = await page.$$eval(
            'div.relative.flex.flex-1.flex-col.px-4',
            extractCardDetails
        );
    }
    catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        if (errorName !== 'TimeoutError')
            console.error(`Error on page ${pageNum}: ${error}`);
    }
    await page.close();
    return productsOnPage;
}


async function scrapePage(browser: Browser, pageNum: number): Promise<Product[]> {
    console.log(`Scraping page ${pageNum}...`);

    const page = await browser.newPage();
    // Block unwanted routes
    await page.route(
        '**/*',
        (route) => {
            const blockedResourceType = new Set(['image', 'font', 'media', 'stylesheet', 'other']);
            const blockedDomains = [
                'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
                'ads', 'facebook.net', 'amplitude.com', 'segment.io'
            ];

            const routeRequest = route.request();
            const resourceType = routeRequest.resourceType();
            const routeRequestUrl = routeRequest.url().toLowerCase();
            if (blockedResourceType.has(resourceType) || blockedDomains.some(domain => routeRequestUrl.includes(domain))) {
                route.abort();
            }
            else route.continue();
        }
    );
    return await getProductsOnPage(page, pageNum);
}


(async () => {
    const browser = await chromium.launch({ headless: true });
    const products: Product[] = [];
    let currentPageNum = 1;

    while (true) {
        // Generate an array of page numbers to scrape
        const currentPageNums: number[] = [];
        for (let i = 0; i < concurrentLoadedPages; i++)
            currentPageNums.push(currentPageNum + i);

        const productBatch = currentPageNums.map(
            (pageNum) => scrapePage(browser, pageNum)
        );

        const results = await Promise.all(productBatch);
        const flattenedResults = results.flat();

        products.push(...flattenedResults);
        currentPageNum += concurrentLoadedPages;

        if (flattenedResults.length === 0 || products.length > numOfProductsBreak)
            break;
    }
    await browser.close();
    fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
    console.log(`Scraping complete. ${products.length} products saved.`);
})();