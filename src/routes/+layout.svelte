<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { authState } from '$lib/auth.svelte';
	import { BUILD_TIME, BUILD_TIME_LABEL } from '$lib/buildInfo';

	let { children } = $props();

	onMount(() => authState.init());
</script>

<div class="min-h-dvh">
	<main>
		{@render children()}
	</main>
	<footer
		class="no-print fixed right-2 bottom-2 z-50 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[11px] text-white/80 shadow-sm backdrop-blur"
		title={`Build: ${BUILD_TIME}`}
	>
		Deploy: {BUILD_TIME_LABEL}
	</footer>
</div>
