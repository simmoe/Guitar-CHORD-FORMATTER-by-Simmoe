<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import {
		createSong,
		saveCategoryColors,
		subscribeCategoryColors,
		subscribeCategoryMeta,
		subscribeSongs
	} from '$lib/firebase/songs';
	import { fetchUgTab, type UgFetchErrorDetails } from '$lib/firebase/ug';
	import {
		uniqueCategoriesFromSongs,
		normalizeRawInputAccidentals,
		normalizeAccidentals
	} from '$lib/chordFormatter';
	import EditableSong from '$lib/components/EditableSong.svelte';
	import SongMetaForm from '$lib/components/SongMetaForm.svelte';
	import { inferBassLinesForImportedRows } from '$lib/migrate';
	import {
		normalizeImportedChordSpacing,
		parseRows,
		serializeRows,
		type Row
	} from '$lib/songParse';
	import { bookmarkletHref } from '$lib/ugImport';
	import {
		assignMissingCategoryColors,
		hasSameCategoryColors
	} from '$lib/categoryColors';
	import type { CategoryColorMap, CategoryMetaMap, SongDoc } from '$lib/types';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	let allSongs = $state<SongDoc[]>([]);
	let categoryColorMap = $state<CategoryColorMap>({});
	let categoryMetaMap = $state<CategoryMetaMap>({});
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => (allSongs = s));
		return () => unsub();
	});
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
	const songCategories = $derived(uniqueCategoriesFromSongs(allSongs));
	const knownCategories = $derived.by(() => {
		const names = new Set([...songCategories, ...Object.keys(categoryMetaMap)]);
		return [...names].sort((a, b) => a.localeCompare(b, 'da'));
	});
	const effectiveCategoryColorMap = $derived(
		assignMissingCategoryColors(knownCategories, categoryColorMap)
	);
	$effect(() => {
		if (!authState.user || knownCategories.length === 0) return;
		if (!hasSameCategoryColors(effectiveCategoryColorMap, categoryColorMap)) {
			void saveCategoryColors(effectiveCategoryColorMap);
		}
	});
	const ugBookmarkletHref = $derived(
		typeof location !== 'undefined' ? bookmarkletHref(location.origin) : ''
	);

	// ───── Primært flow: bare skriv en titel og lad UG-fetch ordne resten ─────
	let query = $state('');
	let artistQuery = $state('');
	let fetching = $state(false);
	let fetchError = $state<string | null>(null);

	// Paste-fallback: vises når Cloud Function-fetch fejler. Vi åbner UG-siden
	// automatisk i ny tab (med tekst-fragment så browseren scrolls til chord-
	// blokken), og lader brugeren paste indholdet i denne modal.
	interface PasteFallback {
		title: string;
		artist: string;
		ugUrl: string;
		stage: 'search' | 'tab' | 'no-hits';
		rawText: string;
		importing: boolean;
		error: string | null;
	}
	let paste = $state<PasteFallback | null>(null);
	let pasteAreaEl: HTMLTextAreaElement | null = $state(null);
	$effect(() => {
		if (paste && pasteAreaEl) pasteAreaEl.focus();
	});

	const URL_RX = /^https?:\/\//i;

	function buildUgSearchUrl(title: string, artist: string): string {
		const q = artist ? `${title} ${artist}` : title;
		return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`;
	}

	/**
	 * UG renderer chord-sektionerne med deres egne `[Intro]`/`[Verse]` headers
	 * inde i den synlige tekst, så Chrome/Edge/Safari's `#:~:text=`-fragment
	 * scroller direkte til dem (og highlighter dem gult). `[Intro]` er mest
	 * almindeligt; ellers falder browseren bare lydløst tilbage til top.
	 */
	function withChordHighlight(url: string): string {
		if (!URL_RX.test(url)) return url;
		const sep = url.includes('#') ? '' : '#:~:text=%5BIntro%5D';
		return url + sep;
	}

	function openUgInNewTab(url: string): void {
		try {
			window.open(url, '_blank', 'noopener,noreferrer');
		} catch {
			// pop-up blokeret — brugeren har stadig URL'en synlig i modal'en
		}
	}

	function ugDetailsFromError(err: unknown): UgFetchErrorDetails | undefined {
		const e = err as {
			details?: UgFetchErrorDetails;
			customData?: { details?: UgFetchErrorDetails };
			message?: string;
		};
		const details = e?.details ?? e?.customData?.details;
		if (details) return details;
		const m = e?.message?.match(/https:\/\/tabs\.ultimate-guitar\.com\/tab\/[^\s)]+/);
		return m ? { stage: 'tab', tabUrl: m[0] } : undefined;
	}

	async function handleAutoFetch() {
		if (!authState.user) return;
		const t = query.trim();
		if (!t) return;
		const a = artistQuery.trim();
		const q = URL_RX.test(t) ? t : a ? `${t} ${a}` : t;
		fetching = true;
		fetchError = null;
		paste = null;
		try {
			const ug = await fetchUgTab(q);
			await persistAndGo({
				title: ug.title || t,
				artist: ug.artist || a,
				rawInput: ug.rawInput,
				sourceUrl: ug.sourceUrl,
				keyGuess: ug.keyGuess,
				capo: ug.capo
			});
		} catch (err) {
			openPasteFallback(err, t, a);
		} finally {
			fetching = false;
		}
	}

	function openPasteFallback(err: unknown, t: string, a: string): void {
		const details = ugDetailsFromError(err);
		const stage = details?.stage ?? 'search';
		const ugUrl =
			details?.tabUrl ??
			details?.searchUrl ??
			(URL_RX.test(t) ? t : buildUgSearchUrl(t, a));
		const openUrl = details?.tabUrl ? withChordHighlight(details.tabUrl) : ugUrl;
		openUgInNewTab(openUrl);
		paste = {
			title: t,
			artist: a,
			ugUrl,
			stage,
			rawText: '',
			importing: false,
			error: null
		};
		const msg = err instanceof Error ? err.message : 'Ukendt fejl';
		fetchError = `Ultimate Guitar svarede ikke (${msg}). Vi har åbnet siden for dig i en ny fane — kopiér chord-blokken og paste den i feltet til højre.`;
	}

	async function handlePasteImport() {
		if (!paste || !authState.user) return;
		const raw = paste.rawText.trim();
		if (!raw) {
			paste.error = 'Paste chord+lyric-tekst fra UG først.';
			return;
		}
		paste.importing = true;
		paste.error = null;
		try {
			await persistAndGo({
				title: paste.title || 'Untitled',
				artist: paste.artist,
				rawInput: raw,
				sourceUrl: paste.ugUrl
			});
		} catch (err) {
			paste.error = err instanceof Error ? err.message : 'Ukendt fejl';
		} finally {
			if (paste) paste.importing = false;
		}
	}

	interface PersistArgs {
		title: string;
		artist: string;
		rawInput: string;
		sourceUrl?: string;
		keyGuess?: string;
		capo?: number;
	}

	async function persistAndGo(args: PersistArgs): Promise<void> {
		if (!authState.user) return;
		const rawNormalized = normalizeRawInputAccidentals(args.rawInput);
		const importedRows = normalizeImportedChordSpacing(parseRows(rawNormalized));
		const barsPL: 2 | 4 | 8 = 4;
		const bassLines = inferBassLinesForImportedRows(importedRows, barsPL);
		const id = await createSong(
			{
				title: args.title,
				...(args.artist ? { artist: args.artist } : {}),
				...(args.keyGuess ? { key: normalizeAccidentals(args.keyGuess) } : {}),
				rawInput: serializeRows(importedRows),
				rows: importedRows,
				barsPerLine: barsPL,
				...(Object.keys(bassLines).length > 0 ? { bassLines } : {}),
				categories: [],
				fitSinglePage: true,
				schemaVersion: 4,
				...(args.sourceUrl ? { sourceUrl: args.sourceUrl } : {}),
				...(args.capo !== undefined ? { capo: args.capo } : {})
			},
			authState.user.uid
		);
		goto(`/song/${id}`);
	}

	// ───── Manuelt flow (folde-ud) ────────────────────────────────────────────
	let manualOpen = $state(false);
	let title = $state('');
	let artist = $state('');
	let key = $state('');
	let barsPerLine = $state<2 | 4 | 8>(4);
	let categories = $state<string[]>([]);
	let rows = $state<Row[]>([{ kind: 'blank' }]);

	let saving = $state(false);
	let saveError = $state<string | null>(null);

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
	}

	const canSaveManual = $derived(
		title.trim().length > 0 && serializeRows(rows).trim().length > 0 && !saving
	);

	async function handleSaveManual() {
		if (!authState.user) return;
		saveError = null;
		saving = true;
		try {
			const importedRows = normalizeImportedChordSpacing(rows);
			const rawSerialized = serializeRows(importedRows);
			const bassLines = inferBassLinesForImportedRows(importedRows, barsPerLine);
			const id = await createSong(
				{
					title: title.trim(),
					...(artist.trim() ? { artist: artist.trim() } : {}),
					...(key.trim() ? { key: normalizeAccidentals(key.trim()) } : {}),
					rawInput: normalizeRawInputAccidentals(rawSerialized),
					rows: importedRows,
					barsPerLine,
					...(Object.keys(bassLines).length > 0 ? { bassLines } : {}),
					categories,
					fitSinglePage: true,
					schemaVersion: 4
				},
				authState.user.uid
			);
			goto(`/song/${id}`);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Ukendt fejl';
		} finally {
			saving = false;
		}
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !fetching) {
			e.preventDefault();
			void handleAutoFetch();
		}
	}
