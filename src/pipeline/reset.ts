/** Daily quota reset instants for a wall-clock time in an IANA time zone. */

const DAY = 86_400_000;

/** Wall-clock time of `ts` in `timeZone`, read as if it were UTC, minus `ts`: the zone's offset at `ts`. */
function offset(ts: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	}).formatToParts(ts);
	const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - ts;
}

/** The instant the zone's local date of `day` (a UTC-midnight timestamp) reads `hours:minutes`. */
function at(day: number, hours: number, minutes: number, timeZone: string): number {
	const wall = day + hours * 3_600_000 + minutes * 60_000;
	const guess = wall - offset(wall, timeZone);
	// Second pass settles the offset on the far side of a DST change.
	return wall - offset(guess, timeZone);
}

export function resetBounds(now: number, time: string, timeZone: string): { previous: number; next: number } {
	const [hours = 0, minutes = 0] = time.split(":").map(Number);
	const localToday = Math.floor((now + offset(now, timeZone)) / DAY) * DAY;
	const today = at(localToday, hours, minutes, timeZone);
	return today <= now
		? { previous: today, next: at(localToday + DAY, hours, minutes, timeZone) }
		: { previous: at(localToday - DAY, hours, minutes, timeZone), next: today };
}
