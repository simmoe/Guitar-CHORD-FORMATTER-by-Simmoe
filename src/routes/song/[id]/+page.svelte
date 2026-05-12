<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import {
		deleteSong,
		getSong,
		subscribeSongs,
		updateSong
	} from '$lib/firebase/songs';
	import {
		uniqueCategoriesFromSongs,
		transposeBassLine,
		normalizeAccidentals,
		decodeHtmlEntities
	} from '$lib/chordFormatter';
	import { parseRows, serializeRows, transposeRows, type Row } from '$lib/songParse';
	import EditableSong from '$lib/components/EditableSong.svelte';
	import SongMetaForm from '$lib/components/SongMetaForm.svelte';
	import { exportSongsAsPdf } from '$lib/pdf';
	import type {
		BassLines,
		CollapsedSections,
		SongDoc
	} from '$lib/types';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	let song = $state<SongDoc | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let title = $state('');
	let artist = $state('');
	let key = $state('');
	let barsPerLine = $state<2 | 4 | 8>(4);
	let categories = $state<string[]>([]);
	let rows = $state<Row[]>([]);
	let bassLines = $state<BassLines>({});
	let collapsedSections = $state<CollapsedSections>([]);

	let allSongs = $state<SongDoc[]>([]);
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => (allSongs = s));
		return () => unsub();
	});
	const knownCategories = $derived(uniqueCategoriesFromSongs(allSongs));

	$effect(() => {
		const id = $page.params.id;
		if (!id || !authState.user) return;
		loading = true;
		loadError = null;
		getSong(id)
			.then((s) => {
				if (!s) {
					loadError = 'Sangen findes ikke (måske slettet).';
					return;
				}
				song = s;
				title = decodeHtmlEntities(s.title);
				artist = decodeHtmlEntities(s.artist ?? '');
				key = decodeHtmlEntities(s.key ?? '');
				barsPerLine = s.barsPerLine;
				categories = [...(s.categories ?? [])];
				rows = [...(s.rows ?? parseRows(s.rawInput ?? ''))];
				bassLines = { ...(s.bassLines ?? {}) };
				collapsedSections = [...(s.collapsedSections ?? [])];
			})
			.catch((err) => (loadError = err instanceof Error ? err.message : 'Ukendt fejl'))
			.finally(() => (loading = false));
	});

	// ───── Auto-save (debounced) ─────────────────────────────────────────
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveError = $state<string | null>(null);
	const DEBOUNCE_MS = 800;

	function scheduleSave() {
		if (!song || !authState.user) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveStatus = 'idle';
		saveTimer = setTimeout(() => void doSave(), DEBOUNCE_MS);
	}

	async function flushPendingSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
			await doSave();
		}
	}

	async function doSave() {
		if (!song || !authState.user) return;
		saveStatus = 'saving';
		saveError = null;
		try {
			// `rows` er kanonisk fra v4; `rawInput` holdes i sync som
			// læsbar fallback og søge-felt.
			const patch: Partial<Omit<SongDoc, 'id' | 'createdAt' | 'createdBy'>> = {
				title: title.trim() || 'Uden titel',
				...(artist.trim() ? { artist: artist.trim() } : {}),
				...(key.trim() ? { key: key.trim() } : {}),
				barsPerLine,
				categories,
				rows,
				rawInput: serializeRows(rows),
				bassLines,
				collapsedSections,
				schemaVersion: 4
			};
			await updateSong(song.id, patch, authState.user.uid);
			song = { ...song, ...patch } as SongDoc;
			saveStatus = 'saved';
			setTimeout(() => {
				if (saveStatus === 'saved') saveStatus = 'idle';
			}, 1500);
		} catch (err) {
			saveStatus = 'error';
			saveError = err instanceof Error ? err.message : 'Ukendt fejl';
		}
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const flushSync = () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
				void doSave();
			}
		};
		window.addEventListener('beforeunload', flushSync);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') flushSync();
		});
		return () => {
			window.removeEventListener('beforeunload', flushSync);
			void flushPendingSave();
		};
	});

	// ───── Field change handlers ─────────────────────────────────────────

	function onMetaChange(next: {
		title: string;
		artist: string;
		key: string;
		barsPerLine: 2 | 4 | 8;
		categories: string[];
	}) {
		title = next.title;
		artist = next.artist;
		key = next.key;
		barsPerLine = next.barsPerLine;
		categories = next.categories;
		scheduleSave();
	}

	function onRowsChange(next: Row[]) {
		rows = next;
		scheduleSave();
	}

	function onBassLinesChange(next: BassLines) {
		bassLines = next;
		scheduleSave();
	}

	function onCollapsedSectionsChange(next: CollapsedSections) {
		collapsedSections = next;
		scheduleSave();
	}

	// ───── Transponering ────────────────────────────────────────────────

	async function transpose(semitones: number) {
		rows = transposeRows(rows, semitones);
		const nextBass: BassLines = {};
		for (const [k, v] of Object.entries(bassLines)) nextBass[k] = transposeBassLine(v, semitones);
		bassLines = nextBass;
		if (key.trim()) key = transposeKeyLabel(key, semitones);
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		await doSave();
	}

	function transposeKeyLabel(k: string, semitones: number): string {
		const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
		const flatToSharp: Record<string, string> = {
			Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#'
		};
		const m = k.match(/^([A-G][#b]?)(.*)$/);
		if (!m) return k;
		const root = flatToSharp[m[1]] ?? m[1];
		const idx = SHARP.indexOf(root);
		if (idx === -1) return k;
		const next = (((idx + semitones) % 12) + 12) % 12;
		return normalizeAccidentals(SHARP[next] + m[2]);
	}

	async function handleDelete() {
		if (!song) return;
		const ok = confirm(`Slet "${song.title}"? Det kan ikke fortrydes.`);
		if (!ok) return;
		await deleteSong(song.id);
		goto('/songbook');
	}

	let withBassTabs = $state(true);

	function handlePrint() {
		const prev = document.title;
		document.title = title.trim() || song?.title || 'Sang';
		window.print();
		const restore = () => {
			document.title = prev;
			window.removeEventListener('afterprint', restore);
		};
		window.addEventListener('afterprint', restore);
	}

	let pdfBusy = $state(false);

	async function handlePdf() {
		if (pdfBusy || !song) return;
		await flushPendingSave();
		pdfBusy = true;
		try {
			const liveSong: SongDoc = {
				...song,
				title: title.trim() || song.title,
				artist: artist.trim() || song.artist,
				key: key.trim() || song.key,
				barsPerLine,
				categories,
				rows,
				rawInput: serializeRows(rows),
				bassLines,
				collapsedSections
			};
			await exportSongsAsPdf([liveSong], {
				filename: title.trim() || song.title || 'Sang',
				withBassTabs
			});
		} catch (err) {
			console.error('PDF-eksport fejlede:', err);
			alert('Kunne ikke generere PDF — se konsollen for detaljer.');
		} finally {
			pdfBusy = false;
		}
	}

	$effect(() => {
		const handler = () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				void doSave();
			}
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});
</script>

<svelte:head>
	<title>{title || song?.title || 'Sang'} · {BAND.name}</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-8">
	<header class="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
		<a href="/songbook" class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
			>← Tilbage til sangbogen</a
		>
		<div class="flex items-center gap-3 text-xs text-[var(--color-ink-faint)]">
			{#if saveStatus === 'saving'}
				<span class="text-[var(--color-ink-faint)]">Gemmer…</span>
			{:else if saveStatus === 'saved'}
				<span class="text-[var(--color-success)]">✓ Gemt</span>
			{:else if saveStatus === 'error'}
				<span class="text-[var(--color-error)]" title={saveError ?? ''}>Fejl ved gem</span>
			{/if}
			{#if authState.profile}
				<span>Logget ind som {authState.profile.displayName}</span>
			{/if}
		</div>
	</header>

	{#if loading}
		<div class="card p-8 text-center text-[var(--color-ink-muted)]">Henter sang…</div>
	{:else if loadError}
		<div class="card p-6">
			<p class="text-[var(--color-error)] font-semibold">Fejl</p>
			<p class="mt-1 text-sm text-[var(--color-ink-muted)]">{loadError}</p>
		</div>
	{:else if song}
		<article class="card song-card p-6 sm:p-7">
			<div class="title-row no-print-toolbar">
				<div class="min-w-0 flex-1">
					<div class="title-line">
						<input
							class="title-input"
							type="text"
							bind:value={title}
							oninput={() => scheduleSave()}
							placeholder="Titel"
						/>
						<span class="key-chip" aria-label="Toneart, transponér">
							<button
								type="button"
								class="key-chip-btn"
								title="Transponér ned"
								onclick={() => transpose(-1)}>−</button
							>
							<input
								class="key-chip-input"
								type="text"
								bind:value={key}
								oninput={() => scheduleSave()}
								placeholder="Toneart"
								spellcheck="false"
							/>
							<button
								type="button"
								class="key-chip-btn"
								title="Transponér op"
								onclick={() => transpose(1)}>+</button
							>
						</span>
					</div>
					<input
						class="artist-input"
						type="text"
						bind:value={artist}
						oninput={() => scheduleSave()}
						placeholder="Kunstner (valgfri)"
					/>
				</div>
				<div class="flex items-center gap-1.5">
					<label class="print-toggle" title="Tag bass-tabs med ved print">
						<input type="checkbox" bind:checked={withBassTabs} />
						Bass tabs
					</label>
					<button
						type="button"
						class="btn-secondary"
						onclick={handlePdf}
						disabled={pdfBusy}
						title="Generér PDF og hent direkte"
					>
						{pdfBusy ? 'Genererer…' : 'PDF'}
					</button>
					<button type="button" class="btn-secondary" onclick={handlePrint}>Print</button>
					<button
						type="button"
						class="btn-secondary !text-[var(--color-error)]"
						onclick={handleDelete}
						title="Slet sang">Slet</button
					>
				</div>
			</div>

			<div class="print-header" aria-hidden="true">
				<div>
					<span class="print-title">{title || 'Uden titel'}</span>
					{#if key.trim()}
						<span class="print-key">· {key.trim()}</span>
					{/if}
				</div>
				{#if artist.trim()}
					<div class="print-artist">{artist.trim()}</div>
				{/if}
			</div>

			<details class="meta-details mb-5">
				<summary class="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
					Toneart, takter, kategorier…
				</summary>
				<div class="mt-3">
					<SongMetaForm
						{title}
						{artist}
						{key}
						{barsPerLine}
						{categories}
						{knownCategories}
						onChange={onMetaChange}
					/>
				</div>
			</details>

			<div class="song-area" class:no-bass-tabs={!withBassTabs}>
				<EditableSong
					{rows}
					{barsPerLine}
					{bassLines}
					{collapsedSections}
					{onRowsChange}
					{onBassLinesChange}
					{onCollapsedSectionsChange}
				/>
			</div>

			<p class="edit-hint mt-3 text-xs italic text-[var(--color-ink-faint)]">
				Klik direkte i teksten for at rette. Klik på akkord-cellen til venstre eller bass-cellen
				til højre for at åbne en modal og redigere linjen i pipe-notation. Ændringer gemmes
				automatisk.
			</p>
		</article>
	{/if}
</main>

<style>
	.song-card {
		container-type: inline-size;
	}
	.print-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--color-ink-muted);
		cursor: pointer;
		user-select: none;
		padding: 0 0.4rem;
		white-space: nowrap;
	}
	.print-toggle input {
		accent-color: var(--color-accent);
	}
	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.title-line {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		min-width: 0;
		flex-wrap: wrap;
	}
	.title-input {
		min-width: 0;
		flex: 1 1 auto;
		background: transparent;
		border: none;
		font-family: var(--font-display);
		font-size: 1.6rem;
		line-height: 1.1;
		font-weight: 700;
		color: var(--color-ink);
		padding: 0.05rem 0.25rem;
		border-radius: 4px;
	}
	.title-input:focus {
		outline: none;
		background: var(--color-accent-soft);
	}
	.key-chip {
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		background: #ffffff;
		font-size: 0.85rem;
		line-height: 1;
		overflow: hidden;
	}
	.key-chip-btn {
		padding: 0.3rem 0.55rem;
		font-weight: 600;
		color: var(--color-ink);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.key-chip-btn:hover {
		background: #f3f4f6;
	}
	.key-chip-input {
		width: 3.2rem;
		text-align: center;
		font-weight: 700;
		font-family: var(--font-mono);
		font-size: 0.85rem;
		color: var(--color-ink);
		background: transparent;
		border: none;
		padding: 0.3rem 0;
		border-left: 1px solid var(--color-border-subtle);
		border-right: 1px solid var(--color-border-subtle);
	}
	.key-chip-input:focus {
		outline: none;
		background: var(--color-accent-soft);
	}
	.artist-input {
		width: 100%;
		background: transparent;
		border: none;
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--color-ink-faint);
		padding: 0.05rem 0.25rem;
		margin-top: 0.1rem;
		border-radius: 4px;
		font-style: italic;
		letter-spacing: 0.01em;
	}
	.artist-input:focus {
		outline: none;
		background: var(--color-bg-card-muted);
		font-style: normal;
	}
	.artist-input::placeholder {
		font-style: italic;
		color: var(--color-ink-faint);
		opacity: 0.6;
	}
	.print-header {
		display: none;
	}
	.meta-details > summary {
		list-style: none;
	}
	.meta-details > summary::-webkit-details-marker {
		display: none;
	}
	.meta-details > summary::marker {
		content: '';
	}
	.meta-details > summary::before {
		content: '▸';
		display: inline-block;
		margin-right: 0.4em;
		transition: transform 120ms ease;
	}
	.meta-details[open] > summary::before {
		transform: rotate(90deg);
	}
	.song-area {
		background: #ffffff;
		border-radius: 0.5rem;
		padding: 1.25rem;
		border: 1px solid var(--color-border-subtle);
	}
</style>
