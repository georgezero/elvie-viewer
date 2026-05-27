import { createLvRunCommandBus } from '../runtime/commandBus.mjs';

// Backward-compatible export retained while migrating from lv-bridge naming
// to the LV Run runtime layer.
export function createViewerCommandBus({ actions, runtime } = {}) {
  return createLvRunCommandBus({ actions, runtime });
}
