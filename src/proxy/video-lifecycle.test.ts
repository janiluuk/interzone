import { describe, it, expect } from "vitest";
import type { VideoGenJob } from "../types/index.js";

describe("VideoGenJob lifecycle", () => {
  it("starts with pending status", () => {
    const job: VideoGenJob = {
      job_id: "test-job-1",
      node_id: "vimage3-deforum",
      backend_batch_id: "deforum-batch-abc",
      status: "pending",
      frames_done: 0,
      total_frames: 120,
      outdir: "/data/deforum/output/abc",
      submitted_at: Date.now(),
      updated_at: Date.now(),
    };

    expect(job.status).toBe("pending");
    expect(job.frames_done).toBe(0);
    expect(job.total_frames).toBe(120);
  });

  it("transitions to running then succeeded", () => {
    const job: VideoGenJob = {
      job_id: "test-job-2",
      node_id: "vimage3-deforum",
      backend_batch_id: "deforum-batch-xyz",
      status: "pending",
      frames_done: 0,
      total_frames: 60,
      outdir: "",
      submitted_at: Date.now(),
      updated_at: Date.now(),
    };

    job.status = "running";
    job.frames_done = 30;
    expect(job.status).toBe("running");

    job.status = "succeeded";
    job.frames_done = 60;
    expect(job.status).toBe("succeeded");
    expect(job.frames_done).toBe(job.total_frames);
  });

  it("captures error on failure", () => {
    const job: VideoGenJob = {
      job_id: "test-job-3",
      node_id: "vimage3-deforum",
      backend_batch_id: "deforum-batch-err",
      status: "running",
      frames_done: 10,
      total_frames: 60,
      outdir: "",
      submitted_at: Date.now(),
      updated_at: Date.now(),
    };

    job.status = "failed";
    job.error = "CUDA out of memory";
    expect(job.status).toBe("failed");
    expect(job.error).toBe("CUDA out of memory");
  });
});
