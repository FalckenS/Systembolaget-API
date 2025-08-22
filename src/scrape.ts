import { chromium } from "playwright";
import fs from "fs";

interface Product {
  name: string;
  price: string;
  abv: string;    // %
  volume: string; // Liter
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const products: Product[] = [];
  let pageNum = 1;

  while (true) {
    console.log(`Scraping page ${pageNum}...`);
    await page.goto(
        `https://www.systembolaget.se/sortiment/?sortera-pa=Price&i-riktning=Ascending&p=${pageNum}`,
        { waitUntil: "domcontentloaded", timeout: 60000 }
    );

    // Wait for one card to appear on the page
    await page.waitForSelector("div.relative.flex.flex-1.flex-col.px-4", { timeout: 60000 });

    const productsOnPage = await page.$$eval(
        "div.relative.flex.flex-1.flex-col.px-4",
        (cards) =>
        cards.map((card) => {
            const name = (card.querySelector("p.monopol-250")?.textContent || "").trim();
            const price = (card.querySelector("p.sans-strong-175")?.textContent || "").trim();

            const ps = Array.from(card.querySelectorAll("p.sans-175")).map(p => p.textContent?.trim() || "");
            const volume = ps.find(text => text.endsWith("ml")) || "";
            const abv = ps.find(text => text.endsWith("% vol.")) || "";

            return { name, price, volume, abv };
        })
    );
    products.push(...productsOnPage);
    break;
    }

  await browser.close();

  fs.writeFileSync("products.json", JSON.stringify(products, null, 2));
  console.log(`Scraping complete. ${products.length} products saved.`);
})();