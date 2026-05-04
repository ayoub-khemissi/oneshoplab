#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "fs";
import { scrapeEmails } from "./lib/scraper.js";

program
  .name("email-scraper")
  .description(
    "Extract contact emails from WooCommerce, Shopify, and Wix stores"
  )
  .argument("<urls...>", "One or more store URLs to scrape")
  .option("-o, --output <file>", "Output file path (csv or json)")
  .option(
    "-f, --format <format>",
    "Output format: json or csv (default: json)",
    "json"
  )
  .option(
    "-t, --timeout <ms>",
    "Page load timeout in ms (default: 15000)",
    "15000"
  )
  .option(
    "-d, --delay <ms>",
    "Delay between requests in ms (default: 1000)",
    "1000"
  )
  .option("--no-headless", "Show browser window (useful for debugging)")
  .action(async (urls, opts) => {
    console.log(
      chalk.cyan.bold("\n🔍 Email Scraper — WooCommerce / Shopify / Wix\n")
    );

    const results = [];

    for (const rawUrl of urls) {
      const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
      console.log(chalk.yellow(`\n━━━ Processing: ${url} ━━━`));

      try {
        const result = await scrapeEmails(url, {
          timeout: parseInt(opts.timeout),
          delay: parseInt(opts.delay),
          headless: opts.headless,
        });

        results.push(result);

        // Display result
        console.log(
          chalk.white(`  Platform:  `) +
            chalk.magenta.bold(result.platform || "Unknown")
        );
        if (result.emails.length > 0) {
          console.log(
            chalk.white(`  Emails:    `) +
              chalk.green.bold(result.emails.join(", "))
          );
        } else {
          console.log(chalk.gray(`  Emails:    None found`));
        }
        if (result.sources.length > 0) {
          console.log(
            chalk.white(`  Sources:   `) +
              chalk.dim(result.sources.join(", "))
          );
        }
      } catch (err) {
        console.log(chalk.red(`  ✗ Error: ${err.message}`));
        results.push({
          url,
          platform: "Error",
          emails: [],
          sources: [],
          error: err.message,
        });
      }
    }

    // Summary
    console.log(chalk.cyan.bold("\n━━━ Summary ━━━"));
    const totalEmails = results.reduce((s, r) => s + r.emails.length, 0);
    console.log(chalk.white(`  Sites scanned:  ${results.length}`));
    console.log(chalk.white(`  Emails found:   ${totalEmails}`));

    // Output
    if (opts.output) {
      const format = opts.format || (opts.output.endsWith(".csv") ? "csv" : "json");

      if (format === "csv") {
        const rows = results.flatMap((r) =>
          r.emails.length > 0
            ? r.emails.map((email) => ({
                url: r.url,
                platform: r.platform,
                email,
                sources: r.sources.join("; "),
              }))
            : [
                {
                  url: r.url,
                  platform: r.platform,
                  email: "",
                  sources: "",
                },
              ]
        );
        const csv = stringify(rows, {
          header: true,
          columns: ["url", "platform", "email", "sources"],
        });
        writeFileSync(opts.output, csv);
      } else {
        writeFileSync(opts.output, JSON.stringify(results, null, 2));
      }

      console.log(chalk.green(`\n  ✓ Results saved to ${opts.output}\n`));
    } else {
      console.log(
        chalk.dim(`\n  Tip: use -o results.csv to export results\n`)
      );
    }

    process.exit(0);
  });

program.parse();
