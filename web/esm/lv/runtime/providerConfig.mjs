const ELVIE_LLM_PRESETS = [
  { label: 'LM Studio (localhost:1234)',  url: 'http://localhost:1234/v1' },
  { label: 'Ollama (localhost:11434)',    url: 'http://localhost:11434/v1' },
  { label: 'vLLM (localhost:8000)',       url: 'http://localhost:8000/v1' },
  { label: 'OpenAI',                      url: 'https://api.openai.com/v1' },
];

const ELVIE_MODEL_SUGGESTIONS = [
  'gpt-4o',
  'gpt-4o-mini',
  'llama-3.3-70b-instruct',
  'qwen2.5:14b',
  'gemma3:27b',
];


export function getDefaultBridgeUrl(_options = {}) {
  return '';
}

export function getDefaultLlmUrl(_options = {}) {
  return '';
}

export function getDefaultModel() {
  return '';
}

export function getModelPresets() {
  return [...ELVIE_MODEL_SUGGESTIONS];
}

export function getLlmPresets() {
  return ELVIE_LLM_PRESETS.map(p => ({ label: p.label, lan: p.url, proxyPath: p.url }));
}

export function getDefaultWhisperUrl(_options = {}) {
  return '';
}

export function getDefaultOmnivoiceUrl() {
  return '';
}

export function resolveLlmEndpoint(presetOrUrl, _options = {}) {
  const value = String(presetOrUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return value;
}

export const PROVIDER_CONFIG_VERSION = 'elvie-provider-config-v1';
