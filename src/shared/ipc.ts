/**
 * The IPC contract between the renderer and the main process.
 *
 * - `InvokeMap`: request/response channels (renderer → main, ipcRenderer.invoke).
 * - `EventMap`:  push channels (main → renderer, webContents.send).
 *
 * The preload script only forwards channels listed in INVOKE_CHANNELS /
 * EVENT_CHANNELS. Every invoke result travels as an `IpcResult` envelope so
 * errors keep their code and detail across the boundary.
 */
import type { SessionRecap } from './recap'
import type { VaultGraph } from './graph'
import type { CampaignMap, MapPin, MapScale, PartyMarker } from './map'
import type { CampaignConcept, CampaignDraft } from './builder'
import type { PlayMode, Speaker } from './play'
import type {
  AppInfo,
  Campaign,
  CharacterNote,
  CombatState,
  DetectedVault,
  DndSheet,
  ErrorInfo,
  ExtensionInfo,
  ImageModelList,
  UpdateStatus,
  ExtensionPermission,
  Id,
  Lorebook,
  Message,
  MessageImage,
  Party,
  PromptPreview,
  Session,
  TestResult,
  ToastEvent,
  VaultIndex,
  VaultPath,
  VaultValidation,
  WindowState
} from './types'
import type {
  ComfyMapping,
  ImageBackendInput,
  PublicSettings,
  SettingsPatch,
  TextBackendInput
} from './settings'

export interface ComfyNodeSummary {
  id: string
  classType: string
  title?: string
  /** Literal (non-link) inputs that a mapping can target. */
  inputs: { name: string; value: unknown }[]
}

export interface ComfyWorkflowInfo {
  /** File name inside %APPDATA%\DND Tavern\workflows\ (or vault path). */
  file: string
  nodes: ComfyNodeSummary[]
  /** Best guess at which node inputs receive the prompt, seed, size… */
  guess: ComfyMapping
}

export interface MessagePatch {
  text?: string
  swipeIndex?: number
  hidden?: boolean
}

type Invoke<A extends unknown[], R> = { args: A; result: R }

export interface InvokeMap {
  // App and window
  'app:getInfo': Invoke<[], AppInfo>
  'app:openExternal': Invoke<[url: string], void>
  /** In-app updates. */
  'updates:status': Invoke<[], UpdateStatus>
  'updates:check': Invoke<[], UpdateStatus>
  'updates:download': Invoke<[], void>
  'updates:install': Invoke<[], void>
  /** Shows a native right-click menu; resolves to the chosen item's id (null if dismissed). */
  'app:contextMenu': Invoke<[items: ContextMenuItem[]], string | null>
  'app:openFolder': Invoke<[which: 'userData' | 'extensions' | 'workflows'], void>
  'window:minimize': Invoke<[], void>
  'window:toggleMaximize': Invoke<[], void>
  'window:close': Invoke<[], void>
  'window:getState': Invoke<[], WindowState>

  // Settings
  'settings:get': Invoke<[], PublicSettings>
  'settings:update': Invoke<[patch: SettingsPatch], PublicSettings>
  'settings:export': Invoke<[opts: { includeKeys: boolean }], { path: string } | null>
  'settings:import': Invoke<[], PublicSettings | null>

  // Text backends
  'textBackends:save': Invoke<[backend: TextBackendInput], PublicSettings>
  'textBackends:delete': Invoke<[id: Id], PublicSettings>
  'textBackends:duplicate': Invoke<[id: Id], PublicSettings>
  'textBackends:reorder': Invoke<[ids: Id[]], PublicSettings>
  'textBackends:test': Invoke<[backend: TextBackendInput], TestResult>
  /** Model switchers: list a saved backend's models; make a backend (and model) the active one. */
  'textBackends:models': Invoke<[id: string], string[]>
  'textBackends:use': Invoke<[id: string, model?: string], PublicSettings>
  'imageBackends:models': Invoke<[id: string], ImageModelList>
  'imageBackends:use': Invoke<[id: string, choice?: { model?: string; workflowId?: string }], PublicSettings>
  'textBackends:fetchModels': Invoke<[backend: TextBackendInput], string[]>

