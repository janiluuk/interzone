import type { FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import type {
  NodeConfig,
  OpenAIChatRequest,
  OllamaChatRequest,
  ImageGenRequest,
  VideoGenRequest,
  VideoGenJob,
  TaskType,
} from "../types/index.js";
import type { Router } from "../router/Router.js";
import type { NodePoller } from "../poller/NodePoller.js";

const INFERENCE_TIMEOUT_MS = parseInt(process.env.INFERENCE_TIMEOUT_MS ?? "60000");

export class Proxy {
  private videoJobs: Map<string, VideoGenJob> = new Map();
  // Track active video jobs per node (used for cross-constraint checks)
  private activeDeforumByNode: Map<string, string> = new Map();

  constructor(
    private router: Router,
    private poller: NodePoller,
  ) {}

  getVideoJob(jobId: string): VideoGenJob | undefined {
    return this.videoJobs.get(jobId);
  }

  async handleChat(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as OpenAIChatRequest;
    const headers = req.headers as Record<string, string>;
    const taskType = (headers["x-task-type"] as TaskType | undefined) ?? "generic";
    const modelHint = headers["x-model-hint"] ?? body.model;
    const backendPrefer = headers["x-backend-prefer"];

    const result = this.router.selectNode(taskType, modelHint, backendPrefer);
    if (!result) {
      reply.header("Retry-After", "10");
      return reply.status(503).send({ error: "no nodes available", code: "no_nodes" });
    }

    const { node, decision } = result;
    const t0 = Date.now();
    this.poller.incrementQueue(node.id, "llm");

    try {
      let upstream: Response;
      if (node.backend === "ollama") {
        upstream = await this.proxyToOllama(node, body, !!body.stream);
      } else {
        upstream = await this.proxyToLocalAI(node, body, !!body.stream);
      }

      if (!upstream.ok) {
        // Retry on next best node (non-streaming only)
        if (!body.stream) {
          this.poller.decrementQueue(node.id, "llm");
          const retry = this.router.selectNode(taskType, modelHint, backendPrefer);
          if (retry && retry.node.id !== node.id) {
            const r2 = retry.node.backend === "ollama"
              ? await this.proxyToOllama(retry.node, body, false)
              : await this.proxyToLocalAI(retry.node, body, false);
            if (r2.ok) {
              this.poller.incrementQueue(retry.node.id, "llm");
              await this.streamOrSend(r2, reply, false);
              const latency = Date.now() - t0;
              this.poller.decrementQueue(retry.node.id, "llm");
              this.poller.recordRequest(retry.node.id, true, latency);
              this.router.completeDecision(decision.id, latency, true);
              return;
            }
          }
        }
        this.poller.recordRequest(node.id, false, Date.now() - t0);
        this.router.completeDecision(decision.id, Date.now() - t0, false);
        return reply.status(502).send({ error: "upstream error", status: upstream.status });
      }

      await this.streamOrSend(upstream, reply, !!body.stream);
      const latency = Date.now() - t0;
      this.poller.decrementQueue(node.id, "llm");
      this.poller.recordRequest(node.id, true, latency);
      this.router.completeDecision(decision.id, latency, true);
    } catch (err: unknown) {
      this.poller.decrementQueue(node.id, "llm");
      this.poller.recordRequest(node.id, false, Date.now() - t0);
      this.router.completeDecision(decision.id, Date.now() - t0, false);
      const isTimeout = err instanceof Error && err.name === "AbortError";
      return reply.status(isTimeout ? 504 : 502).send({ error: String(err) });
    }
  }

  async handleImageGen(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as ImageGenRequest;
    const headers = req.headers as Record<string, string>;
    const taskType: TaskType = body.init_image ? "img2img" : "txt2img";
    const backendPrefer = headers["x-backend-prefer"];

    const result = this.router.selectNode(taskType, undefined, backendPrefer);
    if (!result) {
      reply.header("Retry-After", "10");
      return reply.status(503).send({ error: "no image nodes available" });
    }

    const { node, decision } = result;
    const t0 = Date.now();
    this.poller.incrementQueue(node.id, "image");

    try {
      let responseData: unknown;
      if (node.backend === "sd_forge") {
        responseData = await this.proxyToForge(node, body, taskType);
      } else if (node.backend === "swarmui") {
        responseData = await this.proxyToSwarmUI(node, body);
      } else {
        this.poller.decrementQueue(node.id, "image");
        return reply.status(400).send({ error: "unsupported backend for image gen" });
      }

      const latency = Date.now() - t0;
      this.poller.decrementQueue(node.id, "image");
      this.poller.recordRequest(node.id, true, latency);
      this.router.completeDecision(decision.id, latency, true);
      return reply.send(responseData);
    } catch (err) {
      this.poller.decrementQueue(node.id, "image");
      this.poller.recordRequest(node.id, false, Date.now() - t0);
      this.router.completeDecision(decision.id, Date.now() - t0, false);
      return reply.status(502).send({ error: String(err) });
    }
  }

  async handleVideoGen(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = req.body as VideoGenRequest;
    const task = body.image ? "img2video" as const : "txt2video" as const;

    const result = this.router.selectNode(task);
    if (!result) {
      reply.header("Retry-After", "30");
      return reply.status(503).send({ error: "no video nodes available" });
    }

    const { node, decision } = result;
    const jobId = uuidv4();
    const t0 = Date.now();

    try {
      let job: VideoGenJob;

      switch (node.backend) {
        case "deforum": {
          const batchId = await this.submitDeforumJob(node, body);
          job = {
            job_id: jobId,
            node_id: node.id,
            backend_batch_id: batchId,
            status: "pending",
            frames_done: 0,
            total_frames: body.max_frames ?? body.num_frames ?? 120,
            outdir: "",
            submitted_at: Date.now(),
            updated_at: Date.now(),
          };
          // Cross-constraint: Deforum and Forge share the GPU on the same host
          const forgeNode = this.poller.getAllStates().find(
            (s) => s.config.host === node.host && s.config.backend === "sd_forge",
          );
          if (forgeNode) this.poller.incrementQueue(forgeNode.config.id, "image");
          break;
        }
        case "svd":
          job = await this.submitSVDJob(node, body, jobId);
          break;
        case "ltx_video":
          job = await this.submitLTXVideoJob(node, body, jobId);
          break;
        case "wan_video":
          job = await this.submitWanVideoJob(node, body, jobId);
          break;
        case "animate_lcm":
          job = await this.submitAnimateLCMJob(node, body, jobId);
          break;
        default:
          this.router.completeDecision(decision.id, Date.now() - t0, false);
          return reply.status(400).send({ error: `unsupported video backend: ${node.backend}` });
      }

      this.videoJobs.set(job.job_id, job);
      this.poller.setVideoJob(node.id, job.job_id);
      this.activeDeforumByNode.set(node.id, job.job_id);

      this.router.completeDecision(decision.id, Date.now() - t0, true);
      return reply.status(202).send({ job_id: job.job_id });
    } catch (err) {
      this.router.completeDecision(decision.id, Date.now() - t0, false);
      return reply.status(502).send({ error: String(err) });
    }
  }

  async handleVideoJobStatus(req: FastifyRequest<{ Params: { job_id: string } }>, reply: FastifyReply): Promise<void> {
    const { job_id } = req.params;
    const job = this.videoJobs.get(job_id);
    if (!job) return reply.status(404).send({ error: "job not found" });

    if (job.status === "pending" || job.status === "running") {
      const backend = this.poller.getState(job.node_id)?.config.backend;
      if (backend === "deforum") await this.pollDeforumJob(job);
      else if (backend === "ltx_video") await this.pollLTXVideoJob(job);
      else if (backend === "wan_video") await this.pollWanVideoJob(job);
      // SVD and AnimateLCM complete synchronously — nothing to poll
    }

    return reply.send(job);
  }

  private async proxyToOllama(node: NodeConfig, body: OpenAIChatRequest, stream: boolean): Promise<Response> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    const ollamaBody: OllamaChatRequest = this.translateToOllamaFormat(body);
    ollamaBody.stream = stream;

    return fetch(`http://${node.host}:${node.port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaBody),
      signal: controller.signal,
    });
  }

  private async proxyToLocalAI(node: NodeConfig, body: OpenAIChatRequest, stream: boolean): Promise<Response> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    return fetch(`http://${node.host}:${node.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream }),
      signal: controller.signal,
    });
  }

  private async proxyToForge(node: NodeConfig, body: ImageGenRequest, task: TaskType): Promise<unknown> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS * 5);

    const path = task === "img2img" ? "/sdapi/v1/img2img" : "/sdapi/v1/txt2img";
    const forgeBody: Record<string, unknown> = {
      prompt: body.prompt,
      negative_prompt: body.negative_prompt ?? "",
      width: body.width ?? 512,
      height: body.height ?? 512,
      steps: body.steps ?? 20,
      cfg_scale: body.cfg_scale ?? 7,
      seed: body.seed ?? -1,
      sampler_name: body.sampler ?? "DPM++ 2M",
      batch_size: body.batch_size ?? 1,
      send_images: true,
      save_images: false,
    };
    if (task === "img2img" && body.init_image) {
      forgeBody["init_images"] = [body.init_image];
      forgeBody["denoising_strength"] = body.denoising_strength ?? 0.75;
    }

    const res = await fetch(`http://${node.host}:${node.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forgeBody),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Forge returned ${res.status}`);
    return res.json();
  }

  private async proxyToSwarmUI(node: NodeConfig, body: ImageGenRequest): Promise<unknown> {
    const sessionId = this.poller.getSwarmSession(node.id);
    if (!sessionId) throw new Error("no SwarmUI session");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS * 5);

    const swarmBody: Record<string, unknown> = {
      session_id: sessionId,
      prompt: body.prompt,
      negativeprompt: body.negative_prompt ?? "",
      width: body.width ?? 512,
      height: body.height ?? 512,
      steps: body.steps ?? 20,
      cfgscale: body.cfg_scale ?? 7,
      seed: body.seed ?? -1,
      images: body.batch_size ?? 1,
      donotsave: false,
      aspectratio: "Custom",
    };
    if (body.model) swarmBody["model"] = body.model;

    const res = await fetch(`http://${node.host}:${node.port}/API/GenerateText2Image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swarmBody),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`SwarmUI returned ${res.status}`);
    return res.json();
  }

  private async submitDeforumJob(node: NodeConfig, body: VideoGenRequest): Promise<string> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    const deforumSettings: Record<string, unknown> = {
      animation_mode: body.animation_mode ?? "2D",
      max_frames: body.max_frames,
      W: body.width ?? 512,
      H: body.height ?? 512,
      seed: body.seed ?? -1,
      sampler: "euler",
      steps: body.steps ?? 20,
      scale: body.cfg_scale ?? 7,
      prompts: body.prompts,
    };

    // Try batch API first
    const res = await fetch(`http://${node.host}:${node.port}/deforum_api/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deforum_settings: deforumSettings }),
      signal: controller.signal,
    });

    if (res.status === 404) {
      // Fall back to script runner (synchronous, short animations only)
      throw new Error("deforum_api extension not available; install deforum_api extension");
    }
    if (!res.ok) throw new Error(`Deforum returned ${res.status}`);

    const json = await res.json() as { batch_id: string; outdir: string };
    return json.batch_id;
  }

  private async pollDeforumJob(job: VideoGenJob): Promise<void> {
    try {
      const nodeState = this.poller.getState(job.node_id);
      if (!nodeState) return;

      const res = await fetch(
        `http://${nodeState.config.host}:${nodeState.config.port}/deforum_api/batches/${job.backend_batch_id}`,
      );
      if (!res.ok) return;

      const data = await res.json() as {
        status: string;
        frames_done?: number;
        total_frames?: number;
        outdir?: string;
        error?: string;
      };

      job.frames_done = data.frames_done ?? job.frames_done;
      job.total_frames = data.total_frames ?? job.total_frames;
      job.outdir = data.outdir ?? job.outdir;
      job.updated_at = Date.now();

      if (data.status === "RUNNING") job.status = "running";
      else if (data.status === "SUCCEEDED") {
        job.status = "succeeded";
        this.finalizeVideoJob(job);
      } else if (data.status === "FAILED") {
        job.status = "failed";
        job.error = data.error;
        this.finalizeVideoJob(job);
      }
    } catch { /* ignore — will retry next poll */ }
  }

  private finalizeVideoJob(job: VideoGenJob): void {
    this.poller.setVideoJob(job.node_id, undefined);
    this.activeDeforumByNode.delete(job.node_id);

    // Undo the Forge cross-constraint only for Deforum jobs
    const nodeState = this.poller.getState(job.node_id);
    if (nodeState?.config.backend === "deforum") {
      const forgeNode = this.poller.getAllStates().find(
        (s) => s.config.host === nodeState.config.host && s.config.backend === "sd_forge",
      );
      if (forgeNode) this.poller.decrementQueue(forgeNode.config.id, "image");
    }
  }

  // ── SVD (img2video, synchronous) ─────────────────────────────────────────

  private async submitSVDJob(node: NodeConfig, body: VideoGenRequest, jobId: string): Promise<VideoGenJob> {
    if (!body.image) throw new Error("SVD requires an input image (base64)");

    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS * 10);

    const res = await fetch(`http://${node.host}:${node.port}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: body.image,
        num_frames: body.num_frames ?? 25,
        fps: body.fps ?? 7,
        motion_bucket_id: body.motion_bucket_id ?? 127,
        augmentation_level: body.augmentation_level ?? 0.0,
        width: body.width ?? 1024,
        height: body.height ?? 576,
        seed: body.seed ?? -1,
        decode_chunk_size: 8,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`SVD server returned ${res.status}`);
    const data = await res.json() as { video_b64?: string; frames?: string[] };

    return {
      job_id: jobId,
      node_id: node.id,
      backend_batch_id: jobId,
      status: "succeeded",
      frames_done: body.num_frames ?? 25,
      total_frames: body.num_frames ?? 25,
      output_b64: data.video_b64,
      submitted_at: Date.now(),
      updated_at: Date.now(),
    };
  }

  // ── LTX-Video (txt2video and img2video, async) ────────────────────────────

  private async submitLTXVideoJob(node: NodeConfig, body: VideoGenRequest, jobId: string): Promise<VideoGenJob> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    const reqBody: Record<string, unknown> = {
      prompt: body.prompt ?? "",
      negative_prompt: body.negative_prompt ?? "",
      width: body.width ?? 768,
      height: body.height ?? 512,
      num_frames: body.num_frames ?? 121,
      fps: body.fps ?? 24,
      seed: body.seed ?? -1,
      num_inference_steps: body.steps ?? 50,
      guidance_scale: body.cfg_scale ?? 3.0,
    };
    if (body.image) reqBody.image = body.image;
    if (body.model) reqBody.model = body.model;

    const res = await fetch(`http://${node.host}:${node.port}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`LTX-Video server returned ${res.status}`);
    const data = await res.json() as { job_id?: string; video_b64?: string };

    const totalFrames = body.num_frames ?? 121;
    if (data.video_b64) {
      return {
        job_id: jobId, node_id: node.id, backend_batch_id: jobId,
        status: "succeeded", frames_done: totalFrames, total_frames: totalFrames,
        output_b64: data.video_b64, submitted_at: Date.now(), updated_at: Date.now(),
      };
    }
    return {
      job_id: jobId, node_id: node.id, backend_batch_id: data.job_id ?? jobId,
      status: "pending", frames_done: 0, total_frames: totalFrames,
      submitted_at: Date.now(), updated_at: Date.now(),
    };
  }

  private async pollLTXVideoJob(job: VideoGenJob): Promise<void> {
    try {
      const nodeState = this.poller.getState(job.node_id);
      if (!nodeState) return;
      const res = await fetch(
        `http://${nodeState.config.host}:${nodeState.config.port}/jobs/${job.backend_batch_id}`,
      );
      if (!res.ok) return;
      const data = await res.json() as {
        status: string; progress?: number; frames_done?: number;
        video_b64?: string; error?: string;
      };
      job.frames_done = data.frames_done ?? Math.round((data.progress ?? 0) * job.total_frames);
      job.updated_at = Date.now();
      const s = data.status.toLowerCase();
      if (s === "running") job.status = "running";
      else if (s === "succeeded") {
        job.status = "succeeded"; job.output_b64 = data.video_b64;
        job.frames_done = job.total_frames; this.finalizeVideoJob(job);
      } else if (s === "failed") {
        job.status = "failed"; job.error = data.error; this.finalizeVideoJob(job);
      }
    } catch { /* retry next poll */ }
  }

  // ── Wan Video (txt2video and img2video, async) ────────────────────────────

  private async submitWanVideoJob(node: NodeConfig, body: VideoGenRequest, jobId: string): Promise<VideoGenJob> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    const reqBody: Record<string, unknown> = {
      prompt: body.prompt ?? "",
      negative_prompt: body.negative_prompt ?? "",
      width: body.width ?? 832,
      height: body.height ?? 480,
      num_frames: body.num_frames ?? 81,
      fps: body.fps ?? 16,
      seed: body.seed ?? -1,
      steps: body.steps ?? 50,
      guidance_scale: body.cfg_scale ?? 5.0,
      task: body.image ? "i2v" : "t2v",
    };
    if (body.image) reqBody.image = body.image;
    if (body.model) reqBody.model = body.model;

    const res = await fetch(`http://${node.host}:${node.port}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Wan Video server returned ${res.status}`);
    const data = await res.json() as { job_id?: string; video_b64?: string };

    const totalFrames = body.num_frames ?? 81;
    if (data.video_b64) {
      return {
        job_id: jobId, node_id: node.id, backend_batch_id: jobId,
        status: "succeeded", frames_done: totalFrames, total_frames: totalFrames,
        output_b64: data.video_b64, submitted_at: Date.now(), updated_at: Date.now(),
      };
    }
    return {
      job_id: jobId, node_id: node.id, backend_batch_id: data.job_id ?? jobId,
      status: "pending", frames_done: 0, total_frames: totalFrames,
      submitted_at: Date.now(), updated_at: Date.now(),
    };
  }

  private async pollWanVideoJob(job: VideoGenJob): Promise<void> {
    try {
      const nodeState = this.poller.getState(job.node_id);
      if (!nodeState) return;
      const res = await fetch(
        `http://${nodeState.config.host}:${nodeState.config.port}/jobs/${job.backend_batch_id}`,
      );
      if (!res.ok) return;
      const data = await res.json() as {
        status: string; progress?: number; frames_done?: number;
        video_b64?: string; error?: string;
      };
      job.frames_done = data.frames_done ?? Math.round((data.progress ?? 0) * job.total_frames);
      job.updated_at = Date.now();
      const s = data.status.toLowerCase();
      if (s === "running") job.status = "running";
      else if (s === "succeeded") {
        job.status = "succeeded"; job.output_b64 = data.video_b64;
        job.frames_done = job.total_frames; this.finalizeVideoJob(job);
      } else if (s === "failed") {
        job.status = "failed"; job.error = data.error; this.finalizeVideoJob(job);
      }
    } catch { /* retry next poll */ }
  }

  // ── AnimateLCM via Forge (txt2video, synchronous) ─────────────────────────

  private async submitAnimateLCMJob(node: NodeConfig, body: VideoGenRequest, jobId: string): Promise<VideoGenJob> {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS * 5);

    const numFrames = body.num_frames ?? 16;
    const res = await fetch(`http://${node.host}:${node.port}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: body.prompt ?? "",
        negative_prompt: body.negative_prompt ?? "",
        steps: body.steps ?? 4,      // LCM needs very few steps
        width: body.width ?? 512,
        height: body.height ?? 512,
        seed: body.seed ?? -1,
        cfg_scale: 1.0,              // LCM works at cfg=1
        send_images: true,
        save_images: false,
        alwayson_scripts: {
          animatediff: {
            args: [{
              enable: true,
              model: body.model ?? "AnimateLCM_sd15_t2v.ckpt",
              format: ["GIF"],
              video_length: numFrames,
              fps: body.fps ?? 8,
              loop_number: 0,
              closed_loop: "A",
              batch_size: 1,
              stride: 1,
              overlap: -1,
            }],
          },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`AnimateLCM/Forge returned ${res.status}`);
    const data = await res.json() as { images?: string[] };
    const gifB64 = data.images?.[0];

    return {
      job_id: jobId, node_id: node.id, backend_batch_id: jobId,
      status: gifB64 ? "succeeded" : "failed",
      frames_done: gifB64 ? numFrames : 0,
      total_frames: numFrames,
      output_b64: gifB64,
      submitted_at: Date.now(), updated_at: Date.now(),
      error: gifB64 ? undefined : "No GIF returned by AnimateDiff",
    };
  }

  private translateToOllamaFormat(body: OpenAIChatRequest): OllamaChatRequest {
    return {
      model: body.model,
      messages: body.messages,
      stream: body.stream ?? false,
      options: {
        temperature: body.temperature,
        num_predict: body.max_tokens,
        top_p: body.top_p,
      },
    };
  }

  private translateOllamaChunkToOpenAI(chunk: string, model: string): string {
    try {
      const parsed = JSON.parse(chunk) as {
        model?: string;
        message?: { content?: string };
        done?: boolean;
        eval_count?: number;
      };

      if (parsed.done) return "data: [DONE]\n\n";

      const content = parsed.message?.content ?? "";
      const data = {
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion.chunk",
        model: parsed.model ?? model,
        choices: [{ delta: { content }, index: 0, finish_reason: null }],
      };
      return `data: ${JSON.stringify(data)}\n\n`;
    } catch {
      return "";
    }
  }

  private async streamOrSend(upstream: Response, reply: FastifyReply, stream: boolean): Promise<void> {
    if (!stream) {
      const data = await upstream.json();
      return reply.send(data);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    const isOllamaStream = contentType.includes("application/x-ndjson") ||
      contentType.includes("application/json");

    if (!upstream.body) {
      reply.raw.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (isOllamaStream) {
          const translated = this.translateOllamaChunkToOpenAI(trimmed, "");
          if (translated) reply.raw.write(translated);
        } else {
          // LocalAI/OpenAI SSE — pass through
          reply.raw.write(line + "\n");
        }
      }
    }

    if (!reply.raw.writableEnded) reply.raw.end();
  }
}
