// Elvie config schema, defaults, and presets.

export const ELVIE_CONFIG_VERSION = 'elvie-config-v1';

export const DICOMWEB_PRESETS = [
  { label: 'Elvie Server (localhost)',    url: 'http://localhost:8042/dicom-web' },
  { label: 'Legacy proxy (/orthanc/...)', url: '/orthanc/dicom-web' },
];

export const LLM_PRESETS = [
  { label: 'LM Studio (localhost:1234)',  url: 'http://localhost:1234/v1' },
  { label: 'Ollama (localhost:11434)',    url: 'http://localhost:11434/v1' },
  { label: 'vLLM (localhost:8000)',       url: 'http://localhost:8000/v1' },
  { label: 'OpenAI',                      url: 'https://api.openai.com/v1' },
];

export const MODEL_SUGGESTIONS = [
  'gpt-4o',
  'gpt-4o-mini',
  'llama-3.3-70b-instruct',
  'qwen2.5:14b',
  'gemma3:27b',
];

export function getDefaultConfig() {
  return {
    dicomweb: { baseUrl: '' },
    ai:       { baseUrl: '', apiKey: '', chatModel: '', parserModel: '' },
    ocr:      { enabled: false, baseUrl: '', model: '' },
    tts:      { enabled: false, baseUrl: '' },
    whisper:  { enabled: false, baseUrl: '' },
    bridge:   { enabled: false, baseUrl: '' },
  };
}