</script>

<svelte:head><title>Tilføj sang · {BAND.name}</title></svelte:head>

<main class="mx-auto max-w-3xl px-6 py-10">
	<header class="mb-8">
		<a
			href="/songbook"
			class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
			>← Tilbage til sangbogen</a
		>
		<h1 class="mt-2 font-display text-3xl font-bold text-[var(--color-accent)]">Tilføj sang</h1>
		<p class="text-sm text-[var(--color-ink-faint)]">
			Skriv sangtitlen — så henter softwaren akkorder + tekst fra Ultimate Guitar og lægger
			sangen i sangmappen. Du kan altid finjustere bagefter.
		</p>
	</header>

	<!-- Primært flow: stort søgefelt -->
	<section class="card p-8">
		<label for="ug-query" class="form-label">Sangtitel</label>
		<input
			id="ug-query"
			type="text"
			bind:value={query}
			onkeydown={onSearchKey}
			disabled={fetching}
			placeholder="fx Harvest Moon — eller indsæt en ultimate-guitar.com URL"
			class="mt-2 w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-[var(--color-ink-on-dark)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
		/>

		<label for="ug-artist" class="form-label mt-4 block">Kunstner <span class="optional">(valgfri — hjælper søgningen)</span></label>
		<input
			id="ug-artist"
			type="text"
			bind:value={artistQuery}
			onkeydown={onSearchKey}
			disabled={fetching}
			placeholder="fx Neil Young"
			class="mt-2 w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-[var(--color-ink-on-dark)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
		/>

		<div class="mt-5 flex justify-end">
			<button
				type="button"
				class="btn-primary find-button !text-base"
				class:loading={fetching}
				style="padding: 0.75rem 2rem;"
				disabled={fetching || query.trim().length === 0}
				onclick={handleAutoFetch}
			>
				{#if fetching}<span class="find-spinner" aria-hidden="true"></span>{/if}
				{fetching ? 'Finder akkorder…' : 'Find'}
			</button>
		</div>
		{#if fetching}
			<p class="mt-3 text-right text-xs text-[var(--color-ink-faint)]">
				Søger på Ultimate Guitar. Hvis den bliver blokeret, åbner vi paste-flowet automatisk.
			</p>
		{/if}

		{#if fetchError}
			<div
				class="mt-4 rounded-md border border-[var(--color-error)] bg-[#3a1212] p-3 text-sm text-[var(--color-error)]"
			>
				{fetchError}
			</div>
		{/if}
	</section>

	<section class="card mt-6 p-6">
		<h2 class="font-display text-xl font-bold text-[var(--color-accent)]">
			Installér UG-import-knap
		</h2>
		<p class="mt-1 text-sm text-[var(--color-ink-muted)]">
			Træk knappen op i browserens bookmark-linje én gang. Når du står på en konkret
			Ultimate Guitar chord-side, klikker du den for at sende sangen direkte hertil.
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<a
				href={ugBookmarkletHref}
				class="bookmarklet-button"
				onclick={(e) => e.preventDefault()}
				aria-label="Træk denne knap til bookmark-linjen"
			>
				Send til Fællesbandet
			</a>
			<span class="text-xs text-[var(--color-ink-faint)]">
				Tip: vis bookmark-linjen med Cmd+Shift+B i Chrome/Safari.
			</span>
		</div>
	</section>

	{#if paste}
		<!-- Paste-fallback: UG-siden er allerede åbnet i ny tab. -->
		<section class="card mt-6 p-6">
			<header class="mb-4 flex items-start justify-between gap-4">
				<div>
					<h2 class="font-display text-xl font-bold text-[var(--color-accent)]">
						Hent chord-blokken fra Ultimate Guitar
					</h2>
					<p class="mt-1 text-sm text-[var(--color-ink-faint)]">
						Vi åbnede siden for dig. Markér chord+lyric-blokken (Cmd+A inde i
						blokken), kopiér (Cmd+C), kom tilbage og paste her — så importerer
						vi den som var det fra UG direkte.
					</p>
				</div>
				<button
					type="button"
					class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
					onclick={() => (paste = null)}
				>
					Luk ✕
				</button>
			</header>

			<div class="paste-grid">
				<div class="paste-left">
					<label for="paste-title" class="form-label">Titel</label>
					<input
						id="paste-title"
						type="text"
						bind:value={paste.title}
						class="paste-input"
					/>
					<label for="paste-artist" class="form-label mt-3 block">Kunstner</label>
					<input
						id="paste-artist"
						type="text"
						bind:value={paste.artist}
						class="paste-input"
					/>
					<div class="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs">
						<div class="mb-1 font-semibold text-[var(--color-ink-faint)]">
							UG-side ({paste.stage === 'tab' ? 'fundet sang' : 'søgning'}):
						</div>
						<a
							href={paste.ugUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="break-all text-[var(--color-accent)] underline"
						>
							{paste.ugUrl}
						</a>
						<button
							type="button"
							class="mt-2 block text-[var(--color-ink-faint)] underline hover:text-[var(--color-accent)]"
							onclick={() => openUgInNewTab(paste!.ugUrl)}
						>
							Åbn igen
						</button>
					</div>
				</div>
				<div class="paste-right">
					<label for="paste-raw" class="form-label">
						Akkorder + tekst fra UG <span class="req">*</span>
					</label>
					<textarea
						id="paste-raw"
						bind:this={pasteAreaEl}
						bind:value={paste.rawText}
						rows="14"
						placeholder="[Intro]&#10;Em   G   D   A7sus4&#10;&#10;[Verse 1]&#10;Em       G&#10;Today is gonna be the day…"
						class="paste-textarea"
					></textarea>
					{#if paste.error}
						<p class="mt-2 text-sm text-[var(--color-error)]">{paste.error}</p>
					{/if}
					<div class="mt-3 flex items-center justify-end gap-3">
						<button
							type="button"
							class="btn-primary"
							disabled={paste.importing || paste.rawText.trim().length === 0}
							onclick={handlePasteImport}
						>
							{paste.importing ? 'Importerer…' : 'Importér sangen'}
						</button>
					</div>
				</div>
			</div>
		</section>
	{/if}

	<!-- Manuelt flow — folder ud kun hvis der er behov -->
	<section class="mt-6">
		<details bind:open={manualOpen} class="manual-details">
			<summary class="cursor-pointer rounded-[var(--radius-button)] border border-[var(--color-border)] bg-transparent px-4 py-3 text-sm font-semibold text-[var(--color-ink-on-dark)] hover:bg-white/5">
				Tilføj sangen manuelt i stedet
			</summary>

			<div class="card mt-3 p-6">
				<p class="mb-4 text-sm text-[var(--color-ink-muted)]">
					Hvis UG ikke kan finde sangen, kan du oprette den i hånden her. Skriv eller paste hele
					akkord+tekst-blokken i sangtekstboksen.
				</p>

				<SongMetaForm
					{title}
					{artist}
					{key}
					{barsPerLine}
					{categories}
					{knownCategories}
					categoryColors={effectiveCategoryColorMap}
					onChange={onMetaChange}
				/>

				<div class="mt-5">
					<span class="form-label">Akkorder + tekst <span class="req">*</span></span>
					<p class="mt-1 mb-2 text-xs italic text-[var(--color-ink-faint)]">
						Akkord-linjer får automatisk monospace + blå farve; tekst-linjer bliver fede;
						<code>[Verse 1]</code> bliver til en pille-header.
					</p>
					<div class="paste-area-wrap">
						<EditableSong
							{rows}
							{barsPerLine}
							onRowsChange={(next) => (rows = next)}
						/>
					</div>
				</div>

				{#if saveError}
					<p class="mt-3 text-sm text-[var(--color-error)]">{saveError}</p>
				{/if}
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="btn-primary"
						disabled={!canSaveManual}
						onclick={handleSaveManual}
					>
						{saving ? 'Gemmer…' : 'Gem sang'}
					</button>
				</div>
			</div>
		</details>
	</section>
</main>

<style>
	.form-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-ink-faint);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.req {
		color: var(--color-error);
	}
	.optional {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--color-ink-faint);
		margin-left: 0.4em;
	}
	.paste-area-wrap {
		background: #ffffff;
		border-radius: 0.5rem;
		padding: 1rem;
		min-height: 18rem;
		border: 1px dashed var(--color-border);
		transition: border-color 120ms ease;
	}
	.paste-area-wrap:focus-within {
		border-color: var(--color-accent);
		border-style: solid;
	}
	.find-button.loading {
		position: relative;
		opacity: 0.92;
	}
	.find-spinner {
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		border: 2px solid rgba(255, 255, 255, 0.45);
		border-top-color: #ffffff;
		animation: spin 800ms linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.manual-details > summary {
		list-style: none;
	}
	.manual-details > summary::-webkit-details-marker {
		display: none;
	}
	.manual-details > summary::marker {
		content: '';
	}
	.manual-details > summary::before {
		content: '▸';
		display: inline-block;
		margin-right: 0.4em;
		transition: transform 160ms ease;
	}
	.manual-details[open] > summary::before {
		transform: rotate(90deg);
	}
	.paste-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 1.25rem;
	}
	@media (max-width: 720px) {
		.paste-grid {
			grid-template-columns: 1fr;
		}
	}
	.paste-input {
		width: 100%;
		margin-top: 0.4rem;
		border-radius: var(--radius-button);
		border: 1px solid var(--color-border);
		background: var(--color-bg-elevated);
		padding: 0.6rem 0.8rem;
		color: var(--color-ink-on-dark);
	}
	.paste-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.paste-textarea {
		width: 100%;
		margin-top: 0.4rem;
		min-height: 22rem;
		border-radius: var(--radius-button);
		border: 1px dashed var(--color-border);
		background: #ffffff;
		color: #111;
		padding: 0.9rem 1rem;
		font-family: var(--font-mono);
		font-size: 0.9rem;
		line-height: 1.35;
		resize: vertical;
	}
	.paste-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
		border-style: solid;
	}
	.bookmarklet-button {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		border-radius: 999px;
		border: 1px solid #f2d2a8;
		background: #fcead2;
		color: #824817;
		padding: 0.55rem 0.9rem;
		font-weight: 800;
		box-shadow: 0 2px 8px rgba(130, 72, 23, 0.12);
		cursor: grab;
	}
	.bookmarklet-button::before {
		content: '+';
		font-size: 1.1rem;
		line-height: 1;
	}
	.bookmarklet-button:active {
		cursor: grabbing;
	}
</style>
