import { vi } from 'vitest';

// AC5: unit tests never touch the network. Adapters take an injected fetchImpl.
vi.stubGlobal('fetch', () => {
  throw new Error('live network is forbidden in tests');
});
