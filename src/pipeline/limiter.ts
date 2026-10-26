import type { ProviderConfig, Settings } from "../settings.ts";
import type { Store } from "../store.ts";
import { resetBounds } from "./reset.ts";

export type Acquired = { ok: true } | { ok: false; until: number; reason: "rpm" | "rpd" | "concurrency" };

const MINUTE = 60_000;
/** A batch waiting for a concurrency slot checks again after this long. */
const CONCURRENCY_POLL_MS = 3_000;

/**
 * One limiter for every model request of every book. Request times are logged in the store, so per-minute and
 * per-day counts survive a restart; requests in flight are counted in memory per holder (a batch task).
 */
export function createLimiter(store: Store, now: () => number) {
	const inFlight = new Map<number, string>();

	return {
		/** Take a request slot for `holder`, logging the request, or say when to try again. */
		acquire(provider: ProviderConfig, holder: number, reset: Settings["quotaReset"]): Acquired {
			const t = now();
			if (provider.concurrency > 0) {
				let running = 0;
				for (const [h, p] of inFlight) if (p === provider.id && h !== holder) running++;
				if (running >= provider.concurrency) return { ok: false, until: t + CONCURRENCY_POLL_MS, reason: "concurrency" };
			}
			const bounds = resetBounds(t, reset.time, reset.timeZone);
			const today = store.requestsSince(provider.id, bounds.previous);
			if (provider.rpd > 0 && today.length >= provider.rpd) return { ok: false, until: bounds.next, reason: "rpd" };
			if (provider.rpm > 0) {
				const lastMinute = today.filter((at) => at > t - MINUTE);
				const oldest = lastMinute[lastMinute.length - provider.rpm];
				if (oldest !== undefined) return { ok: false, until: oldest + MINUTE, reason: "rpm" };
			}
			store.logRequest(provider.id, t);
			inFlight.set(holder, provider.id);
			return { ok: true };
		},
		/** Count `holder`'s request as in flight again, after a restart resumed it. */
		hold(provider: string, holder: number) {
			inFlight.set(holder, provider);
		},
		release(holder: number) {
			inFlight.delete(holder);
		},
	};
}

export type Limiter = ReturnType<typeof createLimiter>;
