import assert from 'node:assert/strict';
import { applyHangingProtocol } from '../hangingProtocols.mjs';

async function run() {
  const calls = [];
  const dispatchViewerCommand = async (command) => {
    calls.push(command);
    return { ok: true };
  };

  const getViewerStateSnapshot = () => ({
    seriesCatalog: [
      {
        seriesInstanceUID: '1.2.3.lung',
        seriesNumber: 2,
        seriesDescription: 'Lung axial',
        modality: 'CT',
        numInstances: 120
      },
      {
        seriesInstanceUID: '1.2.3.soft',
        seriesNumber: 5,
        seriesDescription: 'Soft tissue',
        modality: 'CT',
        numInstances: 110
      }
    ]
  });

  const result = await applyHangingProtocol(
    { dispatchViewerCommand, getViewerStateSnapshot },
    { protocolId: 'ct-chest-1x2' }
  );

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.results), true);
  assert.equal(calls.some((c) => c.type === 'loadSeriesInPane' && c.payload?.seriesInstanceUID === '1.2.3.lung'), true);
  assert.equal(calls.some((c) => c.type === 'loadSeriesInPane' && c.payload?.seriesInstanceUID === '1.2.3.soft'), true);
}

run()
  .then(() => {
    console.log('hangingProtocols tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
