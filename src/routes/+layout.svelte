<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { authState } from '$lib/auth.svelte';

	let { children } = $props();

	onMount(() => authState.init());
</script>

<div class="min-h-dvh">
	{@render children()}
</div>
