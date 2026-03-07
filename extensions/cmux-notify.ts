import type { ExtensionAPI, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import {
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isReadToolResult,
	isWriteToolResult,
} from "@mariozechner/pi-coding-agent";
import { basename } from "node:path";

const DEFAULT_THRESHOLD_MS = 15000;
const DEFAULT_DEBOUNCE_MS = 3000;
const NOTIFY_TIMEOUT_MS = 5000;

interface RunState {
	startedAt: number;
	readFiles: Set<string>;
	changedFiles: Set<string>;
	searchCount: number;
	bashCount: number;
	firstError: string | undefined;
}

function getNumberFromEnv(name: string, fallback: number): number {
	const value = process.env[name];
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
	return count === 1 ? singular : plural;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(1, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	if (seconds === 0) return `${minutes}m`;
	return `${minutes}m ${seconds}s`;
}

function getPathFromInput(event: ToolResultEvent): string | undefined {
	const path = event.input.path;
	return typeof path === "string" && path.length > 0 ? path : undefined;
}

function getFirstText(event: ToolResultEvent): string | undefined {
	const textPart = event.content.find((part) => part.type === "text");
	if (!textPart || textPart.type !== "text") return undefined;
	const text = textPart.text.trim();
	return text.length > 0 ? text : undefined;
}

function summarizeError(event: ToolResultEvent): string {
	const path = getPathFromInput(event);
	if (path) {
		return `${event.toolName} failed for ${basename(path)}`;
	}
	if (isBashToolResult(event)) {
		return "bash command failed";
	}
	const text = getFirstText(event);
	if (!text) {
		return `${event.toolName} failed`;
	}
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function summarizeSuccess(state: RunState, durationMs: number, thresholdMs: number): string {
	const changedCount = state.changedFiles.size;
	if (changedCount === 1) {
		const [file] = [...state.changedFiles];
		const summary = `Updated ${basename(file)}`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}
	if (changedCount > 1) {
		const summary = `Updated ${changedCount} ${pluralize(changedCount, "file")}`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}

	const readCount = state.readFiles.size;
	if (readCount === 1) {
		const [file] = [...state.readFiles];
		const summary = `Reviewed ${basename(file)}`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}
	if (readCount > 1) {
		const summary = `Reviewed ${readCount} ${pluralize(readCount, "file")}`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}

	if (state.searchCount > 0 && state.bashCount > 0) {
		const summary = `Ran ${state.searchCount} ${pluralize(state.searchCount, "search")} and ${state.bashCount} ${pluralize(state.bashCount, "shell command")}`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}
	if (state.searchCount > 0) {
		const summary = state.searchCount === 1 ? "Searched the codebase" : `Ran ${state.searchCount} searches`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}
	if (state.bashCount > 0) {
		const summary = `Ran ${state.bashCount} ${pluralize(state.bashCount, "shell command")}`;
		return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
	}
	return durationMs >= thresholdMs
		? `Finished in ${formatDuration(durationMs)}`
		: "Finished and waiting for input";
}

function buildSubtitle(state: RunState, durationMs: number, thresholdMs: number): string {
	if (state.firstError) return "Error";
	if (state.changedFiles.size > 0 || durationMs >= thresholdMs) return "Task Complete";
	return "Waiting";
}

function createEmptyRunState(): RunState {
	return {
		startedAt: Date.now(),
		readFiles: new Set<string>(),
		changedFiles: new Set<string>(),
		searchCount: 0,
		bashCount: 0,
		firstError: undefined,
	};
}

export default function cmuxNotifyExtension(pi: ExtensionAPI) {
	const thresholdMs = getNumberFromEnv("PI_CMUX_NOTIFY_THRESHOLD_MS", DEFAULT_THRESHOLD_MS);
	const debounceMs = getNumberFromEnv("PI_CMUX_NOTIFY_DEBOUNCE_MS", DEFAULT_DEBOUNCE_MS);
	const title = process.env.PI_CMUX_NOTIFY_TITLE || "Pi";

	let runState = createEmptyRunState();
	let lastNotificationAt = 0;
	let lastNotificationKey = "";
	let cmuxUnavailable = false;

	const sendNotification = async (subtitle: string, body: string): Promise<{ ok: boolean; error?: string }> => {
		if (cmuxUnavailable) {
			return { ok: false, error: "cmux notify is unavailable" };
		}

		const notificationKey = `${subtitle}\n${body}`;
		const now = Date.now();
		if (notificationKey === lastNotificationKey && now - lastNotificationAt < debounceMs) {
			return { ok: true };
		}

		const args = ["notify", "--title", title, "--subtitle", subtitle, "--body", body];
		const result = await pi.exec("cmux", args, { timeout: NOTIFY_TIMEOUT_MS });
		if (result.killed) {
			return { ok: false, error: "cmux notify timed out" };
		}
		if (result.code !== 0) {
			const error = result.stderr.trim() || result.stdout.trim() || `cmux exited with code ${result.code}`;
			if (error.includes("not found") || error.includes("ENOENT")) {
				cmuxUnavailable = true;
			}
			return { ok: false, error };
		}

		lastNotificationAt = now;
		lastNotificationKey = notificationKey;
		return { ok: true };
	};

	pi.on("agent_start", async () => {
		runState = createEmptyRunState();
	});

	pi.on("tool_result", async (event) => {
		if (event.isError && !runState.firstError) {
			runState.firstError = summarizeError(event);
		}

		if (isReadToolResult(event)) {
			const path = getPathFromInput(event);
			if (path) runState.readFiles.add(path);
			return;
		}

		if (isEditToolResult(event) || isWriteToolResult(event)) {
			const path = getPathFromInput(event);
			if (path && !event.isError) runState.changedFiles.add(path);
			return;
		}

		if (isGrepToolResult(event) || isFindToolResult(event)) {
			if (!event.isError) runState.searchCount += 1;
			return;
		}

		if (isBashToolResult(event) && !event.isError) {
			runState.bashCount += 1;
		}
	});

	pi.on("agent_end", async () => {
		const durationMs = Date.now() - runState.startedAt;
		const subtitle = buildSubtitle(runState, durationMs, thresholdMs);
		const body = runState.firstError || summarizeSuccess(runState, durationMs, thresholdMs);
		await sendNotification(subtitle, body);
	});

}
