import type { NodeConfig } from "../types/index.js";

export const FLEET: NodeConfig[] = [
  // ── vimage2 (192.168.2.101) — RTX 5060 Ti + RTX 3060 ────────────────────
  {
    id: "vimage2-5060ti",
    host: "192.168.2.101",
    label: "vimage2 / RTX 5060 Ti",
    backend: "localai",
    port: 8181,
    gpu: { name: "RTX 5060 Ti", arch: "blackwell", vram_gb: 16, cuda_cap: 13.0 },
    tier: 1,
    tags: ["5060ti", "blackwell", "large-model", "agreement-parse"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage2-ollama",
    host: "192.168.2.101",
    label: "vimage2 / Ollama (3060)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "classify"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage2-swarmui",
    host: "192.168.2.101",
    label: "vimage2 / SwarmUI",
    backend: "swarmui",
    port: 7801,
    gpu: { name: "RTX 5060 Ti", arch: "blackwell", vram_gb: 16, cuda_cap: 13.0 },
    tier: 1,
    tags: ["5060ti", "blackwell", "image-gen"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },

  // ── vimage3 (192.168.2.102) — RTX 4060 Ti ────────────────────────────────
  {
    id: "vimage3-ollama",
    host: "192.168.2.102",
    label: "vimage3 / Ollama (4060Ti)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "classify"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage3-forge",
    host: "192.168.2.102",
    label: "vimage3 / SD-Forge",
    backend: "sd_forge",
    port: 7860,
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "image-gen", "forge"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },
  {
    id: "vimage3-deforum",
    host: "192.168.2.102",
    label: "vimage3 / Deforum",
    backend: "deforum",
    port: 7860,
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "video-gen", "deforum"],
    capabilities: ["txt2video"],
    enabled: true,
  },

  // ── vimage4 (192.168.2.103) — Tesla P100 ─────────────────────────────────
  {
    id: "vimage4-p100",
    host: "192.168.2.103",
    label: "vimage4 / Ollama (P100)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "Tesla P100", arch: "pascal", vram_gb: 16, cuda_cap: 6.0 },
    tier: 1,
    tags: ["p100", "pascal", "large-model", "agreement-parse"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage4-forge",
    host: "192.168.2.103",
    label: "vimage4 / SD-Forge (P100)",
    backend: "sd_forge",
    port: 7860,
    gpu: { name: "Tesla P100", arch: "pascal", vram_gb: 16, cuda_cap: 6.0 },
    tier: 2,
    tags: ["p100", "pascal", "image-gen"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },

  // ── vimage5 (192.168.2.104) — RTX 3060 ───────────────────────────────────
  {
    id: "vimage5-ollama",
    host: "192.168.2.104",
    label: "vimage5 / Ollama (3060)",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "classify"],
    capabilities: ["llm"],
    enabled: true,
  },
  {
    id: "vimage5-forge",
    host: "192.168.2.104",
    label: "vimage5 / SD-Forge",
    backend: "sd_forge",
    port: 7860,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "image-gen"],
    capabilities: ["txt2img", "img2img"],
    enabled: true,
  },

  // ── win / 192.168.2.12 — RTX 4070 Ti ─────────────────────────────────────
  {
    id: "win-4070ti",
    host: "192.168.2.12",
    label: "win / RTX 4070 Ti",
    backend: "ollama",
    port: 11434,
    gpu: { name: "RTX 4070 Ti", arch: "ada", vram_gb: 12, cuda_cap: 8.9 },
    tier: 1,
    tags: ["4070ti", "ada", "large-model", "agreement-parse"],
    capabilities: ["llm"],
    enabled: true,
  },

  // ── vimage (192.168.2.100) — CPU only ────────────────────────────────────
  {
    id: "vimage-cpu",
    host: "192.168.2.100",
    label: "vimage / CPU only",
    backend: "localai",
    port: 8080,
    gpu: null,
    tier: 3,
    tags: ["cpu-only", "fallback"],
    capabilities: ["llm"],
    enabled: false,
  },

  // ── SVD — Stable Video Diffusion (img2video) ──────────────────────────────
  // Recommended models: stabilityai/stable-video-diffusion-img2vid-xt-1-1 (25 frames, ~10 GB VRAM)
  //                     stabilityai/stable-video-diffusion-img2vid         (14 frames, ~8 GB VRAM)
  // Server: https://github.com/Stability-AI/generative-models or a diffusers FastAPI wrapper
  // API: POST /generate  GET /health
  {
    id: "vimage2-svd",
    host: "192.168.2.101",
    label: "vimage2 / SVD (5060 Ti)",
    backend: "svd",
    port: 8282,
    gpu: { name: "RTX 5060 Ti", arch: "blackwell", vram_gb: 16, cuda_cap: 13.0 },
    tier: 1,
    tags: ["5060ti", "blackwell", "img2video", "svd"],
    capabilities: ["img2video"],
    enabled: false,
  },

  // ── LTX-Video (txt2video and img2video) ───────────────────────────────────
  // Recommended models: Lightricks/LTX-Video                (up to 257 frames @ 24 fps, ~8 GB VRAM)
  //                     Lightricks/LTX-Video-0.9.7-distilled (faster, fewer steps needed)
  // Server: https://github.com/Lightricks/LTX-Video  (run with --server flag)
  // API: POST /generate  GET /jobs/:id  GET /health
  {
    id: "vimage3-ltx",
    host: "192.168.2.102",
    label: "vimage3 / LTX-Video",
    backend: "ltx_video",
    port: 8383,
    gpu: { name: "RTX 4060 Ti", arch: "ada", vram_gb: 16, cuda_cap: 8.9 },
    tier: 2,
    tags: ["4060ti", "ada", "txt2video", "img2video", "ltx"],
    capabilities: ["txt2video", "img2video"],
    enabled: false,
  },

  // ── Wan Video (txt2video and img2video) ───────────────────────────────────
  // Recommended models: Wan-AI/Wan2.1-T2V-1.3B     (text→video, ~8 GB VRAM)
  //                     Wan-AI/Wan2.1-T2V-14B       (text→video, ~24 GB VRAM, multi-GPU)
  //                     Wan-AI/Wan2.1-I2V-14B-480P  (image→video, ~24 GB VRAM)
  //                     Wan-AI/Wan2.1-I2V-14B-720P  (image→video, ~40 GB VRAM)
  // Server: https://github.com/Wan-Video/Wan2.1  (FastAPI inference wrapper)
  // API: POST /generate  GET /jobs/:id  GET /health
  {
    id: "vimage4-wan",
    host: "192.168.2.103",
    label: "vimage4 / Wan Video (P100)",
    backend: "wan_video",
    port: 8484,
    gpu: { name: "Tesla P100", arch: "pascal", vram_gb: 16, cuda_cap: 6.0 },
    tier: 2,
    tags: ["p100", "pascal", "txt2video", "wan"],
    capabilities: ["txt2video"],
    enabled: false,
  },

  // ── AnimateLCM via SD-Forge (txt2video) ───────────────────────────────────
  // Recommended models: wangfuyun/AnimateLCM              (motion module, ~6 GB VRAM on SD1.5)
  //                     wangfuyun/AnimateLCM-SDXL-t2v     (SDXL variant, ~12 GB VRAM)
  // Requires AnimateDiff extension in Forge: sd-webui-animatediff
  // SD1.5 base: any compatible checkpoint (e.g. dreamshaper-8, realisticVisionV60)
  // API: Forge /sdapi/v1/txt2img with alwayson_scripts.animatediff
  {
    id: "vimage5-animate",
    host: "192.168.2.104",
    label: "vimage5 / AnimateLCM",
    backend: "animate_lcm",
    port: 7860,
    gpu: { name: "RTX 3060", arch: "ampere", vram_gb: 12, cuda_cap: 8.6 },
    tier: 2,
    tags: ["3060", "ampere", "txt2video", "animate-lcm"],
    capabilities: ["txt2video"],
    enabled: false,
  },
];
