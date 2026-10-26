import { useEffect, useState } from "react";

export type Route =
	| { screen: "library" }
	| { screen: "settings" }
	| { screen: "costs" }
	| { screen: "translate" }
	| { screen: "book"; id: string; tab: "job" | "review" | "structure" | "glossary" | "details" | "costs"; page: number };

const TABS = ["job", "review", "structure", "glossary", "details", "costs"] as const;

/** Hash routes: `#/`, `#/settings`, `#/costs`, `#/translate`, `#/books/<id>/<tab>[/<page>]`. */
export function parseRoute(hash: string): Route {
	const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
	if (parts[0] === "settings") return { screen: "settings" };
	if (parts[0] === "translate") return { screen: "translate" };
	if (parts[0] === "costs") return { screen: "costs" };
	if (parts[0] === "books" && parts[1] !== undefined) {
		const tab = TABS.find((t) => t === parts[2]) ?? "job";
		const page = Number(parts[3]);
		return { screen: "book", id: parts[1], tab, page: Number.isInteger(page) && page > 0 ? page : 1 };
	}
	return { screen: "library" };
}

export function href(route: Route): string {
	if (route.screen === "settings") return "#/settings";
	if (route.screen === "costs") return "#/costs";
	if (route.screen === "translate") return "#/translate";
	if (route.screen === "book") return `#/books/${route.id}/${route.tab}${route.tab === "review" ? `/${route.page}` : ""}`;
	return "#/";
}

export function useRoute(): Route {
	const [route, setRoute] = useState(() => parseRoute(location.hash));
	useEffect(() => {
		const update = () => setRoute(parseRoute(location.hash));
		addEventListener("hashchange", update);
		return () => removeEventListener("hashchange", update);
	}, []);
	return route;
}

export function go(route: Route) {
	location.hash = href(route);
}
