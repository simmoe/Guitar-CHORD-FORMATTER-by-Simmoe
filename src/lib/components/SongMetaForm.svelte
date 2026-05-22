<script lang="ts">
	import { colorForCategory } from '$lib/categoryColors';
	import type { CategoryColorMap } from '$lib/types';

	interface Props {
		title: string;
		artist: string;
		key: string;
		barsPerLine: 2 | 4 | 8;
		categories: string[];
		/** Eksisterende kendte kategorier på tværs af sangbogen — bruges til datalist. */
		knownCategories: string[];
		categoryColors?: CategoryColorMap;
		onRegroupAllBassLines?: (targetBars: 2 | 4) => void;
		onChange: (next: {
			title: string;
			artist: string;
			key: string;
			barsPerLine: 2 | 4 | 8;
			categories: string[];
		}) => void;
	}

	let {
		title,
		artist,
		key,
		barsPerLine,
		categories,
		knownCategories,
		categoryColors = {},
		onRegroupAllBassLines,
		onChange
	}: Props = $props();

	let categoryDraft = $state('');

	function emit(patch: Partial<{
		title: string;
		artist: string;
		key: string;
		barsPerLine: 2 | 4 | 8;
		categories: string[];
	}> = {}) {
		onChange({ title, artist, key, barsPerLine, categories, ...patch });
	}

	function addCategory(cat: string) {
		const trimmed = cat.trim();
		if (!trimmed) return;
		if (categories.includes(trimmed)) return;
		const next = [...categories, trimmed];
		categories = next;
		categoryDraft = '';
		emit({ categories: next });
	}

	function removeCategory(cat: string) {
		const next = categories.filter((c) => c !== cat);
		categories = next;
		emit({ categories: next });
	}

	function onCategoryKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addCategory(categoryDraft);
		}
	}
</script>

<div class="grid gap-4 sm:grid-cols-2">
	<label class="field sm:col-span-2">
		<span>Titel <span class="req">*</span></span>
		<input
			type="text"
			bind:value={title}
			oninput={() => emit({ title })}
			required
			placeholder="fx Summertime"
		/>
	</label>

	<label class="field">
		<span>Kunstner</span>
		<input
			type="text"
			bind:value={artist}
			oninput={() => emit({ artist })}
			placeholder="fx Gershwin"
		/>
	</label>

	<label class="field">
		<span>Toneart</span>
		<input
			type="text"
			bind:value={key}
			oninput={() => emit({ key })}
			placeholder="fx Am, C, G"
		/>
	</label>

	<div class="field">
		<span>Baslinjer</span>
		<div class="bass-bars-actions" aria-label="Gruppér alle baslinjer">
			<button type="button" title="Komprimér alle baslinjer parvist" onclick={() => onRegroupAllBassLines?.(2)}>2</button>
			<button type="button" title="Udvid alle baslinjer parvist" onclick={() => onRegroupAllBassLines?.(4)}>4</button>
		</div>
	</div>

	<div class="field sm:col-span-2">
		<span>Kategorier <em class="text-[var(--color-ink-faint)] font-normal text-xs">(koncerter, fx Summertime, Forår, Julen)</em></span>
		<div class="cat-input-wrap">
			<input
				type="text"
				list="known-categories"
				bind:value={categoryDraft}
				onkeydown={onCategoryKey}
				placeholder="Skriv kategori og tryk Enter…"
			/>
			<button type="button" class="btn-secondary btn-sm" onclick={() => addCategory(categoryDraft)}>
				Tilføj
			</button>
		</div>
		<datalist id="known-categories">
			{#each knownCategories as c (c)}<option value={c}></option>{/each}
		</datalist>
		{#if categories.length > 0}
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#each categories as cat (cat)}
					{@const c = colorForCategory(cat, categoryColors)}
					<span
						class="cat-tag"
						style:background={c.bg}
						style:color={c.text}
						style:border-color={c.border}
					>
						{cat}
						<button
							type="button"
							class="cat-tag-x"
							aria-label={`Fjern ${cat}`}
							onclick={() => removeCategory(cat)}>×</button
						>
					</span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field > span {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-ink-faint);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.req {
		color: var(--color-error);
	}
	.field input,
	.cat-input-wrap input {
		width: 100%;
		padding: 0.55rem 0.75rem;
		border-radius: var(--radius-button);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-ink-on-dark);
		font-size: 0.95rem;
	}
	.field input:focus,
	.cat-input-wrap input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.cat-input-wrap {
		display: flex;
		gap: 0.5rem;
	}
	.bass-bars-actions {
		display: inline-flex;
		gap: 0.25rem;
	}
	.bass-bars-actions button {
		display: grid;
		place-items: center;
		width: 2.25rem;
		min-height: 2.2rem;
		border-radius: var(--radius-button);
		border: 1px solid rgba(255, 255, 255, 0.28);
		background: #16a34a;
		color: #ffffff;
		font-weight: 900;
		cursor: pointer;
	}
	.bass-bars-actions button:hover {
		background: #15803d;
	}
	.cat-input-wrap input {
		flex: 1 1 auto;
	}
	.cat-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: #92400e;
		border: 1px solid transparent;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.cat-tag-x {
		background: transparent;
		border: none;
		color: #92400e;
		font-size: 0.95rem;
		line-height: 1;
		padding: 0;
		cursor: pointer;
	}
	.cat-tag-x:hover {
		color: var(--color-error);
	}
</style>
