<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import {
		deleteCategoryImage,
		saveCategoryColors,
		saveCategoryMeta,
		subscribeCategoryColors,
		subscribeCategoryMeta,
		subscribeSongs,
		updateSong,
		uploadCategoryImage
	} from '$lib/firebase/songs';
	import {
		inviteBandMember,
		listBandMembers,
		removeBandMember,
		updateMyProfile,
		type BandMemberProfile,
		type InvitedBandMember
	} from '$lib/firebase/members';
	import { uniqueCategoriesFromSongs } from '$lib/chordFormatter';
	import CategoryMetaDialog from '$lib/components/CategoryMetaDialog.svelte';
	import ProfileDialog from '$lib/components/ProfileDialog.svelte';
	import { exportAudienceSongbookAsPdf, exportSongsAsPdf } from '$lib/pdf';
	import {
		assignMissingCategoryColors,
		colorForCategory as paletteColorForCategory,
		hasSameCategoryColors
	} from '$lib/categoryColors';
	import type { CategoryColorMap, CategoryMeta, CategoryMetaMap, SongDoc } from '$lib/types';

	let songs = $state<SongDoc[]>([]);
	let loadingSongs = $state(true);
	let error = $state<string | null>(null);
	let activeCategory = $state<string | null>(null); // null = alle (filter)
	let printCategory = $state<string>(''); // '' = hele sangbogen
	let search = $state('');
	let categoryColorMap = $state<CategoryColorMap>({});
	let categoryMetaMap = $state<CategoryMetaMap>({});
	let pdfBusy = $state(false);
	let audiencePdfBusy = $state(false);
	let editingCategories = $state(false);
	let categorySaving = $state(false);
	let categoryUploading = $state(false);
	let categoryError = $state<string | null>(null);
	let restoredSessionSelection = $state(false);
	let editingProfile = $state(false);
	let profileMembers = $state<BandMemberProfile[]>([]);
	let profileLoading = $state(false);
	let profileSaving = $state(false);
	let profileInviting = $state(false);
	let profileRemovingUid = $state<string | null>(null);
	let profileError = $state<string | null>(null);
	let canManageMembers = $state(false);

	const SONGBOOK_SESSION_SELECTION_KEY = 'faellesbandet.songbook.session-selection';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs(
			(s) => {
				songs = s;
				loadingSongs = false;
			},
			(err) => {
				error = err.message;
				loadingSongs = false;
			}
		);
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

	const categories = $derived(uniqueCategoriesFromSongs(songs));
	const effectiveCategoryColorMap = $derived(
		assignMissingCategoryColors(categories, categoryColorMap)
	);

	$effect(() => {
		if (!browser || restoredSessionSelection) return;
		restoredSessionSelection = true;
		const raw = sessionStorage.getItem(SONGBOOK_SESSION_SELECTION_KEY);
		if (!raw) return;
		try {
			const saved = JSON.parse(raw) as { activeCategory?: string | null; printCategory?: string };
			activeCategory = saved.activeCategory ?? null;
			printCategory = saved.printCategory ?? saved.activeCategory ?? '';
		} catch {
			sessionStorage.removeItem(SONGBOOK_SESSION_SELECTION_KEY);
		}
	});

	$effect(() => {
		if (!browser || !restoredSessionSelection) return;
		sessionStorage.setItem(
			SONGBOOK_SESSION_SELECTION_KEY,
			JSON.stringify({ activeCategory, printCategory })
		);
	});

	$effect(() => {
		if (!authState.user || categories.length === 0) return;
		if (!hasSameCategoryColors(effectiveCategoryColorMap, categoryColorMap)) {
			void saveCategoryColors(effectiveCategoryColorMap);
		}
	});

	function colorForCategory(cat: string) {
		return paletteColorForCategory(cat, effectiveCategoryColorMap);
	}

	const allCategoryNames = $derived.by(() => {
		const names = new Set([...categories, ...Object.keys(categoryMetaMap)]);
		return [...names].sort((a, b) => a.localeCompare(b, 'da'));
	});

	const recentCategories = $derived.by(() =>
		[...allCategoryNames]
			.sort((a, b) => categorySortTime(b) - categorySortTime(a))
			.slice(0, 3)
	);

	function categorySortTime(cat: string): number {
		return categoryMetaMap[cat]?.updatedAt ?? categoryMetaMap[cat]?.createdAt ?? 0;
	}

	const filteredSongs = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return songs.filter((s) => {
			if (activeCategory && !(s.categories ?? []).includes(activeCategory)) return false;
			if (!q) return true;
			return (
				s.title.toLowerCase().includes(q) ||
				(s.artist ?? '').toLowerCase().includes(q) ||
				(s.categories ?? []).some((c) => c.toLowerCase().includes(q))
			);
		});
	});

	async function handleSignOut() {
		await authState.signOut();
		goto('/login');
	}

	async function openProfileDialog(): Promise<void> {
		if (authState.user && authState.profile) {
			profileMembers = mergeProfileMembers([], [
				{
					uid: authState.user.uid,
					displayName: authState.profile.displayName,
					email: authState.profile.email
				}
			]);
		}
		editingProfile = true;
		profileError = null;
		await refreshProfileMembers();
	}

	async function refreshProfileMembers(): Promise<void> {
		profileLoading = true;
		profileError = null;
		try {
			const result = await listBandMembers();
			canManageMembers = result.canRemoveMembers;
			profileMembers = mergeProfileMembers(profileMembers, result.members);
		} catch (err) {
			profileError = err instanceof Error ? err.message : 'Kunne ikke hente medlemmer.';
		} finally {
			profileLoading = false;
		}
	}

	function mergeProfileMembers(
		current: BandMemberProfile[],
		incoming: BandMemberProfile[]
	): BandMemberProfile[] {
		const byUid = new Map(current.map((member) => [member.uid, member]));
		for (const member of incoming) {
			byUid.set(member.uid, { ...(byUid.get(member.uid) ?? {}), ...member });
		}
		return [...byUid.values()];
	}

	async function saveProfile(displayName: string, email: string): Promise<void> {
		if (!authState.user) return;
		profileSaving = true;
		profileError = null;
		try {
			const updated = await updateMyProfile(displayName, email);
			authState.profile = {
				...(authState.profile ?? {}),
				displayName: updated.displayName,
				email: updated.email
			} as typeof authState.profile;
			profileMembers = profileMembers.map((member) =>
				member.uid === updated.uid ? { ...member, ...updated } : member
			);
		} catch (err) {
			profileError = err instanceof Error ? err.message : 'Kunne ikke gemme profilen.';
		} finally {
			profileSaving = false;
		}
	}

	async function inviteMember(email: string, displayName: string): Promise<InvitedBandMember | null> {
		profileInviting = true;
		profileError = null;
		try {
			const invited = await inviteBandMember(email, displayName);
			if (!profileMembers.some((member) => member.uid === invited.uid)) {
				profileMembers = [...profileMembers, invited];
			} else {
				profileMembers = profileMembers.map((member) =>
					member.uid === invited.uid ? { ...member, ...invited } : member
				);
			}
			return invited;
		} catch (err) {
			profileError = err instanceof Error ? err.message : 'Kunne ikke invitere medlemmet.';
			return null;
		} finally {
			profileInviting = false;
		}
	}

	async function removeMember(uid: string): Promise<void> {
		profileRemovingUid = uid;
		profileError = null;
		try {
			await removeBandMember(uid);
			profileMembers = profileMembers.filter((member) => member.uid !== uid);
		} catch (err) {
			profileError = err instanceof Error ? err.message : 'Kunne ikke fjerne medlemmet.';
		} finally {
			profileRemovingUid = null;
		}
	}

	async function handlePdfBook() {
		if (pdfBusy || printSongs.length === 0) return;
		pdfBusy = true;
		try {
			const title = printCategory || `${BAND.name}s sangbog`;
			await exportSongsAsPdf(printSongs, {
				filename: title,
				withBassTabs: true,
				includeCover: true,
				coverTitle: title,
				coverMeta: printCategory ? categoryMetaMap[printCategory] : undefined
			});
		} catch (err) {
			console.error('PDF-eksport fejlede:', err);
			alert('Kunne ikke generere PDF — se konsollen for detaljer.');
		} finally {
			pdfBusy = false;
		}
	}

	async function handleAudiencePdfBook() {
		if (audiencePdfBusy || printSongs.length === 0) return;
		audiencePdfBusy = true;
		try {
			const title = printCategory || `${BAND.name}s Sangbog`;
			await exportAudienceSongbookAsPdf(printSongs, {
				title,
				filename: `${title} - tekst`,
				categoryMeta: printCategory ? categoryMetaMap[printCategory] : undefined
			});
		} catch (err) {
			console.error('Publikums-PDF fejlede:', err);
			alert('Kunne ikke generere publikums-PDF — se konsollen for detaljer.');
		} finally {
			audiencePdfBusy = false;
		}
	}

	function openCategoryEditor(): void {
		editingCategories = true;
		categoryError = null;
	}

	async function addCategoryMeta(category: string): Promise<void> {
		const now = Date.now();
		categorySaving = true;
		categoryError = null;
		try {
			await saveCategoryMeta({
				...categoryMetaMap,
				[category]: cleanCategoryMeta({
					...(categoryMetaMap[category] ?? {}),
					createdAt: categoryMetaMap[category]?.createdAt ?? now,
					updatedAt: now
				})
			});
		} catch (err) {
			categoryError = err instanceof Error ? err.message : 'Kunne ikke gemme kategori.';
		} finally {
			categorySaving = false;
		}
	}

	async function saveEditingCategory(category: string, meta: CategoryMeta): Promise<void> {
		const now = Date.now();
		categorySaving = true;
		categoryError = null;
		try {
			await saveCategoryMeta({
				...categoryMetaMap,
				[category]: cleanCategoryMeta({
					...meta,
					createdAt: meta.createdAt ?? categoryMetaMap[category]?.createdAt ?? now,
					updatedAt: now
				})
			});
		} catch (err) {
			categoryError = err instanceof Error ? err.message : 'Kunne ikke gemme kategori.';
		} finally {
			categorySaving = false;
		}
	}

	async function renameCategory(from: string, to: string): Promise<void> {
		const nextName = to.trim();
		if (!nextName || nextName === from || !authState.user) return;
		categorySaving = true;
		categoryError = null;
		try {
			const currentMeta = categoryMetaMap[from] ?? {};
			const now = Date.now();
			const nextMeta = { ...categoryMetaMap };
			delete nextMeta[from];
			nextMeta[nextName] = cleanCategoryMeta({
				...currentMeta,
				createdAt: currentMeta.createdAt ?? now,
				updatedAt: now
			});
			await saveCategoryMeta(nextMeta);
			await Promise.all(
				songs
					.filter((song) => (song.categories ?? []).includes(from))
					.map((song) =>
						updateSong(
							song.id,
							{
								categories: [...new Set((song.categories ?? []).map((cat) => (cat === from ? nextName : cat)))]
							},
							authState.user!.uid
						)
					)
			);
			if (activeCategory === from) activeCategory = nextName;
			if (printCategory === from) printCategory = nextName;
		} catch (err) {
			categoryError = err instanceof Error ? err.message : 'Kunne ikke omdøbe kategori.';
		} finally {
			categorySaving = false;
		}
	}

	async function deleteCategoryMeta(category: string): Promise<void> {
		if (!authState.user) return;
		const ok = confirm(
			`Slet kategorien "${category}" fra kategori-listen og fra alle sange? Selve sangene bliver ikke slettet.`
		);
		if (!ok) return;
		categorySaving = true;
		categoryError = null;
		try {
			const current = categoryMetaMap[category];
			if (current?.imagePath) await deleteCategoryImage(current.imagePath);
			const next = { ...categoryMetaMap };
			delete next[category];
			await saveCategoryMeta(next);
			await Promise.all(
				songs
					.filter((song) => (song.categories ?? []).includes(category))
					.map((song) =>
						updateSong(
							song.id,
							{ categories: (song.categories ?? []).filter((cat) => cat !== category) },
							authState.user!.uid
						)
					)
			);
			if (activeCategory === category) activeCategory = null;
			if (printCategory === category) printCategory = '';
		} catch (err) {
			categoryError = err instanceof Error ? err.message : 'Kunne ikke slette kategori.';
		} finally {
			categorySaving = false;
		}
	}

	async function uploadEditingCategoryImage(category: string, file: File): Promise<void> {
		if (!authState.user) return;
		categoryUploading = true;
		categoryError = null;
		try {
			const current = categoryMetaMap[category] ?? {};
			const uploaded = await uploadCategoryImage(category, file, authState.user.uid);
			if (current.imagePath) {
				deleteCategoryImage(current.imagePath).catch((err) =>
					console.warn('Kunne ikke slette gammelt kategori-billede:', err)
				);
			}
			const now = Date.now();
			await saveCategoryMeta({
				...categoryMetaMap,
				[category]: cleanCategoryMeta({
					...current,
					...uploaded,
					createdAt: current.createdAt ?? now,
					updatedAt: now
				})
			});
		} catch (err) {
			categoryError = firebaseErrorMessage(err, 'Kunne ikke uploade billede.');
		} finally {
			categoryUploading = false;
		}
	}

	function firebaseErrorMessage(err: unknown, fallback: string): string {
		if (!(err instanceof Error)) return fallback;
		const code = (err as { code?: string }).code;
		return code ? `${fallback} (${code}: ${err.message})` : `${fallback} (${err.message})`;
	}

	async function removeEditingCategoryImage(category: string): Promise<void> {
		categorySaving = true;
		categoryError = null;
		try {
			const current = categoryMetaMap[category] ?? {};
			if (current.imagePath) await deleteCategoryImage(current.imagePath);
			const now = Date.now();
			await saveCategoryMeta({
				...categoryMetaMap,
				[category]: cleanCategoryMeta({
					...current,
					imageUrl: undefined,
					imagePath: undefined,
					updatedAt: now
				})
			});
		} catch (err) {
			categoryError = err instanceof Error ? err.message : 'Kunne ikke fjerne billede.';
		} finally {
			categorySaving = false;
		}
	}

	function cleanCategoryMeta(meta: CategoryMeta): CategoryMeta {
		return {
			...(meta.introText?.trim() ? { introText: meta.introText.trim() } : {}),
			...(meta.imageUrl ? { imageUrl: meta.imageUrl } : {}),
			...(meta.imagePath ? { imagePath: meta.imagePath } : {}),
			...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
			...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {})
		};
	}

	function selectSongbookCategory(cat: string | null): void {
		activeCategory = cat;
		printCategory = cat ?? '';
	}

	function selectPrintCategory(cat: string): void {
		printCategory = cat;
		activeCategory = cat || null;
	}

	function searchByCategory(cat: string): void {
		search = cat;
		activeCategory = null;
		printCategory = cat;
	}

	function categorySortKey(cat: string): string {
		return cat.toLowerCase();
	}

	function highlightedCategoryForSong(song: SongDoc): string | null {
		const songCategories = song.categories ?? [];
		if (activeCategory && songCategories.includes(activeCategory)) return activeCategory;
		const q = search.trim().toLowerCase();
		if (!q) return null;
		return songCategories.find((cat) => cat.toLowerCase().includes(q)) ?? null;
	}

	function displayCategoriesForSong(song: SongDoc): string[] {
		const songCategories = [...(song.categories ?? [])];
		const highlighted = highlightedCategoryForSong(song);
		return songCategories.sort((a, b) => {
			if (a === highlighted) return -1;
			if (b === highlighted) return 1;
			return categorySortKey(a).localeCompare(categorySortKey(b), 'da');
		});
	}

	const printCount = $derived.by(() => {
		if (!printCategory) return songs.length;
		return songs.filter((s) => (s.categories ?? []).includes(printCategory)).length;
	});

	const printSongs = $derived.by(() => {
		if (!printCategory) return songs;
		return songs.filter((s) => (s.categories ?? []).includes(printCategory));
	});
