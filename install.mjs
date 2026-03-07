#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "pi-cmux";
const EXTENSION_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-cmux");
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FILES_TO_COPY = ["package.json", "README.md", "CHANGELOG.md"];
const DIRECTORIES_TO_COPY = ["extensions", "skills", "prompts"];

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isHelp = args.includes("--help") || args.includes("-h");

function printHelp() {
	console.log(`\n${PACKAGE_NAME}\n\nWhy:\n  pi-cmux adds cmux-powered terminal integrations to pi, starting with smart workspace notifications.\n\nUsage:\n  npx ${PACKAGE_NAME}          Install or update the extension package\n  npx ${PACKAGE_NAME} --remove Remove the installed extension package\n  npx ${PACKAGE_NAME} --help   Show this help\n`);
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function copyInstall() {
	ensureDir(EXTENSION_DIR);
	for (const file of FILES_TO_COPY) {
		fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(EXTENSION_DIR, file));
	}
	for (const dir of DIRECTORIES_TO_COPY) {
		fs.cpSync(path.join(SOURCE_DIR, dir), path.join(EXTENSION_DIR, dir), { recursive: true });
	}
}

if (isHelp) {
	printHelp();
	process.exit(0);
}

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		fs.rmSync(EXTENSION_DIR, { recursive: true, force: true });
		console.log(`Removed ${EXTENSION_DIR}`);
	} else {
		console.log("Extension package is not installed");
	}
	process.exit(0);
}

copyInstall();
console.log(`Installed to ${EXTENSION_DIR}`);
console.log("Run /reload in pi if it is already running.");
