import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import type { Figure } from "./api.ts";

type Box = Figure["bbox"]; // [ymin, xmin, ymax, xmax], 0–1000 of the page
type Grip = "move" | "nw" | "ne" | "sw" | "se";

const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
const MIN = 20;

/** Apply a pointer delta (in 0–1000 page units) to one grip of a box. */
function moved(box: Box, grip: Grip, dy: number, dx: number): Box {
	let [y0, x0, y1, x1] = box;
	if (grip === "move") {
		const ty = Math.max(-y0, Math.min(1000 - y1, dy));
		const tx = Math.max(-x0, Math.min(1000 - x1, dx));
		return [clamp(y0 + ty), clamp(x0 + tx), clamp(y1 + ty), clamp(x1 + tx)];
	}
	if (grip.includes("n")) y0 = Math.min(clamp(y0 + dy), y1 - MIN);
	if (grip.includes("s")) y1 = Math.max(clamp(y1 + dy), y0 + MIN);
	if (grip.includes("w")) x0 = Math.min(clamp(x0 + dx), x1 - MIN);
	if (grip.includes("e")) x1 = Math.max(clamp(x1 + dx), x0 + MIN);
	return [y0, x0, y1, x1];
}

/**
 * The page image with its illustration boxes drawn on top. With `onChange`, boxes can be moved and resized
 * with the pointer, or with the arrow keys (Shift resizes) when a box has focus.
 */
export function PageWithBoxes({
	src,
	alt,
	figures,
	selected,
	onSelect,
	onChange,
}: {
	src: string;
	alt: string;
	figures: Figure[];
	selected: number | null;
	onSelect: (index: number | null) => void;
	onChange?: (index: number, box: Box) => void;
}) {
	const frame = useRef<HTMLDivElement>(null);
	const drag = useRef<{ index: number; grip: Grip; x: number; y: number; box: Box } | null>(null);

	function start(event: ReactPointerEvent, index: number, grip: Grip) {
		if (event.button !== 0 || onChange === undefined) return;
		event.stopPropagation();
		const figure = figures[index];
		if (figure === undefined) return;
		onSelect(index);
		drag.current = { index, grip, x: event.clientX, y: event.clientY, box: figure.bbox };
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	}
	function move(event: ReactPointerEvent) {
		const d = drag.current;
		const rect = frame.current?.getBoundingClientRect();
		if (d === null || rect === undefined || !(event.currentTarget as Element).hasPointerCapture(event.pointerId)) return;
		const dy = ((event.clientY - d.y) / rect.height) * 1000;
		const dx = ((event.clientX - d.x) / rect.width) * 1000;
		onChange?.(d.index, moved(d.box, d.grip, dy, dx));
	}
	const end = () => {
		drag.current = null;
	};

	return (
		<div ref={frame} className="relative w-full select-none" onPointerDown={() => onSelect(null)}>
			<img src={src} alt={alt} className="block w-full rounded-sm border border-border" draggable={false} />
			{figures.map((figure, index) => {
				const [y0, x0, y1, x1] = figure.bbox;
				const active = selected === index;
				return (
					<div
						// Boxes have no id of their own: the index is the figure's identity on the page (as in `figure:N`).
						key={index}
						role={onChange ? "button" : undefined}
						tabIndex={onChange ? 0 : undefined}
						aria-label={`Illustration ${index + 1}${figure.caption ? `: ${figure.caption}` : ""}. Arrow keys move it; Shift and arrow keys resize it.`}
						onPointerDown={(e) => start(e, index, "move")}
						onPointerMove={move}
						onLostPointerCapture={end}
						onFocus={() => onSelect(index)}
						onKeyDown={(e) => {
							const step = { ArrowUp: [-10, 0], ArrowDown: [10, 0], ArrowLeft: [0, -10], ArrowRight: [0, 10] }[e.key];
							if (step === undefined || onChange === undefined) return;
							e.preventDefault();
							onChange(index, moved(figure.bbox, e.shiftKey ? "se" : "move", step[0] ?? 0, step[1] ?? 0));
						}}
						className={`absolute border-2 ${onChange ? "drag-handle" : ""} ${active ? "border-data bg-data/10" : "border-data/70"}`}
						style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
					>
						<span className="absolute -top-5 left-[-2px] rounded-t-sm bg-data px-1.5 text-[11px] leading-5 text-white">{index + 1}</span>
						{active &&
							onChange &&
							(["nw", "ne", "sw", "se"] as const).map((grip) => (
								<span
									key={grip}
									aria-hidden
									onPointerDown={(e) => start(e, index, grip)}
									onPointerMove={move}
									onLostPointerCapture={end}
									className={`absolute size-3 rounded-[2px] border-2 border-data bg-white ${grip.includes("n") ? "-top-1.5" : "-bottom-1.5"} ${grip.includes("w") ? "-left-1.5" : "-right-1.5"} ${grip === "nw" || grip === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"}`}
								/>
							))}
					</div>
				);
			})}
		</div>
	);
}
