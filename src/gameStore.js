/**
 * gameStore.js — Reactive bridge between the vanilla Game class and Preact components.
 *
 * Now powered by Zustand under the hood (via zustand-store.js).
 * The API remains identical: gameStore.set(), gameStore.get(), gameStore.subscribe(), gameStore.reset().
 * All existing imports continue to work unchanged.
 */
export { gameStore } from './zustand-store.js';
