import { createLvRunCommandEnvelope } from '../schema.mjs';

export async function executeLvRunRestCommand(commandBus, requestBody = {}, options = {}) {
  if (!commandBus || typeof commandBus.dispatchViewerCommand !== 'function') {
    throw new Error('executeLvRunRestCommand requires a LV Run commandBus');
  }
  const envelope = createLvRunCommandEnvelope(requestBody, options.defaults || {});
  const result = await commandBus.dispatchViewerCommand(envelope, options);
  return {
    ok: true,
    command: envelope,
    result
  };
}
