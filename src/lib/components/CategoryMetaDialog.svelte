<script lang="ts">
	import type { CategoryMeta } from '$lib/types';

	interface Props {
		categories: string[];
		metaMap: Record<string, CategoryMeta>;
		saving?: boolean;
		uploading?: boolean;
		error?: string | null;
		onClose: () => void;
		onAddCategory: (category: string) => void;
		onRenameCategory: (from: string, to: string) => void | Promise<void>;
		onDeleteCategory: (category: string) => void;
		onSave: (category: string, meta: CategoryMeta) => void | Promise<void>;
		onUploadImage: (category: string, file: File) => void;
		onRemoveImage: (category: string) => void;
	}

	const {
		categories,
		metaMap,
		saving = false,
		uploading = false,
		error = null,
		onClose,
		onAddCategory,
		onRenameCategory,
		onDeleteCategory,
		onSave,
		onUploadImage,
		onRemoveImage
	}: Props = $props();

	let selectedCategory = $state('');
	let newCategory = $state('');
	let displayName = $state('');
	let introText = $state('');
	const meta = $derived(metaMap[selectedCategory] ?? {});

	$effect(() => {
		if (!selectedCategory && categories.length > 0) selectedCategory = categories[0];
	});

	$effect(() => {
		if (selectedCategory && !categories.includes(selectedCategory)) {
			selectedCategory = categories[0] ?? '';
		}
	});

	$effect(() => {
		displayName = selectedCategory;
		introText = meta.introText ?? '';
	});

	async function handleSubmit() {
		if (!selectedCategory) return;
		const nextName = displayName.trim();
		const categoryToSave = nextName || selectedCategory;
		const metaToSave = {
			...meta,
			introText: introText.trim()
		};
		try {
			if (nextName && nextName !== selectedCategory) {
				await onRenameCategory(selectedCategory, nextName);
				selectedCategory = nextName;
			}
			await onSave(categoryToSave, metaToSave);
			onClose();
		} catch {
			// Parent sets the visible error; keep the modal open.
		}
	}

	function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !selectedCategory) return;
		onUploadImage(selectedCategory, file);
		input.value = '';
	}

	function handleAddCategory() {
		const trimmed = newCategory.trim();
		if (!trimmed) return;
		onAddCategory(trimmed);
		selectedCategory = trimmed;
		newCategory = '';
	}

	function handleDeleteCategory() {
		if (!selectedCategory) return;
		onDeleteCategory(selectedCategory);
	}
</script>

