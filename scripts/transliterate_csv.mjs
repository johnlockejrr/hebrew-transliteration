import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { transliterate } from "../dist/esm/index.js";
import { tiberian } from "../dist/esm/schemas/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCsvLine(line, delimiter = "|") {
	const cleaned = line.replace(/\r?$/, "");
	return cleaned.split(delimiter);
}

function joinCsvLine(cells, delimiter = "|") {
	return cells
		.map((c) => (c.includes(delimiter) ? `"${c.replace(/"/g, '""')}"` : c))
		.join(delimiter);
}

function findOffendingWord(heb) {
	// Split on whitespace and Hebrew punctuation (maqaf U+05BE) and general punctuation
	const tokens = heb.split(/([\s\u05BE\-\u2010\u2011\u2012\u2013\u2014\u2015]+)/u).filter(Boolean);
	for (const tok of tokens) {
		// Skip pure separators
		if (/^[\s\u05BE\-\u2010-\u2015]+$/.test(tok)) continue;
		try {
			// eslint-disable-next-line no-unused-vars
			const _ = transliterate(tok, tiberian);
		} catch (e) {
			return tok;
		}
	}
	return null;
}

async function promptToContinue(message) {
	return await new Promise((resolve) => {
		const rlPrompt = readline.createInterface({ input: process.stdin, output: process.stdout });
		rlPrompt.question(`${message} Continue? (y/N): `, (answer) => {
			rlPrompt.close();
			const normalized = String(answer || "").trim().toLowerCase();
			resolve(normalized === "y" || normalized === "yes");
		});
	});
}

async function main() {
	const inputPath = process.argv[2] || path.resolve(process.cwd(), "heb_corpus.csv");
	const outputPath = process.argv[3] || path.resolve(process.cwd(), "heb_corpus_tiberian.csv");
	const delimiter = "|";
	const debug = process.argv.includes("--debug");
	const skipErrors = process.argv.includes("--skip-errors");

	if (!fs.existsSync(inputPath)) {
		console.error(`Input file not found: ${inputPath}`);
		process.exit(1);
	}

	const inputStream = fs.createReadStream(inputPath, { encoding: "utf8" });
	const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
	const outputStream = fs.createWriteStream(outputPath, { encoding: "utf8" });

	let headerProcessed = false;
	let vocalizedIdx = -1;
	let headerCells = [];
	let lineNumber = 0; // 1-based physical line count in the CSV

	for await (const rawLine of rl) {
		lineNumber += 1;
		const line = rawLine.replace(/\uFEFF/g, "");
		if (!headerProcessed) {
			headerCells = parseCsvLine(line, delimiter);
			vocalizedIdx = headerCells.indexOf("vocalized");
			if (vocalizedIdx === -1) {
				console.error("Header must include 'vocalized' column");
				process.exit(1);
			}
			outputStream.write(joinCsvLine([...headerCells, "tiberian"], delimiter) + "\n");
			headerProcessed = true;
			continue;
		}

		if (line.trim() === "") continue;

		const cells = parseCsvLine(line, delimiter);
		while (cells.length < headerCells.length) cells.push("");

		const heb = cells[vocalizedIdx];
		let tib = "";
		try {
			tib = heb ? transliterate(heb, tiberian) : "";
		} catch (e) {
			const locationHint = headerCells.slice(0, 3).join("|"); // book|chapter|verse if present in header
			if (debug) {
				const badWord = heb ? findOffendingWord(heb) : null;
				console.error(
					`Transliteration error at CSV line ${lineNumber}${locationHint ? ` (${cells.slice(0, 3).join("|")})` : ""}: ${e.message}`
				);
				if (badWord) {
					console.error(`Offending token: ${badWord}`);
				}
				console.error(`Row excerpt: ${line.slice(0, 200)}${line.length > 200 ? "..." : ""}`);
			} else {
				console.error(
					`Error at CSV line ${lineNumber}${locationHint ? ` (${cells.slice(0, 3).join("|")})` : ""}: ${e.message}`
				);
			}

			if (skipErrors) {
				// Continue processing with empty transliteration for this row
			} else {
				const proceed = await promptToContinue("An error occurred while transliterating this row.");
				if (!proceed) {
					process.exitCode = 1;
					break;
				}
			}
		}

		const out = joinCsvLine([...cells, tib], delimiter) + "\n";
		outputStream.write(out);
	}

	outputStream.end();
	await new Promise((res) => outputStream.on("close", res));
	if (process.exitCode && process.exitCode !== 0) {
		console.error(`Completed with errors. See messages above.`);
	} else {
		console.log(`Wrote: ${outputPath}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
