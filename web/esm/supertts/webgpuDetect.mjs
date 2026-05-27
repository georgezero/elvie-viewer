export async function detectWebGPU() {
  if (!('gpu' in navigator)) {
    return { supported: false, reason: 'navigator.gpu not present (requires secure context + Chrome 113+/Safari 17+)' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'No WebGPU adapter found (may need flags or hardware support)' };
    }
    const info = adapter.info ?? await adapter.requestAdapterInfo().catch(() => null);
    const device = await adapter.requestDevice();
    device.destroy();
    return {
      supported: true,
      vendor: info?.vendor ?? 'unknown',
      architecture: info?.architecture ?? 'unknown',
      deviceName: info?.device ?? 'unknown',
      description: info?.description ?? '',
    };
  } catch (e) {
    return { supported: false, reason: e.message };
  }
}

export function detectWASM() {
  try {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  } catch {
    return false;
  }
}

export function chooseDevice(gpuResult) {
  if (gpuResult.supported) return 'webgpu';
  if (detectWASM()) return 'wasm';
  return null;
}
