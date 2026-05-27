import { createViewerState } from '../viewer/state.mjs';
import { createViewerActions } from '../viewer/actions.mjs';
import { createLvRunCommandBus } from '../runtime/commandBus.mjs';

export function bootstrapLvApp(runtime = {}) {
  const viewerState = createViewerState(runtime);
  const viewerActions = createViewerActions(runtime);
  const commandBus = createLvRunCommandBus({ actions: viewerActions, runtime });

  return {
    viewerState,
    viewerActions,
    commandBus,
    dispatchViewerCommand: commandBus.dispatchViewerCommand
  };
}
