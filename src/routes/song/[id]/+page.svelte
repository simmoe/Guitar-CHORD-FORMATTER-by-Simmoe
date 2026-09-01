<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import {
		deleteSong,
		getSong,
		saveCategoryColors,
		subscribeCategoryColors,
		subscribeCategoryMeta,
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
	import { regroupBassLine } from '$lib/migrate';
	import EditableSong from '$lib/components/EditableSong.svelte';
	import SongMetaForm from '$lib/components/SongMetaForm.svelte';
	import { exportAudienceSongbookAsPdf, exportSongsAsPdf } from '$lib/pdf';
	import { assignMissingCategoryColors, hasSameCategoryColors } from '$lib/categoryColors';
	import { tick } from 'svelte';
	import type {
		BassLines,
		CategoryColorMap,
		CategoryMetaMap,
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
	let categoryColorMap = $state<CategoryColorMap>({});
	let categoryMetaMap = $state<CategoryMetaMap>({});
	let showBassTabs = $state(true);
	let fitSinglePage = $state(true);

	let allSongs = $state<SongDoc[]>([]);
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => (allSongs = s));
		return () => unsub();
	});
	const songCategories = $derived(uniqueCategoriesFromSongs(allSongs));
	const knownCategories = $derived.by(() => {
		const names = new Set([...songCategories, ...Object.keys(categoryMetaMap)]);
		return [...names].sort((a, b) => a.localeCompare(b, 'da'));
	});
	const effectiveCategoryColorMap = $derived(
		assignMissingCategoryColors(knownCategories, categoryColorMap)
	);

	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeCategoryColors((colors) => (categoryColorMap = colors));
		return () => unsub();
	});
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeCategoryMeta((meta) => (categoryMetaMap = meta));
		return () => unsub();
	});

	$effect(() => {
		if (!authState.user || knownCategories.length === 0) return;
		if (!hasSameCategoryColors(effectiveCategoryColorMap, categoryColorMap)) {
			void saveCategoryColors(effectiveCategoryColorMap);
		}
	});

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
				showBassTabs = s.showBassTabs ?? true;
				fitSinglePage = s.fitSinglePage ?? true;
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
				showBassTabs,
				fitSinglePage,
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

	function regroupAllBassLines(targetBars: 2 | 4) {
		const next: BassLines = {};
		let changed = false;
		for (const [key, line] of Object.entries(bassLines)) {
			const regrouped = regroupBassLine(line, targetBars);
			if (regrouped) next[key] = regrouped;
			if (regrouped !== line) changed = true;
		}
		if (!changed) return;
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

	const liveSongForExport = $derived<SongDoc | null>(
		song
			? ({
					...song,
					title: title.trim() || song.title,
					artist: artist.trim() || song.artist,
					key: key.trim() || song.key,
					barsPerLine,
					categories,
					rows,
					rawInput: serializeRows(rows),
					bassLines,
					collapsedSections,
					showBassTabs,
					fitSinglePage
				} as SongDoc)
			: null
	);

	let pdfBusy = $state(false);
	let audiencePdfBusy = $state(false);

	async function handlePdf() {
		if (pdfBusy || !song) return;
		await flushPendingSave();
		pdfBusy = true;
		try {
			if (!liveSongForExport) return;
			await exportSongsAsPdf([liveSongForExport], {
				filename: title.trim() || song.title || 'Sang',
				withBassTabs: showBassTabs,
				fitSinglePage
			});
		} catch (err) {
			console.error('PDF-eksport fejlede:', err);
			alert('Kunne ikke generere PDF — se konsollen for detaljer.');
		} finally {
			pdfBusy = false;
		}
	}

	async function handleAudiencePdf() {
		if (audiencePdfBusy || !song) return;
		await flushPendingSave();
		audiencePdfBusy = true;
		try {
			if (!liveSongForExport) return;
			const exportTitle = title.trim() || song.title || 'Sang';
			await exportAudienceSongbookAsPdf([liveSongForExport], {
				title: exportTitle,
				filename: `${exportTitle} - tekst`
			});
		} catch (err) {
			console.error('Publikums-PDF fejlede:', err);
			alert('Kunne ikke generere publikums-PDF — se konsollen for detaljer.');
		} finally {
			audiencePdfBusy = false;
		}
	}

	// ───── Spil: ultrasmooth løbende scroll (ingen highlight/BPM) ─────────
	/** Ved ×1 scroller hele siden igennem på ca. denne tid (en typisk sang). */
	const PLAY_FULL_PAGE_SEC = 165;
	/** Hver − / + dividerer eller ganger tempoet med denne faktor. */
	const PLAY_SPEED_FACTOR = 1.25;

	let playing = $state(false);
	let playSpeed = $state(1);
	let playRaf: number | null = null;
	let playLastTs = 0;
	/** Fractional scroll-position — undgår at sub-pixel-deltaer forsvinder via scrollY. */
	let playPos = 0;

	function stopPlay(): void {
		playing = false;
		playLastTs = 0;
		if (playRaf != null) {
			cancelAnimationFrame(playRaf);
			playRaf = null;
		}
	}

	function slowerPlay(): void {
		playSpeed = playSpeed / PLAY_SPEED_FACTOR;
	}

	function fasterPlay(): void {
		playSpeed = playSpeed * PLAY_SPEED_FACTOR;
	}

	function formatPlaySpeed(s: number): string {
		return String(Number(s.toPrecision(3)));
	}

	function playFrame(ts: number): void {
		if (!playing) return;
		if (!playLastTs) playLastTs = ts;
		const dt = Math.min(0.05, (ts - playLastTs) / 1000);
		playLastTs = ts;

		const maxScroll = Math.max(
			0,
			document.documentElement.scrollHeight - window.innerHeight
		);
		if (maxScroll <= 0) {
			stopPlay();
			return;
		}
		const pxPerSec = (maxScroll / PLAY_FULL_PAGE_SEC) * playSpeed;
		playPos = Math.min(maxScroll, playPos + pxPerSec * dt);
		window.scrollTo(0, playPos);

		if (playPos >= maxScroll - 0.5) {
			stopPlay();
			return;
		}
		playRaf = requestAnimationFrame(playFrame);
	}

	async function startPlay(): Promise<void> {
		if (playing) {
			stopPlay();
			return;
		}
		if (collapsedSections.length > 0) {
			collapsedSections = [];
			scheduleSave();
			await tick();
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
		}
		playing = true;
		playLastTs = 0;
		playPos = window.scrollY;
		playRaf = requestAnimationFrame(playFrame);
	}

	$effect(() => {
		if (!playing) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') stopPlay();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	$effect(() => {
		return () => stopPlay();
	});

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
					<label class="print-toggle" title="Vis bass-tabs på siden og tag dem med ved print">
						<input type="checkbox" bind:checked={showBassTabs} onchange={() => scheduleSave()} />
						Bass tabs
					</label>
					<label
						class="print-toggle"
						title="Skalér sangen proportionalt så den fylder maks én A4-side"
					>
						<input type="checkbox" bind:checked={fitSinglePage} onchange={() => scheduleSave()} />
						Hold sang på en side
					</label>
					<button
						type="button"
						class="btn-secondary"
						onclick={handlePdf}
						disabled={pdfBusy}
						title="Generér akkord-PDF og hent direkte"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle
								cx="18"
								cy="16"
								r="3"
							></circle></svg
						>
						{pdfBusy ? 'Genererer…' : 'Akkorder'}
					</button>
					<button
						type="button"
						class="btn-secondary"
						onclick={handleAudiencePdf}
						disabled={audiencePdfBusy}
						title="Generér publikums-PDF uden akkorder"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path
								d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"
							></path><path d="M8 7h8"></path><path d="M8 11h7"></path></svg
						>
						{audiencePdfBusy ? 'Genererer…' : 'Tekst'}
					</button>
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
						categoryColors={effectiveCategoryColorMap}
						onRegroupAllBassLines={regroupAllBassLines}
						onChange={onMetaChange}
					/>
				</div>
			</details>

			<div class="song-area" class:no-bass-tabs={!showBassTabs}>
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

			<div
				class="play-controls no-print"
				class:is-playing={playing}
				title="Løbende scroll gennem sangen"
			>
				<button
					type="button"
					class="play-side"
					onclick={slowerPlay}
					title={`Langsommere (÷${PLAY_SPEED_FACTOR}) · nu ×${formatPlaySpeed(playSpeed)}`}
					aria-label="Langsommere"
					>−</button
				>
				<button
					type="button"
					class="play-main"
					onclick={startPlay}
					title={playing
						? `Stop (Esc) · tempo ×${formatPlaySpeed(playSpeed)}`
						: `Løbende scroll · tempo ×${formatPlaySpeed(playSpeed)}`}
				>
					{#if playing}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
							><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg
						>
						Stop
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
							><path d="M8 5v14l11-7z"></path></svg
						>
						Spil
					{/if}
				</button>
				<button
					type="button"
					class="play-side"
					onclick={fasterPlay}
					title={`Hurtigere (×${PLAY_SPEED_FACTOR}) · nu ×${formatPlaySpeed(playSpeed)}`}
					aria-label="Hurtigere"
					>+</button
				>
			</div>
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
	.play-controls {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		display: inline-flex;
		align-items: stretch;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-button);
		overflow: hidden;
		background: #ffffff;
		box-shadow: 0 8px 22px rgba(15, 23, 42, 0.14);
		transition: box-shadow 160ms ease, border-color 160ms ease;
	}
	.play-controls.is-playing {
		border-color: var(--color-accent);
		box-shadow: 0 10px 28px rgba(15, 23, 42, 0.2);
	}
	.play-controls .play-side,
	.play-controls .play-main {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		margin: 0;
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--color-ink);
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease;
	}
	.play-controls .play-side {
		min-width: 2.4rem;
		padding: 0.55rem 0.65rem;
		font-size: 1.15rem;
		line-height: 1;
		color: var(--color-ink-muted);
	}
	.play-controls .play-side:first-child {
		border-right: 1px solid var(--color-border-subtle);
	}
	.play-controls .play-side:last-child {
		border-left: 1px solid var(--color-border-subtle);
	}
	.play-controls .play-main {
		padding: 0.55rem 1rem;
		min-width: 5.5rem;
	}
	.play-controls .play-side:hover,
	.play-controls .play-main:hover {
		background: #f3f4f6;
	}
	.play-controls.is-playing .play-main {
		background: var(--color-accent);
		color: #ffffff;
	}
	.play-controls.is-playing .play-main:hover {
		background: var(--color-accent-hover);
	}
	.play-controls.is-playing .play-side {
		color: var(--color-ink);
	}
	.play-controls.is-playing .play-side:hover {
		background: rgba(245, 158, 11, 0.12);
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
