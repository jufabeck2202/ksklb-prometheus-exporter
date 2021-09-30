const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const prom = require("prom-client");
const puppeteer = require("puppeteer");
const cron = require("node-cron");

const express = require("express");

// Metric stuff
const app = express();
const port = 3002;
const collectDefaultMetrics = prom.collectDefaultMetrics;
collectDefaultMetrics();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", await prom.register.contentType);
  res.end(await prom.register.metrics());
});

const server = app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`);
});
// object-Array
let counters = {};

let is_fetching = false;

cron.schedule(` 0 0 */${process.env.EVERY_HOUR} * * * *`, async () => {
  if (is_fetching) {
    console.log("already Fetching");
    return;
  }
  console.log("start fetching");

  is_fetching = true;
  page = await downloadWebpage();
  parseAccounts(page);
  is_fetching = false;
  console.log("finished-fetching");
});

const setGauge = (counterName, value, account) => {
  if (counterName in counters) {
    counters[counterName].set({ account: account }, value);
  } else {
    const newCounter = new prom.Gauge({
      name: counterName,
      help: counterName + "current value",
      labelNames: ["account"],
    });
    counters[counterName] = newCounter;
    counters[counterName].set({ account: account }, value);
  }
};

const downloadWebpage = async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(
    "https://www.ksklb.de/de/home/onlinebanking/finanzstatus.html?n=true",
    { waitUntil: "networkidle2" }
  );

  const cookie = await page.$x("/html/body/div/div[10]/div/div/div[2]/a[2]");
  await cookie[0].click();

  const username = await page.$x(
    "/html/body/div/section/div/div/div[2]/div/form/div[3]/div[1]/input"
  );
  await username[0].type(process.env.USERNAME);

  const password = await page.$x(
    "/html/body/div/section/div/div/div[2]/div/form/div[3]/div[2]/input"
  );
  await password[0].type(process.env.PASSWORD);

  const submit = await page.$x(
    "/html/body/div/section/div/div/div[2]/div/form/div[5]/div/div/input"
  );
  await submit[0].click();
  //wait for new page
  await page.waitForXPath(
    "/html/body/div/section/div/div/div[3]/form/div[4]/div[1]/a"
  );

  const drucken = await page.$x(
    "/html/body/div/section/div/div/div[3]/form/div[4]/div[1]/a"
  );
  const clink = await page.evaluate(
    (el) => el.getAttribute("href"),
    drucken[0]
  );
  console.log(clink);
  await page.goto("https://www.ksklb.de" + clink, {
    waitUntil: "networkidle2",
  });
  return await page.content();
};

const parseAccounts = (page) => {

  const dom = new JSDOM(page);
  const document = dom.window.document;
  const tbody = document.getElementsByTagName("tbody");
  const items = tbody[0];
  for (const i in items.children) {
    if (i == "item") return;
    // if row == 1  -> not relevant
    // length 2 == sum of accounts
    // length 3 == banking account
    const row = items.children.item(i);
    if (row.children.length == 3) {
      let accountNamen = row.children[0].children[0].children[0].innerHTML;
      const sanatizedName = accountNamen.replace(/\W/g, "").toLowerCase();

      let iban = row.children[0].children[0].children[1].children[1].innerHTML;
      const sanazizedIban = iban.replace(/\W/g, "").toLowerCase();
      let balance = (
        row.children[2].children[0].children[0].innerHTML +
        row.children[2].children[0].children[1].innerHTML
      )
        .replace("&nbsp;EUR", "")
        .replace(".", "")
        .replace(",", ".");

      setGauge(sanatizedName, Number(balance), sanazizedIban);
    }

    if (row.children.length == 2) {
      let saldo = row.children[0].children[0].children[0].innerHTML;
      let sanazizedSaldo = saldo.replace(/\W/g, "").toLowerCase();
      let balance = (
        row.children[1].children[0].children[0].innerHTML +
        row.children[1].children[0].children[1].innerHTML
      )
        .replace("&nbsp;EUR", "")
        .replace(".", "")
        .replace(",", ".");
      setGauge(sanazizedSaldo, Number(balance), "summe");
    }
  }
};
