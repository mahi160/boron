import { type ReactNode, useState } from "react";
import { BookScreen } from "./screens/book.tsx";
import { CostsScreen } from "./screens/costs.tsx";
import { Library } from "./screens/library.tsx";
import { SettingsScreen } from "./screens/settings.tsx";
import { href, type Route, useRoute } from "./router.ts";

function NavItem({ to, active, icon, children }: { to: Route; active: boolean; icon: ReactNode; children: ReactNode }) {
	return (
		<a
			href={href(to)}
			aria-current={active ? "page" : undefined}
			className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150 ${active ? "bg-active text-ink" : "text-muted hover:bg-raised hover:text-ink"}`}
		>
			<span aria-hidden className="size-4 text-current">
				{icon}
			</span>
			{children}
		</a>
	);
}

const icon = (d: string) => (
	<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-4">
		<path d={d} />
	</svg>
);
const BOOKS = icon("M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h7.5");
const COINS = icon("M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM10 5.5H7a1.25 1.25 0 0 0 0 2.5h2a1.25 1.25 0 0 1 0 2.5H6M8 4v1.5M8 10.5V12");
const GEAR = icon("M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4");

export function App() {
	const route = useRoute();
	const [menu, setMenu] = useState(false);
	const nav = (
		<nav aria-label="Main" className="flex flex-col gap-0.5">
			<NavItem to={{ screen: "library" }} active={route.screen === "library" || route.screen === "book"} icon={BOOKS}>
				Library
			</NavItem>
			<NavItem to={{ screen: "costs" }} active={route.screen === "costs"} icon={COINS}>
				Costs
			</NavItem>
			<NavItem to={{ screen: "settings" }} active={route.screen === "settings"} icon={GEAR}>
				Settings
			</NavItem>
		</nav>
	);
	return (
		// Sidebar 232px + canvas; the canvas is fluid with a 32px gutter and one 16px gap.
		<div className="min-h-svh md:grid md:grid-cols-[232px_minmax(0,1fr)]">
			<aside className="hidden border-r border-border px-3 py-4 md:sticky md:top-0 md:flex md:h-svh md:flex-col md:gap-6">
				<Brand />
				{nav}
			</aside>
			<header className="flex h-12 items-center justify-between border-b border-border px-4 md:hidden">
				<Brand />
				<button type="button" aria-expanded={menu} aria-controls="mobile-nav" onClick={() => setMenu(!menu)} className="rounded-md px-2 py-1 text-sm hover:bg-raised">
					Menu
				</button>
			</header>
			{menu && (
				<div id="mobile-nav" className="border-b border-border p-3 md:hidden" onClick={() => setMenu(false)}>
					{nav}
				</div>
			)}
			<main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
				{route.screen === "library" && <Library />}
				{route.screen === "settings" && <SettingsScreen />}
				{route.screen === "costs" && <CostsScreen />}
				{route.screen === "book" && <BookScreen key={route.id} route={route} />}
			</main>
		</div>
	);
}

function Brand() {
	return (
		<a href="#/" className="flex items-center gap-2 px-2.5">
			<span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary font-bangla text-[13px] text-white">
				ব
			</span>
			<span className="text-[15px] font-semibold">Boron</span>
		</a>
	);
}