</script>

<svelte:head><title>Sangbog · {BAND.name}</title></svelte:head>

<main class="mx-auto max-w-6xl px-6 py-10">
	<header class="mb-8 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="font-display text-3xl font-bold tracking-tight text-[var(--color-accent)]">
				{BAND.name}
			</h1>
			<p class="text-sm text-[var(--color-ink-faint)]">
				{BAND.tagline} · samlede sangbog
			</p>
		</div>
		{#if authState.profile}
			<div class="flex items-center gap-3 text-sm">
				<span class="text-[var(--color-ink-faint)]">
					Logget ind som
					<button
						type="button"
						class="profile-name-button"
						onclick={openProfileDialog}
						aria-label="Åbn profil og invitationer"
						>{authState.profile.displayName}</button
					>
				</span>
				<button class="btn-ghost" onclick={handleSignOut}>Log ud</button>
			</div>
		{/if}
	</header>

	<!-- Action bar: stort + til ny sang, og samlet PDF for valgt kategori -->
	<div class="mb-6 flex flex-wrap items-center gap-3">
		<a
			href="/songbook/new"
			class="btn-primary !text-base"
			style="padding: 1rem 1.5rem; font-size: 1.05rem;"
			aria-label="Tilføj ny sang"
		>
			<span aria-hidden="true" style="font-size: 1.5rem; line-height: 1;">+</span>
			Tilføj sang
		</a>
		<div class="print-group">
			<select
				value={printCategory}
				class="print-select"
				aria-label="Vælg hvad der skal eksporteres som PDF"
				onchange={(e) => selectPrintCategory((e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">Hele sangbogen ({songs.length})</option>
				{#each categories as cat (cat)}
					{@const c = songs.filter((s) => (s.categories ?? []).includes(cat)).length}
					<option value={cat}>{cat} ({c})</option>
				{/each}
			</select>
			<button
				type="button"
				class="pdf-choice"
				onclick={handlePdfBook}
				disabled={printCount === 0 || pdfBusy}
				aria-label={printCategory
					? `Lav akkord-PDF for kategorien ${printCategory}`
					: 'Lav akkord-PDF for hele sangbogen'}
			>
				{pdfBusy ? 'Genererer…' : 'Akkorder'}
			</button>
			<button
				type="button"
				class="pdf-choice"
				onclick={handleAudiencePdfBook}
				disabled={printCount === 0 || audiencePdfBusy}
				aria-label={printCategory
					? `Lav publikums-PDF for kategorien ${printCategory}`
					: 'Lav publikums-PDF for hele sangbogen'}
				title="Publikums-PDF uden akkorder"
			>
				{audiencePdfBusy ? 'Genererer…' : 'Tekster'}
			</button>
		</div>

		<div class="ml-auto">
			<input
				type="search"
				placeholder="Søg efter titel, kunstner eller kategori…"
				bind:value={search}
				class="rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-2 text-sm text-[var(--color-ink-on-dark)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
			/>
		</div>
	</div>

	<!-- Kategori-chips -->
	<div class="mb-6 flex flex-wrap gap-2">
		<button
			type="button"
			class="cat-chip"
			class:active={activeCategory === null}
			onclick={() => selectSongbookCategory(null)}
		>
			Alle ({songs.length})
		</button>
		{#each recentCategories as cat (cat)}
			{@const count = songs.filter((s) => (s.categories ?? []).includes(cat)).length}
			{@const c = colorForCategory(cat)}
			<button
				type="button"
				class="cat-chip"
				class:active={activeCategory === cat}
				style:--chip-bg={c.bg}
				style:--chip-text={c.text}
				style:--chip-border={c.border}
				onclick={() => selectSongbookCategory(cat)}
			>
				{cat} ({count})
			</button>
		{/each}
		<button type="button" class="cat-manage" onclick={openCategoryEditor}>
			Redigér kategorier
		</button>
	</div>

	<!-- Liste -->
	{#if loadingSongs}
		<div class="card p-8 text-center text-[var(--color-ink-muted)]">Henter sangbog…</div>
	{:else if error}
		<div class="card p-6">
			<p class="text-[var(--color-error)] font-semibold">Kunne ikke hente sange</p>
			<p class="mt-1 text-sm text-[var(--color-ink-muted)]">{error}</p>
		</div>
	{:else if filteredSongs.length === 0}
		<div class="card p-10 text-center">
			{#if songs.length === 0}
				<p class="text-lg font-semibold text-[var(--color-ink)]">Ingen sange endnu</p>
				<p class="mt-2 text-sm text-[var(--color-ink-muted)]">
					Klik på <span class="font-semibold">+ Tilføj sang</span> for at lægge den første sang i sangbogen.
				</p>
			{:else}
				<p class="text-[var(--color-ink-muted)]">Ingen sange matcher dit filter.</p>
			{/if}
		</div>
	{:else}
		<ul class="song-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each filteredSongs as song (song.id)}
				<li>
					<div class="song-card card p-4">
						<a href={`/song/${song.id}`} class="song-card-main">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<h3 class="truncate text-base font-semibold text-[var(--color-ink)]">
									{song.title}
								</h3>
								{#if song.artist}
									<p class="truncate text-sm text-[var(--color-ink-muted)]">{song.artist}</p>
								{/if}
							</div>
							{#if song.key}
								<span
									class="shrink-0 rounded-full bg-[var(--color-chord-soft)] px-2 py-0.5 text-xs font-bold text-[var(--color-chord)]"
								>
									{song.key}
								</span>
							{/if}
						</div>
						</a>
						{#if (song.categories ?? []).length > 0}
							<div class="song-card-categories" aria-label={`Kategorier for ${song.title}`}>
								{#each displayCategoriesForSong(song) as cat (cat)}
									{@const c = colorForCategory(cat)}
									<button
										type="button"
										class="cat-pill"
										class:highlighted={cat === highlightedCategoryForSong(song)}
										style:background={c.bg}
										style:color={c.text}
										style:border-color={c.border}
										onclick={() => searchByCategory(cat)}
									>{cat}</button>
								{/each}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if editingCategories}
		<CategoryMetaDialog
			categories={allCategoryNames}
			metaMap={categoryMetaMap}
			saving={categorySaving}
			uploading={categoryUploading}
			error={categoryError}
			onClose={() => (editingCategories = false)}
			onAddCategory={addCategoryMeta}
			onRenameCategory={renameCategory}
			onDeleteCategory={deleteCategoryMeta}
			onSave={saveEditingCategory}
			onUploadImage={uploadEditingCategoryImage}
			onRemoveImage={removeEditingCategoryImage}
		/>
	{/if}

	{#if editingProfile && authState.profile}
		<ProfileDialog
			displayName={authState.profile.displayName}
			email={authState.profile.email}
			members={profileMembers}
			loadingMembers={profileLoading}
			saving={profileSaving}
			inviting={profileInviting}
			removingUid={profileRemovingUid}
			canRemoveMembers={canManageMembers}
			currentUserUid={authState.user?.uid}
			error={profileError}
			onClose={() => (editingProfile = false)}
			onSaveProfile={saveProfile}
			onInvite={inviteMember}
			onRemoveMember={removeMember}
		/>
	{/if}
</main>

<style>
	.profile-name-button {
		margin: 0;
		border: 0;
		background: transparent;
		color: var(--color-ink-on-dark);
		padding: 0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: transparent;
		text-underline-offset: 0.18em;
		transition: color 120ms ease, text-decoration-color 120ms ease;
	}

	.profile-name-button:hover {
		color: var(--color-accent);
		text-decoration-color: currentColor;
	}

	.cat-chip {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		border: 1px solid var(--chip-border, var(--color-border));
		background: var(--chip-bg, rgba(255, 255, 255, 0.04));
		color: var(--chip-text, var(--color-ink-on-dark));
		font-size: 0.85rem;
		font-weight: 600;
		transition: filter 120ms ease, transform 120ms ease;
	}
	.cat-chip:hover {
		filter: brightness(0.96);
		transform: translateY(-1px);
	}
	.cat-chip.active {
		background: var(--color-accent);
		color: #ffffff;
		border-color: var(--color-accent);
		box-shadow: 0 4px 12px rgba(217, 119, 6, 0.25);
	}
	.cat-manage {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		border: 1px dashed var(--color-ink-faint);
		background: transparent;
		color: var(--color-ink-on-dark);
		font-size: 0.85rem;
		font-weight: 700;
	}
	.cat-manage:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.song-card {
		height: 8.75rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-width: 0;
		transition: transform 120ms ease, box-shadow 120ms ease;
	}
	.song-card-main {
		display: block;
		color: inherit;
		text-decoration: none;
		min-width: 0;
	}
	.song-card:hover {
		transform: translateY(-1px);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 10px 28px rgba(15, 23, 42, 0.28);
	}
	.cat-pill {
		flex: 0 0 auto;
		padding: 0.08rem 0.42rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: #92400e;
		font-size: 0.64rem;
		line-height: 1.25;
		font-weight: 600;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	button.cat-pill {
		cursor: pointer;
		transition: filter 120ms ease, transform 120ms ease;
	}
	button.cat-pill:hover {
		filter: brightness(0.96);
		transform: translateY(-1px);
	}
	.cat-pill.highlighted {
		box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.22);
	}
	.song-card-categories {
		margin-top: 0.5rem;
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.05rem 0 0.2rem;
		scrollbar-width: thin;
	}
	.song-card-categories::-webkit-scrollbar {
		height: 5px;
	}
	.song-card-categories::-webkit-scrollbar-thumb {
		background: #d1d5db;
		border-radius: 999px;
	}
	.print-group {
		display: inline-flex;
		align-items: stretch;
		border-radius: var(--radius-button);
		overflow: hidden;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 20px rgba(15, 23, 42, 0.12);
	}
	.print-select {
		appearance: none;
		-webkit-appearance: none;
		background: #ffffff
			url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%23374151' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>")
			no-repeat right 0.85rem center;
		border: 1px solid var(--color-border-subtle);
		border-right: 0;
		border-radius: var(--radius-button) 0 0 var(--radius-button);
		padding: 0 2.25rem 0 1rem;
		color: var(--color-ink);
		font-weight: 500;
		font-size: 0.86rem;
		min-width: 12rem;
		cursor: pointer;
	}
	.print-select:focus {
		outline: 2px solid var(--color-accent);
		outline-offset: -1px;
	}
	.pdf-choice {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-subtle);
		border-left: 0;
		background: rgba(255, 255, 255, 0.94);
		color: var(--color-ink);
		padding: 0.88rem 1.2rem;
		font-size: 0.86rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		transition: background 120ms ease, color 120ms ease;
	}
	.pdf-choice:hover {
		background: #f8fafc;
	}
	.pdf-choice:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.print-group .pdf-choice {
		border-radius: 0 !important;
	}
	.print-group .pdf-choice:last-child {
		border-radius: 0 var(--radius-button) var(--radius-button) 0 !important;
	}
</style>
