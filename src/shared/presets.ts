import type { TextBackendType } from './settings'

/** One-click starting points for the "Add text backend" picker. */
export interface TextPreset {
  id: string
  label: string
  type: TextBackendType
  baseUrl: string
  model: string
  needsKey: boolean
  hint?: string
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'openrouter', label: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', needsKey: true, hint: 'Hundreds of models behind one key.' },
  { id: 'anthropic', label: 'Anthropic (Claude)', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', needsKey: true },
  { id: 'openai', label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', needsKey: true },
  { id: 'ollama', label: 'Ollama', type: 'ollama', baseUrl: 'http://localhost:11434', model: '', needsKey: false, hint: 'Works over Tailscale: use http://<machine>.<tailnet>.ts.net:11434' },
  { id: 'lmstudio', label: 'LM Studio', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false },
  { id: 'koboldcpp-v1', label: 'KoboldCpp (OpenAI API)', type: 'openai', baseUrl: 'http://localhost:5001/v1', model: '', needsKey: false },
  { id: 'koboldcpp', label: 'KoboldCpp (native API)', type: 'koboldcpp', baseUrl: 'http://localhost:5001', model: '', needsKey: false },
  { id: 'textgen', label: 'text-generation-webui', type: 'textgen-webui', baseUrl: 'http://localhost:5000', model: '', needsKey: false },
  { id: 'llamacpp', label: 'llama.cpp server', type: 'openai', baseUrl: 'http://localhost:8080/v1', model: '', needsKey: false },
  { id: 'vllm', label: 'vLLM', type: 'openai', baseUrl: 'http://localhost:8000/v1', model: '', needsKey: false },
  { id: 'tabby', label: 'TabbyAPI', type: 'openai', baseUrl: 'http://localhost:5000/v1', model: '', needsKey: true },
  { id: 'groq', label: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', needsKey: true },
  { id: 'together', label: 'Together', type: 'openai', baseUrl: 'https://api.together.xyz/v1', model: '', needsKey: true },
  { id: 'deepseek', label: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', needsKey: true },
  { id: 'custom', label: 'Custom (any API)', type: 'custom', baseUrl: '', model: '', needsKey: false, hint: 'Describe the request with a body template and a JSONPath.' }
]

export const TEXT_TYPE_LABELS: Record<TextBackendType, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  koboldcpp: 'KoboldCpp (native)',
  'textgen-webui': 'text-generation-webui',
  custom: 'Custom'
}

/** Example body template shown for new Custom backends. */
export const CUSTOM_TEMPLATE_EXAMPLE = `{
  "model": "{{model}}",
  "messages": {{messages_json}},
  "max_tokens": {{max_tokens}},
  "temperature": {{temperature}}
}`