  // Image backends
  'imageBackends:save': Invoke<[backend: ImageBackendInput], PublicSettings>
  'imageBackends:delete': Invoke<[id: Id], PublicSettings>
  'imageBackends:duplicate': Invoke<[id: Id], PublicSettings>
  'imageBackends:reorder': Invoke<[ids: Id[]], PublicSettings>
  'imageBackends:test': Invoke<[backend: ImageBackendInput, workflowId?: Id], TestResult>
  'comfy:importWorkflow': Invoke<[], ComfyWorkflowInfo | null>
  'comfy:inspectWorkflow': Invoke<[file: string, location: 'appdata' | 'vault'], ComfyWorkflowInfo>

  // Vault
  'vault:detect': Invoke<[], DetectedVault[]>
  'vault:pick': Invoke<[], string | null>
  'vault:validate': Invoke<[path: string], VaultValidation>
  'vault:configure': Invoke<[opts: { path: string; rootFolder: string }], VaultIndex>
  /** Notes and their links, for the graph view. */
  'vault:graph': Invoke<[], VaultGraph>
  'vault:getIndex': Invoke<[], VaultIndex | null>
  'vault:readNote': Invoke<[path: VaultPath], { path: VaultPath; content: string }>
  'vault:searchNotes': Invoke<[query: string], { path: VaultPath; name: string }[]>
  'vault:openInObsidian': Invoke<[path: VaultPath], void>
  'vault:createSampleCampaign': Invoke<[], { index: VaultIndex; campaignPath: VaultPath; sessionPath: VaultPath; characterPath: VaultPath }>
  'vault:readImage': Invoke<[path: VaultPath], string>

  // Characters
  'characters:get': Invoke<[path: VaultPath], CharacterNote>
  /** `force` overwrites changes made on disk since the note was loaded. */
  'characters:save': Invoke<[note: CharacterNote, force?: boolean], CharacterNote>
  'characters:create': Invoke<[name: string, npc?: boolean], CharacterNote>
  'characters:delete': Invoke<[path: VaultPath], void>
  'characters:import': Invoke<[], CharacterNote[]>
  'characters:export': Invoke<[path: VaultPath, format: 'json' | 'png'], { path: string } | null>
  'characters:setAvatar': Invoke<[path: VaultPath], CharacterNote | null>
  /** Merges sheet fields into the latest version of the note (null removes the sheet). */
  'characters:updateSheet': Invoke<[path: VaultPath, patch: Partial<DndSheet> | null], CharacterNote>

  // Campaigns and lorebooks
  /** Campaign builder: an AI draft from a concept, then the reviewed draft written to the vault. */
  'campaigns:draft': Invoke<[concept: CampaignConcept], CampaignDraft>
  'campaigns:build': Invoke<
    [draft: CampaignDraft, opts: { mode: PlayMode; session: boolean; characterPath?: VaultPath }],
    { index: VaultIndex; campaignPath: VaultPath; sessionPath: VaultPath | null }
  >
  /** Campaign maps (image, pins, party marker) kept in a "type: map" note. */
  'maps:get': Invoke<[campaignPath: VaultPath], CampaignMap>
  'maps:save': Invoke<[campaignPath: VaultPath, map: { image: string; pins: MapPin[]; party: PartyMarker | null; aspect?: number; scale?: MapScale | null }], CampaignMap>
  'maps:importImage': Invoke<[campaignPath: VaultPath], string | null>
  'maps:images': Invoke<[campaignPath: VaultPath], string[]>
  'maps:generate': Invoke<[campaignPath: VaultPath, extra?: string], string>
  'campaigns:get': Invoke<[path: VaultPath], { campaign: Campaign; party: Party }>
  'campaigns:create': Invoke<[name: string], Campaign>
  'campaigns:saveParty': Invoke<[path: VaultPath, party: Party], Party>
  'lorebooks:get': Invoke<[path: VaultPath], Lorebook>
  'lorebooks:save': Invoke<[book: Lorebook, force?: boolean], Lorebook>
  'lorebooks:create': Invoke<[name: string], Lorebook>
  'campaigns:setLorebooks': Invoke<[campaignPath: VaultPath, lorebookPaths: VaultPath[]], Campaign>
  'presets:get': Invoke<[path: VaultPath], { path: VaultPath; name: string; system_prompt: string; dm_mode: boolean }>
  'presets:create': Invoke<[name: string], VaultPath>
  'presets:save': Invoke<[path: VaultPath, systemPrompt: string], void>

