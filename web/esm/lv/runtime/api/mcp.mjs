import { createLvRunCommandEnvelope } from '../schema.mjs';

export async function executeLvRunMcpTool(commandBus, toolInput = {}, options = {}) {
  if (!commandBus || typeof commandBus.dispatchViewerCommand !== 'function') {
    throw new Error('executeLvRunMcpTool requires a LV Run commandBus');
  }
  const command = toolInput.command || toolInput;
  const envelope = createLvRunCommandEnvelope(command, options.defaults || {});
  const result = await commandBus.dispatchViewerCommand(envelope, options);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: true, command: envelope, result })
      }
    ]
  };
}
