import { type ReactNode, useState } from "react";
import { api, type ProviderConfig, type ProviderTestResult, type Settings, useLive } from "../api.ts";
import { Button, ErrorLine, Field, Toggle, useAction } from "../ui.tsx";

type Stage = keyof Settings["stages"];
const STAGES: { id: Stage; label: string; hint: string }[] = [
	{ id: "ocr", label: "OCR", hint: "Reads each page image into text." },
	{ id: "proofread", label: "Proofread", hint: "Fixes OCR mistakes against the image, keeping the author's spelling." },
	{ id: "assemble", label: "Title page", hint: "Fills in title, author and publisher from the first pages." },
];

const PRESETS: { label: string; make: () => Omit<ProviderConfig, "id"> }[] = [
	{
		label: "Gemini",
		make: () => ({ name: "Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "", model: "gemini-3.5-flash", rpm: 10, rpd: 250, concurrency: 2 }),
	},
	{
		label: "OpenAI-compatible",
		make: () => ({ name: "OpenAI-compatible", kind: "openai", baseUrl: "https://", apiKey: "", model: "", rpm: 0, rpd: 0, concurrency: 2 }),
	},
	{
		label: "Ollama",
		make: () => ({ name: "Ollama", kind: "openai", baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen2.5vl", rpm: 0, rpd: 0, concurrency: 1 }),
	},
];

function newId(name: string, taken: string[]): string {
	const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "provider";
	let id = base;
	for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
	return id;
}

export function SettingsScreen() {
	const { data, error } = useLive<Settings>("/settings", "settings");
	if (data === undefined) {
		return (
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold">Settings</h1>
				{error === null ? <p className="text-faint">Loading…</p> : <ErrorLine>{error}</ErrorLine>}
			</div>
		);
	}
	return <SettingsForm initial={data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
	const [saved, setSaved] = useState(initial);
	const [s, setS] = useState(initial);
	const save = useAction();
	const dirty = JSON.stringify(s) !== JSON.stringify(saved);
	const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS({ ...s, [key]: value });

	function setProvider(index: number, next: ProviderConfig) {
		set("providers", s.providers.map((p, i) => (i === index ? next : p)));
	}
	function removeProvider(id: string) {
		setS({
			...s,
			providers: s.providers.filter((p) => p.id !== id),
			stages: { ocr: s.stages.ocr.filter((x) => x !== id), proofread: s.stages.proofread.filter((x) => x !== id), assemble: s.stages.assemble.filter((x) => x !== id) },
		});
	}
	function addProvider(preset: (typeof PRESETS)[number]) {
		const p = preset.make();
		const id = newId(p.name, s.providers.map((x) => x.id));
		setS({
			...s,
			providers: [...s.providers, { ...p, id }],
			stages: { ocr: [...s.stages.ocr, id], proofread: [...s.stages.proofread, id], assemble: [...s.stages.assemble, id] },
		});
	}

	return (
		<form
			className="flex max-w-[1180px] flex-col gap-8 pb-20"
			onSubmit={(e) => {
				e.preventDefault();
				void save.run(async () => {
					const next = await api.put<Settings>("/settings", s);
					setSaved(next);
					setS(next);
				});
			}}
		>
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
				<p className="mt-1 text-muted">
					{s.providers.length === 0
						? "No AI provider yet: books are read with Tesseract only. Add a provider for proofread-quality text."
						: `${s.providers.length} ${s.providers.length === 1 ? "provider" : "providers"} · ${s.pagesPerRequest} pages per request · changes apply to the next request`}
				</p>
			</div>

			<Section title="Providers" description="Where pages are sent. Keys are stored on this server and only their last four characters are shown again.">
				<div className="flex flex-col gap-3">
					{s.providers.map((p, i) => (
						<ProviderCard key={p.id} provider={p} onChange={(next) => setProvider(i, next)} onRemove={() => removeProvider(p.id)} />
					))}
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-muted">Add</span>
						{PRESETS.map((preset) => (
							<Button key={preset.label} onClick={() => addProvider(preset)}>
								{preset.label}
							</Button>
						))}
					</div>
				</div>
			</Section>

			<Section title="Order per stage" description="Each request uses the first provider in the list that has quota left; the next one takes over when it runs out.">
				<div className="grid gap-3 md:grid-cols-3">
					{STAGES.map((stage) => (
						<StageList
							key={stage.id}
							label={stage.label}
							hint={stage.hint}
							providers={s.providers}
							order={s.stages[stage.id]}
							onChange={(order) => set("stages", { ...s.stages, [stage.id]: order })}
						/>
					))}
				</div>
			</Section>

			<Section title="Reading" description="How pages are prepared and what the pipeline does with them.">
				<div className="grid gap-4 sm:grid-cols-2">
					<NumberField label="Pages per request" hint="1–10. More pages per request uses fewer requests." min={1} max={10} value={s.pagesPerRequest} onChange={(v) => set("pagesPerRequest", v)} />
					<NumberField label="Image size (px, longest side)" hint="800–4000" min={800} max={4000} value={s.imageMaxSide} onChange={(v) => set("imageMaxSide", v)} />
					<NumberField label="JPEG quality" hint="40–100" min={40} max={100} value={s.jpegQuality} onChange={(v) => set("jpegQuality", v)} />
					<NumberField label="Chapter list depth" hint="Heading levels shown in the EPUB's table of contents, 1–6." min={1} max={6} value={s.tocDepth} onChange={(v) => set("tocDepth", v)} />
				</div>
				<div className="mt-5 flex flex-col divide-y divide-rule rounded-lg border border-border bg-surface">
					<SwitchRow label="Proofread" description="A second pass corrects OCR errors against the image." checked={s.proofread} onChange={(v) => set("proofread", v)} />
					<SwitchRow label="Illustrations" description="Find pictures on each page and put them in the EPUB." checked={s.figures} onChange={(v) => set("figures", v)} />
					<SwitchRow label="Clean scans" description="Whiten faint watermarks, show-through and paper tone in the images sent for reading. The stored scans and illustrations keep their colour." checked={s.cleanScans} onChange={(v) => set("cleanScans", v)} />
					<SwitchRow label="Tesseract when out of quota" description="Read pages offline instead of waiting for the quota to reset. Lower quality; such pages are marked to check." checked={s.tesseractFallback} onChange={(v) => set("tesseractFallback", v)} />
				</div>
			</Section>

			<Section title="Daily quota reset" description="When providers' daily limits start again. Gemini resets at midnight Pacific time.">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Time">
						{(id) => <input id={id} type="time" required value={s.quotaReset.time} onChange={(e) => set("quotaReset", { ...s.quotaReset, time: e.target.value })} />}
					</Field>
					<Field label="Time zone" hint="IANA name, e.g. America/Los_Angeles">
						{(id) => <input id={id} required value={s.quotaReset.timeZone} onChange={(e) => set("quotaReset", { ...s.quotaReset, timeZone: e.target.value })} />}
					</Field>
				</div>
			</Section>

			<Section title="Prompts" description="Instructions sent with every request. The answer format is added by Boron and cannot be changed here.">
				<div className="flex flex-col gap-4">
					{(["ocr", "proofread", "metadata"] as const).map((key) => (
						<Field key={key} label={key === "ocr" ? "OCR" : key === "proofread" ? "Proofread" : "Title page"}>
							{(id) => (
								<textarea id={id} rows={6} value={s.prompts[key]} onChange={(e) => set("prompts", { ...s.prompts, [key]: e.target.value })} className="font-mono text-[13px] leading-5" />
							)}
						</Field>
					))}
				</div>
			</Section>

			<div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 backdrop-blur md:left-[232px]">
				<div className="flex max-w-[1180px] items-center justify-end gap-3 px-4 py-3 md:px-8">
					<ErrorLine>{save.error}</ErrorLine>
					{!dirty && !save.busy && save.error === null && <span className="text-xs text-faint">All changes saved</span>}
					{dirty && <Button onClick={() => setS(saved)}>Discard</Button>}
					<Button type="submit" variant="primary" disabled={!dirty || save.busy}>
						{save.busy ? "Saving…" : "Save settings"}
					</Button>
				</div>
			</div>
		</form>
	);
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
	return (
		<section className="grid gap-4 border-t border-border pt-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
			<div>
				<h2 className="text-base font-medium">{title}</h2>
				<p className="mt-1 text-muted">{description}</p>
			</div>
			<div className="min-w-0">{children}</div>
		</section>
	);
}

function NumberField({ label, hint, min, max, value, onChange }: { label: string; hint: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
	return (
		<Field label={label} hint={hint}>
			{(id) => <input id={id} type="number" required min={min} max={max} step={1} value={value} onChange={(e) => onChange(e.target.valueAsNumber)} className="tabular-nums" />}
		</Field>
	);
}

function SwitchRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex items-center justify-between gap-4 px-4 py-3">
			<div>
				<p className="font-medium">{label}</p>
				<p className="text-muted">{description}</p>
			</div>
			<Toggle label={label} checked={checked} onChange={onChange} />
		</div>
	);
}

function ProviderCard({ provider: p, onChange, onRemove }: { provider: ProviderConfig; onChange: (p: ProviderConfig) => void; onRemove: () => void }) {
	const test = useAction();
	const [result, setResult] = useState<ProviderTestResult | null>(null);
	const field = <K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) => {
		setResult(null);
		onChange({ ...p, [key]: value });
	};
	const limit = (key: "rpm" | "rpd" | "concurrency", label: string, hint: string) => (
		<Field label={label} hint={hint}>
			{(id) => <input id={id} type="number" min={0} step={1} required value={p[key]} onChange={(e) => field(key, e.target.valueAsNumber)} className="tabular-nums" />}
		</Field>
	);
	return (
		<div className="rounded-lg border border-border bg-surface">
			<div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
				<input aria-label="Provider name" value={p.name} onChange={(e) => field("name", e.target.value)} className="h-8 border-transparent px-1 font-medium hover:border-border" />
				<span className="text-xs text-faint">{p.kind === "gemini" ? "Gemini API" : "OpenAI-compatible"}</span>
			</div>
			<div className="grid gap-4 p-4 sm:grid-cols-2">
				<Field label="Base URL">{(id) => <input id={id} type="url" required value={p.baseUrl} onChange={(e) => field("baseUrl", e.target.value)} />}</Field>
				<Field label="Model">{(id) => <input id={id} required value={p.model} onChange={(e) => field("model", e.target.value)} />}</Field>
				<Field label="API key" hint={p.kind === "openai" ? "Leave empty for a local server." : undefined}>
					{(id) => <input id={id} type={p.apiKey.startsWith("\u2022") ? "text" : "password"} autoComplete="off" value={p.apiKey} onChange={(e) => field("apiKey", e.target.value)} />}
				</Field>
				<div className="grid grid-cols-3 gap-3">
					{limit("rpm", "Per minute", "0 = no limit")}
					{limit("rpd", "Per day", "0 = no limit")}
					{limit("concurrency", "At once", "0 = no limit")}
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-2.5">
				<div className="min-w-0 flex-1 text-sm">
					{test.error !== null && <ErrorLine>{test.error}</ErrorLine>}
					{result?.ok === true && (
						<p className="text-pos-ink">
							Works ({(result.ms / 1000).toFixed(1)} s): <span className="bangla text-ink">{result.text.slice(0, 120)}</span>
						</p>
					)}
					{result?.ok === false && <p className="break-words text-neg-ink">{result.error.slice(0, 400)}</p>}
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onRemove}>
						Remove
					</Button>
					<Button
						disabled={test.busy}
						onClick={() =>
							test.run(async () => {
								setResult(null);
								setResult(await api.post<ProviderTestResult>("/providers/test", { provider: p }));
							})
						}
					>
						{test.busy ? "Testing…" : "Test with a sample page"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function StageList({ label, hint, providers, order, onChange }: { label: string; hint: string; providers: ProviderConfig[]; order: string[]; onChange: (order: string[]) => void }) {
	const unused = providers.filter((p) => !order.includes(p.id));
	const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
	const swap = (i: number, j: number) => {
		const next = [...order];
		[next[i], next[j]] = [next[j] ?? "", next[i] ?? ""];
		onChange(next);
	};
	return (
		<div className="rounded-lg border border-border bg-surface">
			<div className="border-b border-rule px-4 py-2.5">
				<p className="font-medium">{label}</p>
				<p className="text-xs text-faint">{hint}</p>
			</div>
			<ol className="p-1.5">
				{order.length === 0 && <li className="px-2.5 py-2 text-faint">{label === "OCR" ? "Tesseract only" : "Skipped"}</li>}
				{order.map((id, i) => (
					<li key={id} className="flex h-9 items-center gap-1 rounded-md px-2.5 hover:bg-raised">
						<span className="w-5 text-xs text-faint tabular-nums">{i + 1}</span>
						<span className="min-w-0 flex-1 truncate">{name(id)}</span>
						<IconButton label={`Move ${name(id)} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}>
							↑
						</IconButton>
						<IconButton label={`Move ${name(id)} down`} disabled={i === order.length - 1} onClick={() => swap(i, i + 1)}>
							↓
						</IconButton>
						<IconButton label={`Remove ${name(id)} from ${label}`} onClick={() => onChange(order.filter((x) => x !== id))}>
							×
						</IconButton>
					</li>
				))}
			</ol>
			{unused.length > 0 && (
				<div className="flex flex-wrap gap-1.5 border-t border-rule px-4 py-2.5">
					{unused.map((p) => (
						<button key={p.id} type="button" onClick={() => onChange([...order, p.id])} className="rounded-full border border-control px-2.5 py-0.5 text-xs hover:bg-raised">
							+ {p.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function IconButton({ label, children, ...props }: { label: string; children: ReactNode; disabled?: boolean; onClick: () => void }) {
	return (
		<button type="button" aria-label={label} title={label} className="grid size-7 place-items-center rounded-md text-muted hover:bg-active hover:text-ink disabled:opacity-30" {...props}>
			{children}
		</button>
	);
}
