import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CMUX_TIMEOUT_MS = 5000;
const ZOXIDE_TIMEOUT_MS = 5000;
const MAX_COMPLETIONS = 10;
const SPLIT_READY_ATTEMPTS = 20;
const SPLIT_READY_DELAY_MS = 150;
const SURFACE_BOOT_DELAY_MS = 250;

type SplitDirection = "right" | "down";

interface CmuxCallerInfo {
	workspace_ref?: string;
	surface_ref?: string;
}

interface CmuxIdentifyResponse {
	caller?: CmuxCallerInfo;
}

interface CmuxPaneInfo {
	ref?: string;
	selected_surface_ref?: string;
	surface_refs?: string[];
}

interface CmuxListPanesResponse {
	panes?: CmuxPaneInfo[];
}

interface CmuxExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	error?: string;
}

function parseJson<T>(text: string): T | undefined {
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function expandHome(value: string): string {
	if (value === "~") {
		return os.homedir();
	}
	if (value.startsWith("~/")) {
		return path.join(os.homedir(), value.slice(2));
	}
	return value;
}

function resolveDirectoryCandidate(value: string, baseDir: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const expanded = expandHome(trimmed);
	const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
	if (!existsSync(resolved)) {
		return undefined;
	}
	return statSync(resolved).isDirectory() ? resolved : undefined;
}

function buildPiStartupCommand(cwd: string): string {
	return `cd ${shellEscape(cwd)} && exec pi`;
}

function getZoxideMatches(prefix: string): string[] {
	const query = prefix.trim();
	if (!query) {
		return [];
	}
	try {
		const output = execFileSync("zoxide", ["query", "-l", ...query.split(/\s+/)], {
			encoding: "utf8",
			timeout: ZOXIDE_TIMEOUT_MS,
		});
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.slice(0, MAX_COMPLETIONS);
	} catch {
		return [];
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function collectSurfaceRefs(panes: CmuxPaneInfo[]): Set<string> {
	const refs = new Set<string>();
	for (const pane of panes) {
		if (pane.selected_surface_ref) {
			refs.add(pane.selected_surface_ref);
		}
		for (const surfaceRef of pane.surface_refs ?? []) {
			refs.add(surfaceRef);
		}
	}
	return refs;
}

async function execCmux(pi: ExtensionAPI, args: string[]): Promise<CmuxExecResult> {
	const result = await pi.exec("cmux", args, { timeout: CMUX_TIMEOUT_MS });
	if (result.killed) {
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: "cmux command timed out",
		};
	}
	if (result.code !== 0) {
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: result.stderr.trim() || result.stdout.trim() || `cmux exited with code ${result.code}`,
		};
	}
	return {
		ok: true,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

async function getCallerInfo(pi: ExtensionAPI): Promise<{ ok: true; caller: Required<CmuxCallerInfo> } | { ok: false; error: string }> {
	const result = await execCmux(pi, ["--json", "identify"]);
	if (!result.ok) {
		return { ok: false, error: result.error || "Failed to identify cmux caller" };
	}

	const parsed = parseJson<CmuxIdentifyResponse>(result.stdout);
	const workspaceRef = parsed?.caller?.workspace_ref;
	const surfaceRef = parsed?.caller?.surface_ref;
	if (!workspaceRef || !surfaceRef) {
		return { ok: false, error: "This command must be run from inside a cmux surface" };
	}

	return { ok: true, caller: { workspace_ref: workspaceRef, surface_ref: surfaceRef } };
}

async function listPanes(pi: ExtensionAPI, workspaceRef: string): Promise<{ ok: true; panes: CmuxPaneInfo[] } | { ok: false; error: string }> {
	const result = await execCmux(pi, ["--json", "list-panes", "--workspace", workspaceRef]);
	if (!result.ok) {
		return { ok: false, error: result.error || "Failed to list cmux panes" };
	}

	const parsed = parseJson<CmuxListPanesResponse>(result.stdout);
	return { ok: true, panes: parsed?.panes ?? [] };
}

async function waitForNewSurface(pi: ExtensionAPI, workspaceRef: string, previousPanes: CmuxPaneInfo[]): Promise<string | undefined> {
	const previousPaneRefs = new Set(previousPanes.map((pane) => pane.ref).filter((ref): ref is string => Boolean(ref)));
	const previousSurfaceRefs = collectSurfaceRefs(previousPanes);

	for (let attempt = 0; attempt < SPLIT_READY_ATTEMPTS; attempt += 1) {
		const panesResult = await listPanes(pi, workspaceRef);
		if (!panesResult.ok) {
			return undefined;
		}

		for (const pane of panesResult.panes) {
			if (pane.ref && !previousPaneRefs.has(pane.ref)) {
				if (pane.selected_surface_ref) {
					return pane.selected_surface_ref;
				}
				const firstSurfaceRef = pane.surface_refs?.find((ref) => !previousSurfaceRefs.has(ref));
				if (firstSurfaceRef) {
					return firstSurfaceRef;
				}
			}
		}

		for (const pane of panesResult.panes) {
			for (const surfaceRef of pane.surface_refs ?? []) {
				if (!previousSurfaceRefs.has(surfaceRef)) {
					return surfaceRef;
				}
			}
		}

		await delay(SPLIT_READY_DELAY_MS);
	}

	return undefined;
}

async function resolveZoxideTarget(
	pi: ExtensionAPI,
	query: string,
	baseDir: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	const directDirectory = resolveDirectoryCandidate(query, baseDir);
	if (directDirectory) {
		return { ok: true, path: directDirectory };
	}

	const keywords = query.trim().split(/\s+/).filter((part) => part.length > 0);
	if (keywords.length === 0) {
		return { ok: false, error: "Usage: /z <query>" };
	}

	const result = await pi.exec("zoxide", ["query", ...keywords], { timeout: ZOXIDE_TIMEOUT_MS });
	if (result.killed) {
		return { ok: false, error: "zoxide query timed out" };
	}
	if (result.code !== 0) {
		const message = result.stderr.trim() || result.stdout.trim() || "No zoxide match found";
		return { ok: false, error: message };
	}

	const targetPath = result.stdout.trim();
	if (!targetPath) {
		return { ok: false, error: "No zoxide match found" };
	}

	return { ok: true, path: targetPath };
}

async function openPiInZoxideSplit(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	query: string,
	direction: SplitDirection,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const targetResult = await resolveZoxideTarget(pi, query, ctx.cwd);
	if (!targetResult.ok) {
		return targetResult;
	}

	const callerResult = await getCallerInfo(pi);
	if (!callerResult.ok) {
		return callerResult;
	}

	const { workspace_ref: workspaceRef, surface_ref: surfaceRef } = callerResult.caller;
	const beforePanesResult = await listPanes(pi, workspaceRef);
	if (!beforePanesResult.ok) {
		return beforePanesResult;
	}

	const splitResult = await execCmux(pi, [
		"new-split",
		direction,
		"--workspace",
		workspaceRef,
		"--surface",
		surfaceRef,
	]);
	if (!splitResult.ok) {
		return { ok: false, error: splitResult.error || "Failed to create cmux split" };
	}

	const newSurfaceRef = await waitForNewSurface(pi, workspaceRef, beforePanesResult.panes);
	if (!newSurfaceRef) {
		return { ok: false, error: "Created split, but could not find the new cmux surface" };
	}

	await delay(SURFACE_BOOT_DELAY_MS);

	const respawnResult = await execCmux(pi, [
		"respawn-pane",
		"--workspace",
		workspaceRef,
		"--surface",
		newSurfaceRef,
		"--command",
		buildPiStartupCommand(targetResult.path),
	]);
	if (!respawnResult.ok) {
		return { ok: false, error: respawnResult.error || "Failed to start pi in zoxide target split" };
	}

	return { ok: true };
}

function registerZoxideCommand(
	pi: ExtensionAPI,
	name: string,
	direction: SplitDirection,
	description: string,
	successMessage: string,
): void {
	pi.registerCommand(name, {
		description,
		getArgumentCompletions: (prefix) => {
			const matches = getZoxideMatches(prefix);
			return matches.length > 0 ? matches.map((match) => ({ value: match, label: match })) : null;
		},
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify(`Usage: /${name} <query>`, "warning");
				return;
			}

			const result = await openPiInZoxideSplit(pi, ctx, query, direction);
			if (result.ok) {
				ctx.ui.notify(successMessage, "info");
			} else {
				ctx.ui.notify(`zoxide failed: ${result.error}`, "error");
			}
		},
	});
}

export default function cmuxZoxideExtension(pi: ExtensionAPI) {
	registerZoxideCommand(
		pi,
		"z",
		"right",
		"Open a new right split for a zoxide directory match and start pi there",
		"Opened a new zoxide split to the right",
	);

	registerZoxideCommand(
		pi,
		"zh",
		"down",
		"Open a new lower split for a zoxide directory match and start pi there",
		"Opened a new zoxide split below",
	);
}
