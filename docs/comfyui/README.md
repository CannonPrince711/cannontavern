# ComfyUI workflows for maps

Two ready-to-import workflows (ComfyUI API format) for map LoRAs such as
[Fantasy Map](https://civitai.com/models/382959) on an SDXL checkpoint:

| File | Use it for |
| --- | --- |
| `sdxl-lora-map.json` | **Generate with AI** in the map view (text to image, 1344×768) |
| `sdxl-lora-map-sketch.json` | **Paint from a sketch…** (img2img at 0.55 denoise, keeps the sketch's proportions) |

1. Put the LoRA in ComfyUI's `models/loras` and an SDXL checkpoint in `models/checkpoints`.
2. In DND Tavern: **Settings → Image backends → your ComfyUI backend → Workflows → Import**, once for each file.
3. Set **Used for** to **Maps** on both. In each workflow's settings, set **Checkpoint** to your SDXL model, and **LoRA** to the file name (e.g. `fantasy map-heavy.safetensors`) with a strength of 0.5–0.8 (lower for cleaner colours).
4. Under **Generation options → Maps**, pick `sdxl-lora-map` as the workflow, and add `fantasy map, parchment` to the style and `text, labels, people` to the negative prompt.

When you paint from a sketch, DND Tavern switches to a Maps workflow that takes an image (the sketch one) by itself.

For battlemaps, the same files work with [Mapcraft](https://civitai.com/models/799901): change the LoRA to `mapcraft_sdxl_v1.safetensors`, set **Used for** to **Battlemaps**, and use the style `mapcraft, battle map, top-down view, from above, no humans`.