  // Sessions
  'sessions:get': Invoke<[path: VaultPath], Session>
  /** Compress a session into its recap now (force) or if it is out of date. */
  'sessions:compress': Invoke<[path: VaultPath, force?: boolean], Session | null>
  /** Recaps of the sessions before this one in its campaign, oldest first. */
  'sessions:recaps': Invoke<[path: VaultPath, limit: number], SessionRecap[]>
  'sessions:create': Invoke<
    [opts: { campaignPath: VaultPath; characterPath?: VaultPath; title?: string; mode?: PlayMode }],
    Session
  >
  'sessions:fork': Invoke<[path: VaultPath, messageId: Id], Session>
  'sessions:post': Invoke<[path: VaultPath, message: Omit<Message, 'id' | 'createdAt'>], Session>
  'sessions:updateMessage': Invoke<[path: VaultPath, id: Id, patch: MessagePatch], Session>
  'sessions:deleteMessage': Invoke<[path: VaultPath, id: Id], Session>
  'sessions:saveCombat': Invoke<[path: VaultPath, combat: CombatState | null], Session>
  'sessions:updateMeta': Invoke<
    [path: VaultPath, patch: { title?: string; persona?: string; characterPath?: VaultPath | null; summary?: string; mode?: PlayMode }],
    Session
  >
  'sessions:undoState': Invoke<[path: VaultPath, messageId: Id], Session>

  // Chat generation (tokens arrive as chat:* events)
  /** Posts the user's text (in their role for the session's mode) and starts the next AI reply. */
  'chat:send': Invoke<[opts: { sessionPath: VaultPath; text: string; persona?: string; speaker?: Speaker }], { requestId: Id }>
  'chat:regenerate': Invoke<[opts: { sessionPath: VaultPath }], { requestId: Id }>
  'chat:continue': Invoke<[opts: { sessionPath: VaultPath }], { requestId: Id }>
  'chat:stop': Invoke<[requestId: Id], void>
  /** Three AI ideas for the user's next move (tips bubble). */
  'chat:ideas': Invoke<[sessionPath: VaultPath], string[]>
  'chat:inspectPrompt': Invoke<[opts: { sessionPath: VaultPath }], PromptPreview>

  // Images (progress arrives as images:* events)
  'images:generate': Invoke<
    [
      opts: {
        sessionPath?: VaultPath
        kind: 'prompt' | 'scene' | 'portrait'
        prompt?: string
        characterPath?: VaultPath
        /** For "scene": illustrate this message (default: the latest messages). */
        messageId?: Id
        backendId?: Id
        workflowId?: Id
      }
    ],
    { requestId: Id }
  >
  'images:cancel': Invoke<[requestId: Id], void>

  // Extensions
  'extensions:list': Invoke<[], ExtensionInfo[]>
  'extensions:setEnabled': Invoke<
    [id: string, enabled: boolean, granted: ExtensionPermission[]],
    ExtensionInfo[]
  >
  'extensions:runCommand': Invoke<
    [opts: { extensionId: string; command: string; args: string; sessionPath?: VaultPath }],
    void
  >
  'extensions:saveSettings': Invoke<[id: string, values: Record<string, unknown>], ExtensionInfo[]>
  'extensions:reload': Invoke<[], ExtensionInfo[]>
  /** Context for an extension's UI panel (session summary and its own settings). */
  'extensions:uiState': Invoke<[id: string, sessionPath?: VaultPath], unknown>
}

/** One entry of a native menu the UI asks for (app:contextMenu). */
export interface ContextMenuItem {
  id: string
  label: string
  enabled?: boolean
  /** Shown as a hint only (e.g. "Ctrl+R"). */
  accelerator?: string
  type?: 'separator'
}

