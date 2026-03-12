const fs = require("fs");
const path = require("path");

const targetPath = path.join(
    __dirname,
    "node_modules",
    "popular-english-words",
    "words.js"
);

function getOutputPath() {
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex === -1) return null;

    const value = process.argv[outputIndex + 1];
    if (!value) {
        throw new Error("Missing file path after --output");
    }

    return path.resolve(__dirname, value);
}

function parseWordsFile(source) {
    const start = source.indexOf("[");
    const end = source.lastIndexOf("]");

    if (start === -1 || end === -1 || end <= start) {
        throw new Error("Could not find word array in words.js");
    }

    return {
        before: source.slice(0, start),
        words: Function(`return ${source.slice(start, end + 1)}`)(),
        after: source.slice(end + 1),
    };
}

function dedupeWords(words) {
    const seen = new Set();
    const unique = [];

    for (const word of words) {
        if (seen.has(word)) {
            continue;
        }

        seen.add(word);
        unique.push(word);
    }

    return unique;
}

function formatWordsFile(before, words, after) {
    const body = words.map((word) => `    ${JSON.stringify(word)}`).join(",\n");
    return `${before}\n${body}\n]${after}`;
}

function main() {
    const source = fs.readFileSync(targetPath, "utf8");
    const { before, words, after } = parseWordsFile(source);
    const uniqueWords = dedupeWords(words);
    const duplicateCount = words.length - uniqueWords.length;
    const outputPath = getOutputPath();

    if (outputPath) {
        const exported = formatWordsFile(before, uniqueWords, after);
        fs.writeFileSync(outputPath, exported, "utf8");
        console.log(`Wrote ${uniqueWords.length} distinct words to ${outputPath}`);
        return;
    }

    if (duplicateCount === 0) {
        console.log(`No duplicate words found in ${targetPath}`);
        return;
    }

    const updated = formatWordsFile(before, uniqueWords, after);
    fs.writeFileSync(targetPath, updated, "utf8");

    console.log(`Removed ${duplicateCount} duplicate entries from ${targetPath}`);
    console.log(`Total words: ${words.length} -> ${uniqueWords.length}`);
}

main();