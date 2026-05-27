# Elvie Viewer — Agent Control API

AI agents (OpenClaw, Hermes, Codex, Claude, custom) can control the viewer to navigate findings, adjust layout, and orchestrate radiology review workflows. When a user asks an agent to "show the meniscal tear" or "set up a knee MRI layout", the agent dispatches commands to the viewer which responds in real time.

## Integration

The viewer exposes `window.dispatchViewerCommand` as its command interface. Agent frameworks connect to this surface via:

- **MCP**: use `web/esm/lv/runtime/api/mcp.mjs` — a thin adapter that wraps `dispatchViewerCommand` as an MCP tool handler
- **REST**: use `web/esm/lv/runtime/api/rest.mjs` — same pattern for HTTP integrations
- **Direct JS**: call `window.dispatchViewerCommand` directly from any JS context with access to the page

Both adapter modules take a `commandBus` (the viewer's runtime, available at `window.lvApp`) and forward to `dispatchViewerCommand`.

---

## Command envelope

```json
{
  "type": "setWindowPreset",
  "payload": { "preset": "lung" }
}
```

```ts
interface CommandEnvelope {
  type: string;       // canonical command name (see list below)
  payload?: object;   // command-specific params
  id?: string;        // optional request ID
}
```

`type` is canonicalized before dispatch — legacy aliases (`switch_series`, `runPlaybook`, `applyHP`, etc.) are accepted.

---

## Command reference

### State & discovery

| Command | Key params | Description |
|---|---|---|
| `getViewerState` | — | Layout, active pane, per-pane series info |
| `getSeriesCatalog` | — | All series in the open study |
| `getViewportCatalog` | — | Pane positions with series assignments |
| `getWindowLevelPresets` | — | Available WL preset names and values |
| `getCommandHistory` | — | Log of recent commands with results |

### Layout

| Command | Key params | Description |
|---|---|---|
| `setLayout` | `rows`, `columns` | Set grid only |
| `loadView` | `layout`, `series?` | Set grid + assign series atomically |
| `loadSeriesInPane` | `seriesNumber`, `paneId` | Load a series into a specific pane |
| `applyHangingProtocol` | `protocolId` | Apply a built-in hanging protocol by ID |
| `listHangingProtocols` | — | List available built-in protocols |
| `getHangingProtocolState` | — | Current protocol and slot assignments |

### Navigation

| Command | Key params | Description |
|---|---|---|
| `setActivePane` | `paneId` | Focus a pane |
| `scrollPaneBy` | `delta`, `paneId?` | Relative scroll |
| `scrollPaneToIndex` | `index`, `paneId?` | Absolute scroll by slice index |
| `scrollPaneToImageNumber` | `imageNumber`, `paneId?` | Jump to DICOM image number |
| `scrollPaneToPatientPoint` | `point`, `paneId?` | Jump to 3-D patient coordinate |
| `jumpToFinding` | `findingId`, `accession?` | Navigate to a finding's image |
| `replayFindingPreview` | `findingId`, `accession?` | Replay cine preview for a finding |

### Display

| Command | Key params | Description |
|---|---|---|
| `setWindowPreset` | `preset`, `paneId?` | Named WL preset: `soft_tissue`, `lung`, `liver`, `bone`, `brain`, `brain_hemorrhage`, `brain_stroke`, `reset` |
| `setWindowLevel` | `windowWidth`, `windowCenter`, `paneId?` | Explicit WL values |
| `zoomPane` | `scale`, `paneId?` | 1.0 = fit, 2.0 = 2× |
| `panPane` | `deltaX`, `deltaY`, `paneId?` | Pixels; negative = left/up |
| `resetPaneCamera` | `target?`, `paneId?` | `wl`, `zoom`, `pan`, `cine`, or omit for all |
| `resetViewer` | — | Reset all panes |
| `cinePane` | `action`, `fps?`, `reverse?`, `mode?`, `paneId?` | Auto-scroll playback. `action`: `play`, `stop`, `toggle`. `mode`: `loop`, `bounce` |

### Sync

| Command | Key params | Description |
|---|---|---|
| `setLinkedScrollEnabled` | `enabled` | Sync scroll across panes |
| `setReferenceLinesEnabled` | `enabled` | Show reference lines |
| `setCrosshairEnabled` | `enabled` | Enable crosshair sync |
| `toggleCrosshairEnabled` | — | Toggle crosshair |
| `syncPanesToPoint` | `point` | Sync all panes to a patient point |

### Reports & findings

| Command | Key params | Description |
|---|---|---|
| `parseReportLocal` | `accession`, `reportText?`, `endpoint`, `model` | Parse a radiology report via local LLM |
| `listReports` | — | List loaded reports |
| `getReport` | `accession` | Get report by accession |
| `listFindings` | `accession?` | List all findings |
| `getFinding` | `findingId`, `accession?` | Get a single finding |
| `resolveFinding` | `findingId`, `accession?` | Resolve image reference for a finding |
| `upsertFindings` | `accession`, `findings` | Insert or update findings |

### Playbooks

| Command | Key params | Description |
|---|---|---|
| `executePlaybook` | `steps`, `accession?`, `findingSource?` | Run an inline playbook |
| `getPlaybookHistory` | — | Results from the last playbook run |

---

## Playbooks

A playbook is a scripted sequence of viewer commands constructed on the fly from context (report findings, user request). Nothing is saved — one round trip, one result.

### Run an inline playbook

```json
{
  "type": "executePlaybook",
  "payload": {
    "id": "agent-knee-review",
    "steps": [
      {
        "type": "command",
        "command": "loadView",
        "params": { "layout": "2x2", "series": ["Sag PD", "Sag T2", "Cor PD FS", null] },
        "on_error": "abort"
      },
      { "type": "wait", "ms": 300 },
      {
        "type": "command",
        "command": "setWindowPreset",
        "params": { "preset": "soft_tissue" },
        "on_error": "continue"
      }
    ]
  }
}
```

### Playbook step types

| Type | Required fields | Description |
|---|---|---|
| `command` | `command`, `params?`, `on_error?` | Execute one viewer command. `on_error`: `abort` (default) or `continue` |
| `reportFinding` | `finding`, `accession?`, `paneId?` | Navigate to a finding by ID, label, or series/image |
| `wait` | `ms` | Pause execution |
| `repeat` | `times`, `step` or `steps` | Execute a step or step list N times |
| `note` | `message` | Log annotation only — no viewer action |

### `reportFinding` step

```json
{
  "type": "reportFinding",
  "accession": "NI9f7ff9",
  "finding": {
    "findingId": 1,
    "windowPreset": "soft_tissue",
    "replayFindingPreview": true
  },
  "on_error": "continue"
}
```

Finding can also be matched by `labelContains`, `seriesNumber` + `imageNumber`, or `textContains`.

### `executePlaybook` result

```ts
{
  ok: boolean;
  status: 'success' | 'partial' | 'failed';
  steps_total: number;
  steps_completed: number;
  findingsVisited: Array<{ id: string; confidence: number | null }>;
  warnings: object[];
  errors: object[];
  durationMs: number;
}
```

`status: 'partial'` means some `on_error: continue` steps were skipped — inspect `warnings`.