export interface EventMap {
  'settings:changed': PublicSettings
  'window:state': WindowState
  'toast': ToastEvent
  'updates:changed': UpdateStatus
  'vault:index': VaultIndex
  'vault:changed': { path: VaultPath; event: 'add' | 'change' | 'unlink' }
  'session:updated': Session
  'chat:started': { requestId: Id; sessionPath: VaultPath; messageId: Id; backendName: string; speaker: Speaker; speakerName?: string }
  'chat:token': { requestId: Id; delta: string }
  'chat:done': { requestId: Id; session: Session }
  'chat:error': { requestId: Id; error: ErrorInfo }
  'images:progress': { requestId: Id; value: number; label?: string }
  'images:done': { requestId: Id; image: MessageImage; session?: Session }
  'images:error': { requestId: Id; error: ErrorInfo }
  'extensions:notify': { extensionId: string; message: string }
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap
export type InvokeArgs<C extends InvokeChannel> = InvokeMap[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeMap[C]['result']

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ErrorInfo }

/**
 * Runtime allow-lists for the preload. `satisfies` makes the compiler reject a
 * list that is missing a channel or names one that doesn't exist.
 */
const invokeChannels = {
  'app:getInfo': 1,
  'app:openExternal': 1,
  'updates:status': 1,
  'updates:check': 1,
  'updates:download': 1,
  'updates:install': 1,
  'app:contextMenu': 1,
  'app:openFolder': 1,
  'window:minimize': 1,
  'window:toggleMaximize': 1,
  'window:close': 1,
  'window:getState': 1,
  'settings:get': 1,
  'settings:update': 1,
  'settings:export': 1,
  'settings:import': 1,
  'textBackends:save': 1,
  'textBackends:delete': 1,
  'textBackends:duplicate': 1,
  'textBackends:reorder': 1,
  'textBackends:test': 1,
  'textBackends:fetchModels': 1,
  'textBackends:models': 1,
  'textBackends:use': 1,
  'imageBackends:models': 1,
  'imageBackends:use': 1,
  'imageBackends:save': 1,
  'imageBackends:delete': 1,
  'imageBackends:duplicate': 1,
  'imageBackends:reorder': 1,
  'imageBackends:test': 1,
  'comfy:importWorkflow': 1,
  'comfy:inspectWorkflow': 1,
  'vault:detect': 1,
  'vault:pick': 1,
  'vault:validate': 1,
  'vault:configure': 1,
  'vault:getIndex': 1,
  'vault:graph': 1,
  'vault:readNote': 1,
  'vault:searchNotes': 1,
  'vault:openInObsidian': 1,
  'vault:createSampleCampaign': 1,
  'vault:readImage': 1,
  'characters:get': 1,
  'characters:save': 1,
  'characters:create': 1,
  'characters:delete': 1,
  'characters:import': 1,
  'characters:export': 1,
  'characters:setAvatar': 1,
  'characters:updateSheet': 1,
  'campaigns:get': 1,
  'maps:get': 1,
  'maps:save': 1,
  'maps:importImage': 1,
  'maps:images': 1,
  'maps:generate': 1,
  'campaigns:draft': 1,
  'campaigns:build': 1,
  'campaigns:create': 1,
  'campaigns:saveParty': 1,
  'lorebooks:get': 1,
  'lorebooks:save': 1,
  'lorebooks:create': 1,
  'campaigns:setLorebooks': 1,
  'presets:get': 1,
  'presets:create': 1,
  'presets:save': 1,
  'sessions:compress': 1,
  'sessions:recaps': 1,
  'sessions:get': 1,
  'sessions:create': 1,
  'sessions:fork': 1,
  'sessions:post': 1,
  'sessions:updateMessage': 1,
  'sessions:deleteMessage': 1,
  'sessions:saveCombat': 1,
  'sessions:updateMeta': 1,
  'sessions:undoState': 1,
  'chat:send': 1,
  'chat:regenerate': 1,
  'chat:continue': 1,
  'chat:stop': 1,
  'chat:inspectPrompt': 1,
  'chat:ideas': 1,
  'images:generate': 1,
  'images:cancel': 1,
  'extensions:list': 1,
  'extensions:setEnabled': 1,
  'extensions:runCommand': 1,
  'extensions:saveSettings': 1,
  'extensions:reload': 1,
  'extensions:uiState': 1
} satisfies Record<InvokeChannel, 1>

const eventChannels = {
  'settings:changed': 1,
  'window:state': 1,
  'toast': 1,
  'vault:index': 1,
  'vault:changed': 1,
  'session:updated': 1,
  'chat:started': 1,
  'chat:token': 1,
  'chat:done': 1,
  'chat:error': 1,
  'images:progress': 1,
  'images:done': 1,
  'images:error': 1,
  'extensions:notify': 1,
  'updates:changed': 1
} satisfies Record<EventChannel, 1>

export const INVOKE_CHANNELS = Object.keys(invokeChannels) as InvokeChannel[]
export const EVENT_CHANNELS = Object.keys(eventChannels) as EventChannel[]

/**
 * The API the preload exposes as `window.api`. invoke() resolves to the raw
 * envelope because contextBridge strips custom fields from thrown errors; the
 * renderer's lib/ipc.ts unwraps it and throws an IpcError.
 */
export interface PreloadApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<IpcResult<InvokeResult<C>>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
}
