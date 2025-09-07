import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { transliterate } from "../dist/esm/index.js";
import { tiberian } from "../dist/esm/schemas/index.js";

// Simple CSV parser/writer for pipe-delimited CSV in this repo (header shows '|')

function parseCsvLine(line: string, delimiter = "|"): string[] {
	// Handle simple cases without quotes; corpus appears simple. Trim trailing CR.
	const cleaned = line.replace(/\r?$/, "");
	return cleaned.split(delimiter);
}

function joinCsvLine(cells: string[], delimiter = "|"): string {
	return cells
		.map((c) => (c.includes(delimiter) ? `"${c.replace(/"/g, '""')}"` : c))
		.join(delimiter);
}

async function main() {
	const inputPath = process.argv[2] || path.resolve(process.cwd(), "heb_corpus.csv");
	const outputPath = process.argv[3] || path.resolve(process.cwd(), "heb_corpus_tiberian.csv");
	const delimiter = "|";

	if (!fs.existsSync(inputPath)) {
		console.error(`Input file not found: ${inputPath}`);
		process.exit(1);
	}

	const inputStream = fs.createReadStream(inputPath, { encoding: "utf8" });
	const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

	const outputStream = fs.createWriteStream(outputPath, { encoding: "utf8" });

	let headerProcessed = false;
	let vocalizedIdx = -1;
	let headerCells: string[] = [];

	for await (const rawLine of rl) {
		const line = rawLine.replace(/\uFEFF/g, ""); // strip BOM if present
		if (!headerProcessed) {
			headerCells = parseCsvLine(line, delimiter);
			vocalizedIdx = headerCells.indexOf("vocalized");
			if (vocalizedIdx === -1) {
				console.error("Header must include 'vocalized' column");
				process.exit(1);
			}
			const outHeader = [...headerCells, "tiberian"];
			outputStream.write(joinCsvLine(outHeader, delimiter) + "\n");
			headerProcessed = true;
			continue;
		}

		if (line.trim() === "") {
			continue;
		}

		const cells = parseCsvLine(line, delimiter);
		// Ensure row has at least columns found in header
		while (cells.length < headerCells.length) cells.push("");

		const heb = cells[vocalizedIdx];
		const tib = heb ? transliterate(heb, tiberian) : "";
		const outRow = [...cells, tib];
		outputStream.write(joinCsvLine(outRow, delimiter) + "\n");
	}

	outputStream.end();
	await new Promise((res) => outputStream.on("close", res));
	console.log(`Wrote: ${outputPath}`);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