<div class="category-modal-backdrop" role="presentation">
	<button type="button" class="category-modal-dismiss" aria-label="Luk kategori-editor" onclick={onClose}></button>
	<div class="category-modal card" role="dialog" aria-modal="true" aria-labelledby="category-meta-title">
		<header class="category-modal-header">
			<div>
				<p class="category-modal-kicker">Kategorier</p>
				<h2 id="category-meta-title">Redigér publikums-kategorier</h2>
			</div>
		</header>

		<div class="category-admin-grid">
			<aside class="category-list">
				<div class="category-add">
					<input
						type="text"
						bind:value={newCategory}
						placeholder="Ny kategori"
						onkeydown={(e) => {
							if (e.key === 'Enter') handleAddCategory();
						}}
					/>
					<button type="button" class="btn-secondary btn-sm" onclick={handleAddCategory}>Tilføj</button>
				</div>
				<div class="category-list-scroll">
					{#each categories as cat (cat)}
						<button
							type="button"
							class="category-list-item"
							class:active={selectedCategory === cat}
							onclick={() => (selectedCategory = cat)}
						>
							<span>{cat}</span>
							{#if metaMap[cat]?.imageUrl}<small>Billede</small>{/if}
						</button>
					{/each}
				</div>
			</aside>

			<section class="category-editor">
				{#if selectedCategory}
					<div class="category-editor-title">
						<h3>{selectedCategory}</h3>
						<button
							type="button"
							class="btn-secondary btn-sm !text-[var(--color-error)]"
							onclick={handleDeleteCategory}
							disabled={saving || uploading}
							title="Fjerner kategorien fra sange og sletter kategori-metadata."
						>
							Slet kategori
						</button>
					</div>

					<label class="form-label" for="category-name">Navn</label>
					<input id="category-name" class="category-name-input" type="text" bind:value={displayName} />

					<label class="form-label mt" for="category-intro">Introtekst til publikums-sangbog</label>
					<textarea
						id="category-intro"
						bind:value={introText}
						rows="6"
						class="category-textarea"
						placeholder="Skriv en kort intro, der vises på forsiden for denne kategori…"
					></textarea>

					<div class="category-image-block">
						<div>
							<p class="form-label">Forsidebillede</p>
							<p class="category-help">JPG, PNG eller WebP. Bruges kun til publikums-PDF'en.</p>
						</div>
						{#if meta.imageUrl}
							<img class="category-preview" src={meta.imageUrl} alt="" />
						{/if}
						<div class="category-image-actions">
							<label class="btn-secondary btn-sm">
								{uploading ? 'Uploader…' : 'Upload billede'}
								<input
									type="file"
									accept="image/png,image/jpeg,image/webp"
									disabled={uploading || saving}
									onchange={handleFileChange}
								/>
							</label>
							{#if meta.imageUrl}
								<button
									type="button"
									class="btn-secondary btn-sm !text-[var(--color-error)]"
									onclick={() => onRemoveImage(selectedCategory)}
									disabled={uploading || saving}
								>
									Fjern billede
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<p class="category-empty">Tilføj en kategori for at redigere intro og billede.</p>
				{/if}
			</section>
		</div>

		{#if error}
			<p class="category-error">{error}</p>
		{/if}

		<footer class="category-modal-footer">
			{#if selectedCategory}
				<button type="button" class="btn-primary" onclick={handleSubmit} disabled={saving || uploading}>
					{saving ? 'Gemmer…' : 'Gem kategori'}
				</button>
			{/if}
		</footer>
	</div>
</div>

<style>
	.category-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.72);
		backdrop-filter: blur(4px);
	}
	.category-modal-dismiss {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
	}
	.category-modal {
		position: relative;
		z-index: 1;
		width: min(60rem, 100%);
		padding: 1.4rem;
	}
	.category-modal-header,
	.category-modal-footer,
	.category-image-actions,
	.category-editor-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.category-modal-header {
		margin-bottom: 1rem;
	}
	.category-modal-kicker,
	.form-label {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 800;
		color: var(--color-ink-faint);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.form-label.mt {
		display: block;
		margin-top: 0.9rem;
	}
	h2,
	h3 {
		margin: 0.1rem 0 0;
		font-family: var(--font-display);
		color: var(--color-ink);
	}
	h2 {
		font-size: 1.55rem;
	}
	h3 {
		font-size: 1.25rem;
	}
	.category-admin-grid {
		display: grid;
		grid-template-columns: minmax(13rem, 0.85fr) minmax(0, 1.8fr);
		gap: 1rem;
	}
	.category-list {
		border-right: 1px solid var(--color-border-subtle);
		padding-right: 1rem;
	}
	.category-add {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.7rem;
	}
	.category-add input,
	.category-name-input {
		min-width: 0;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border-subtle);
		padding: 0.48rem 0.58rem;
		color: var(--color-ink);
		background: #ffffff;
	}
	.category-add input {
		flex: 1;
	}
	.category-name-input {
		width: 100%;
		margin-top: 0.4rem;
		font-weight: 700;
	}
	.category-list-scroll {
		max-height: 26rem;
		overflow: auto;
		display: grid;
		gap: 0.35rem;
	}
	.category-list-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		border: 1px solid transparent;
		border-radius: 0.55rem;
		background: var(--color-bg-card-muted);
		color: var(--color-ink);
		padding: 0.55rem 0.65rem;
		text-align: left;
		font-weight: 700;
	}
	.category-list-item.active {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}
	.category-list-item small {
		color: var(--color-ink-muted);
		font-size: 0.7rem;
		font-weight: 500;
	}
	.category-editor {
		min-width: 0;
	}
	.category-editor-title {
		margin-bottom: 1rem;
	}
	.category-textarea {
		margin-top: 0.45rem;
		width: 100%;
		border-radius: 0.6rem;
		border: 1px solid var(--color-border-subtle);
		padding: 0.75rem;
		color: var(--color-ink);
		background: #ffffff;
		resize: vertical;
	}
	.category-textarea:focus,
	.category-add input:focus,
	.category-name-input:focus {
		outline: 2px solid var(--color-accent);
		outline-offset: -1px;
	}
	.category-image-block {
		margin-top: 1rem;
		display: grid;
		gap: 0.75rem;
	}
	.category-help,
	.category-empty {
		margin: 0.2rem 0 0;
		color: var(--color-ink-muted);
		font-size: 0.85rem;
	}
	.category-preview {
		width: 100%;
		max-height: 13rem;
		object-fit: cover;
		border-radius: 0.7rem;
		border: 1px solid var(--color-border-subtle);
	}
	input[type='file'] {
		display: none;
	}
	.category-error {
		margin: 0.9rem 0 0;
		color: var(--color-error);
		font-size: 0.9rem;
	}
	.category-modal-footer {
		justify-content: flex-end;
		margin-top: 1.2rem;
	}
	@media (max-width: 760px) {
		.category-admin-grid {
			grid-template-columns: 1fr;
		}
		.category-list {
			border-right: 0;
			border-bottom: 1px solid var(--color-border-subtle);
			padding-right: 0;
			padding-bottom: 1rem;
		}
	}
</style>
