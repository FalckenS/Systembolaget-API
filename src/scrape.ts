import { chromium, Browser, Page } from 'playwright';
import fs from 'fs';

const concurrentLoadedPages = 10;
const date = new Date().toISOString().slice(0, 10);

interface Product {
    nr: number;
    name: string;
    taste: string;
    price: number;
    nation: string;
    volume: number;
    abv: number;
    categories: string[];
}


function extractCardDetails(cards: Element[]): Product[] {
    const notAvailableProductSelector = 'div.flex.h-6.items-center.justify-center.bg-rose-100.mb-4.last-of-type\\:mb-0';
    const nrSelector = 'p.sans-175.text-muted-foreground.mt-1.group-hover\\:text-underline';
    const nameSelector = 'p.monopol-250.text-black.group-hover\\:text-underline';
    const tasteSelector = 'p.monopol-250.text-muted-foreground.group-hover\\:text-underline';
    const priceSelector = 'p.sans-strong-175.shrink-0';
    const otherProductInfoSelector = 'p.sans-175.mr-2.max-w-\\[140px\\].overflow-hidden.text-ellipsis.whitespace-nowrap';
    const categorySelector = 'p.caption-175.uppercase';

    return cards
        // Filter out products (cards) not available
        .filter((card) => {
            return (card.querySelector(notAvailableProductSelector) === null);
        })
        // Extract product info
        .map((card) => {
            const nr = parseFloat((card.querySelector(nrSelector)?.textContent ?? '')
                .replace('Nr ', '')
                .trim()
            );

            const name = card.querySelector(nameSelector)?.textContent ?? '';

            const taste = card.querySelector(tasteSelector)?.textContent ?? '';

            const price = parseFloat((card.querySelector(priceSelector)?.textContent ?? '')
                .replace(':', '.')
                .replace('*', '')
                .replace(':-', '')
                .replace(' ', '') // For price >= 1 000
            );

            /*
            otherProductInfo[]:

            otherProductInfo[0]: Nation
            otherProductInfo[1]: Volume
            otherProductInfo[2]: Abv
            */
            const otherProductInfo = Array.from(card.querySelectorAll(otherProductInfoSelector))
                .map((p: Element) => p.textContent ?? '');

            const nation = otherProductInfo[0];

            const volume = parseInt(otherProductInfo[1]
                .replace('ml', '')
                .trim()
            );

            const abv = parseFloat(otherProductInfo[2]
                .replace(',', '.')
                .replace('% vol.', '')
                .trim()
            );

            const categories = (card.querySelector(categorySelector)?.textContent ?? '')
                .split(', ');

            return { nr, name, taste, price, nation, volume, abv, categories };
        });
}


function buildUrl(pageNum: number) {
    return `https://www.systembolaget.se/sortiment/?sortera-pa=Price&i-riktning=Ascending&sortiment=Fast+sortiment_eller_Lokalt+%26+Sm%C3%A5skaligt_eller_S%C3%A4song_eller_Tillf%C3%A4lligt+sortiment&saljstart-till=${date}&alkoholhalt-fran=3.6&p=${pageNum}`;
}


async function getProductsOnPage(page: Page, pageNum: number) {
    const productCardSelector = 'div.flex.grow.flex-col.gap-3';
    let productsOnPage: Product[] = []
    try {
        const url = buildUrl(pageNum);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for one card to appear on the page
        await page.waitForSelector(productCardSelector, { timeout: 30000 });

        // page.$$eval(css-selector, pageFunction)
        // pageFunction is executed for all elements (cards) matching css-selector
        productsOnPage = await page.$$eval(
            productCardSelector,
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

        if (flattenedResults.length === 0)
            break;
    }
    await browser.close();

    // For some reason there are sometimes duplicate products
    // Deduplicate products by nr
    const uniqueProductsMap = new Map<number, Product>();
    for (const product of products) {
        if (!uniqueProductsMap.has(product.nr)) {
            uniqueProductsMap.set(product.nr, product);
        }
    }
    const uniqueProducts = Array.from(uniqueProductsMap.values());

    fs.writeFileSync('products.json', JSON.stringify(uniqueProducts, null, 2));
    console.log(`Scraping complete. ${uniqueProducts.length} products saved.`);
})();