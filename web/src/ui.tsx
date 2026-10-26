import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
	primary: "bg-primary text-white hover:bg-black",
	secondary: "bg-secondary text-ink hover:bg-[#dadada]",
	ghost: "text-ink hover:bg-raised",
	danger: "text-negative border border-control hover:bg-neg-bg",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
	return (
		<button
			type="button"
			className={`inline-flex h-8 flex-none items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
			{...props}
		/>
	);
}

export type Tone = "positive" | "negative" | "warning" | "neutral" | "data";
const TONES: Record<Tone, string> = {
	positive: "bg-pos-bg text-pos-ink",
	negative: "bg-neg-bg text-neg-ink",
	warning: "bg-warn-bg text-warn-ink",
	neutral: "bg-neutral-bg text-neutral-ink",
	data: "bg-[#e6eefa] text-[#123d7a]",
};

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
	return (
		<span title={title} className={`inline-flex h-5 flex-none items-center rounded-full px-2 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
			{children}
		</span>
	);
}

/** A progress track; the fill carries the screen's one data hue. */
export function Progress({ value, total, label }: { value: number; total: number; label: string }) {
	const ratio = total === 0 ? 0 : value / total;
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={value}
			className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
		>
			{ratio > 0 && <div className="h-full rounded-full bg-data" style={{ width: `${ratio * 100}%` }} />}
		</div>
	);
}

/** Ask before an action that cannot be undone. Opens as a modal; Esc or a click outside cancels. */
export function Confirm({
	open,
	title,
	children,
	action,
	danger = false,
	onConfirm,
	onClose,
}: {
	open: boolean;
	title: string;
	children: ReactNode;
	action: string;
	danger?: boolean;
	onConfirm: () => void;
	onClose: () => void;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	useEffect(() => {
		const dialog = ref.current;
		if (dialog === null) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);
	useEffect(() => {
		const dialog = ref.current;
		// closedby="any" is not in Safari yet: close on a backdrop click by hand there.
		if (dialog === null || "closedBy" in HTMLDialogElement.prototype) return;
		const onClick = (event: MouseEvent) => {
			if (event.target !== dialog) return;
			const r = dialog.getBoundingClientRect();
			const inside = r.top <= event.clientY && event.clientY <= r.bottom && r.left <= event.clientX && event.clientX <= r.right;
			if (!inside) dialog.close();
		};
		dialog.addEventListener("click", onClick);
		return () => dialog.removeEventListener("click", onClick);
	}, []);
	return (
		<dialog
			ref={ref}
			{...{ closedby: "any" }}
			aria-labelledby={titleId}
			onClose={onClose}
			className="m-auto w-[min(440px,calc(100vw-32px))] rounded-lg border border-border bg-surface p-5 text-ink shadow-[0_8px_28px_rgb(0_0_0/0.12)]"
		>
			<h2 id={titleId} className="text-base font-semibold">
				{title}
			</h2>
			<div className="mt-2 text-muted">{children}</div>
			<div className="mt-5 flex justify-end gap-2">
				<Button onClick={onClose}>Cancel</Button>
				<Button
					variant={danger ? "danger" : "primary"}
					onClick={() => {
						onConfirm();
						onClose();
					}}
				>
					{action}
				</Button>
			</div>
		</dialog>
	);
}

/** Current time, ticking every `ms`, for countdowns. */
export function useNow(ms = 1000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(timer);
	}, [ms]);
	return now;
}

/** Run an async action, tracking whether it is busy and its error. */
export function useAction() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}
	return { busy, error, run, clear: () => setError(null) };
}

export function ErrorLine({ children }: { children: ReactNode }) {
	if (children === null || children === undefined || children === "") return null;
	return (
		<p role="alert" className="text-sm text-neg-ink">
			{children}
		</p>
	);
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
	const id = useId();
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			{hint !== undefined && <span className="text-xs text-faint">{hint}</span>}
			{children(id)}
		</div>
	);
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`relative h-5 w-9 flex-none rounded-full transition-colors duration-150 ${checked ? "bg-primary" : "bg-control"}`}
		>
			<span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform duration-150 ${checked ? "translate-x-4" : ""}`} />
		</button>
	);
}

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<section className={`rounded-lg border border-border bg-surface ${className}`}>
			{title !== undefined && (
				<header className="flex min-h-12 items-center justify-between gap-3 border-b border-rule px-5">
					<h2 className="text-base font-semibold">{title}</h2>
					{aside}
				</header>
			)}
			{children}
		</section>
	);
}
