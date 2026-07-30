#!/usr/bin/env python3
"""
run_texture_workflow.py

Narrow ComfyUI client for the Phase 3 texture pipeline. Same safety model as
ComfyUI/scripts/run-approved-workflow.py, which it is derived from, extended
with the workflows Phase 3 needs and with the seamless-tiling node.

Per D6 this driver is the sanctioned transport to the local GPU. The artokun
comfyui-mcp plugin is not installed on this machine, so there is no MCP bridge.

It will ONLY:
  - talk to a local ComfyUI (127.0.0.1 / localhost / ::1)
  - load one of a fixed set of pre-validated API workflows in this directory
  - contain ONLY an approved allow-list of node types
  - change ONLY approved input fields
  - write outputs inside the portfolio or ComfyUI workspace roots
  - record prompt, seed, model file hashes and timings beside each image

CLI:
  --workflow       one of the keys in WORKFLOWS (required)
  --prompt         positive prompt text (required)
  --seed           integer seed (required)
  --width/--height multiples of 16, 256..2048
  --steps          sampler steps
  --output-prefix  SaveImage filename prefix
  --output-dir     destination directory, must be inside the workspace
  --server         local ComfyUI base URL
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
PORTFOLIO_ROOT = HERE.parents[2]
COMFY_ROOT = Path(r"C:\Users\User\dev\tools\ComfyUI")
WORKSPACE_ROOTS = [PORTFOLIO_ROOT, COMFY_ROOT]

WORKFLOWS = {
    "seamless-tile": HERE / "flux2-klein-seamless-tile.api.json",
    "card-back": HERE / "flux2-klein-card-back.api.json",
}

DEFAULT_SERVER = "http://127.0.0.1:8188"
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}

APPROVED_NODE_TYPES = {
    "UNETLoader", "CLIPLoader", "VAELoader", "CLIPTextEncode",
    "ConditioningZeroOut", "CFGGuider", "KSamplerSelect", "Flux2Scheduler",
    "EmptyFlux2LatentImage", "RandomNoise", "SamplerCustomAdvanced",
    "VAEDecode", "SaveImage", "PortfolioSeamlessTiling",
}

MODEL_FILES = {
    "unet": COMFY_ROOT / "models/diffusion_models/flux-2-klein-4b.safetensors",
    "clip": COMFY_ROOT / "models/text_encoders/qwen_3_4b.safetensors",
    "vae": COMFY_ROOT / "models/vae/flux2-vae.safetensors",
}

DIM_MIN, DIM_MAX, DIM_STEP = 256, 2048, 16

# Recorded once so provenance does not cost a multi-gigabyte reread per call.
# Verified by --rehash.
KNOWN_MODEL_SHA256 = {
    "flux-2-klein-4b.safetensors":
        "ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343",
    "qwen_3_4b.safetensors":
        "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a",
    "flux2-vae.safetensors":
        "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5",
}


class ApprovalError(Exception):
    """Raised whenever a request violates the client's safety policy."""


def validate_server(url: str) -> str:
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ApprovalError(f"Refused server scheme {p.scheme!r}.")
    host = (p.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ApprovalError(f"Refused non-local ComfyUI address {host!r}. "
                            f"Only {sorted(ALLOWED_HOSTS)} are allowed.")
    return url


def validate_dimensions(width: int, height: int) -> tuple[int, int]:
    for label, v in (("width", width), ("height", height)):
        if not isinstance(v, int) or isinstance(v, bool):
            raise ApprovalError(f"{label} must be an integer, got {v!r}.")
        if v < DIM_MIN or v > DIM_MAX:
            raise ApprovalError(f"Unsupported {label} {v}.")
        if v % DIM_STEP != 0:
            raise ApprovalError(f"{label} {v} is not a multiple of {DIM_STEP}.")
    return width, height


def validate_output_dir(path) -> Path:
    resolved = Path(path).resolve()
    for root in WORKSPACE_ROOTS:
        try:
            resolved.relative_to(root.resolve())
            return resolved
        except ValueError:
            continue
    raise ApprovalError(f"Refused path outside the workspace: {resolved}")


def load_and_validate_workflow(name: str) -> dict:
    if name not in WORKFLOWS:
        raise ApprovalError(f"Unknown workflow {name!r}. "
                            f"Choose from {sorted(WORKFLOWS)}.")
    path = WORKFLOWS[name]
    if not path.exists():
        raise ApprovalError(f"Workflow file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not data:
        raise ApprovalError("Workflow must be a non-empty JSON object.")
    for node_id, node in data.items():
        ct = node.get("class_type")
        if ct not in APPROVED_NODE_TYPES:
            raise ApprovalError(f"Node {node_id!r} uses unapproved type {ct!r}.")
        if not isinstance(node.get("inputs"), dict):
            raise ApprovalError(f"Node {node_id!r} has no inputs object.")
    for required in ("CLIPTextEncode", "RandomNoise", "Flux2Scheduler",
                     "EmptyFlux2LatentImage", "SaveImage"):
        n = [k for k, v in data.items() if v.get("class_type") == required]
        if len(n) != 1:
            raise ApprovalError(f"Expected one {required}, found {len(n)}.")
    return data


def _only(workflow: dict, class_type: str) -> str:
    ids = [k for k, v in workflow.items() if v.get("class_type") == class_type]
    if len(ids) != 1:
        raise ApprovalError(f"Expected one {class_type}, found {len(ids)}.")
    return ids[0]


def apply_approved_inputs(workflow: dict, *, prompt: str, seed: int,
                          width: int, height: int, steps: int,
                          output_prefix: str) -> dict:
    if not isinstance(prompt, str) or not prompt.strip():
        raise ApprovalError("Prompt must be a non-empty string.")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ApprovalError(f"Seed must be a non-negative integer, got {seed!r}.")
    if not isinstance(steps, int) or not 1 <= steps <= 60:
        raise ApprovalError(f"Steps must be 1..60, got {steps!r}.")
    validate_dimensions(width, height)
    if any(s in output_prefix for s in ("..", "\\", "/", ":")):
        raise ApprovalError(f"Bad output prefix {output_prefix!r}.")

    workflow[_only(workflow, "CLIPTextEncode")]["inputs"]["text"] = prompt
    workflow[_only(workflow, "RandomNoise")]["inputs"]["noise_seed"] = seed
    sched = workflow[_only(workflow, "Flux2Scheduler")]["inputs"]
    sched["width"], sched["height"], sched["steps"] = width, height, steps
    lat = workflow[_only(workflow, "EmptyFlux2LatentImage")]["inputs"]
    lat["width"], lat["height"] = width, height
    workflow[_only(workflow, "SaveImage")]["inputs"]["filename_prefix"] = \
        output_prefix
    return workflow


def _get(server: str, path: str, timeout: int = 60):
    with urllib.request.urlopen(server + path, timeout=timeout) as r:
        return json.load(r)


def submit(server: str, workflow: dict, client_id: str) -> str:
    body = json.dumps({"prompt": workflow, "client_id": client_id}).encode()
    req = urllib.request.Request(server + "/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise ApprovalError(f"ComfyUI rejected the workflow: {detail[:900]}")
    if resp.get("node_errors"):
        raise ApprovalError("node_errors: "
                            + json.dumps(resp["node_errors"], indent=2))
    return resp["prompt_id"]


def wait_for(server: str, prompt_id: str, timeout_s: int = 900) -> dict:
    start = time.time()
    while time.time() - start < timeout_s:
        hist = _get(server, f"/history/{prompt_id}")
        if prompt_id in hist:
            status = hist[prompt_id].get("status", {})
            if status.get("completed") or \
                    status.get("status_str") in ("success", "error"):
                if status.get("status_str") == "error":
                    raise ApprovalError(
                        f"Execution error: {json.dumps(status, indent=2)}")
                return hist[prompt_id]
        time.sleep(0.5)
    raise ApprovalError(f"Timed out waiting for {prompt_id}.")


def locate_image(history_entry: dict) -> Path:
    for out in history_entry.get("outputs", {}).values():
        for im in out.get("images", []):
            p = COMFY_ROOT / "output" / im.get("subfolder", "") / im["filename"]
            if p.exists():
                return p
    raise ApprovalError("Execution finished but no output image was found.")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 24), b""):
            h.update(chunk)
    return h.hexdigest()


def model_provenance(rehash: bool = False) -> dict:
    out = {}
    for role, p in MODEL_FILES.items():
        entry = {"file": p.name, "bytes": p.stat().st_size if p.exists() else None}
        entry["sha256"] = sha256_file(p) if rehash \
            else KNOWN_MODEL_SHA256.get(p.name)
        entry["sha256_verified_now"] = bool(rehash)
        out[role] = entry
    return out


def run(*, workflow_name: str, prompt: str, seed: int, width: int, height: int,
        steps: int, output_prefix: str, output_dir: Path, server: str,
        rehash: bool = False) -> dict:
    server = validate_server(server)
    width, height = validate_dimensions(width, height)
    out_dir = validate_output_dir(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    workflow = load_and_validate_workflow(workflow_name)
    workflow = apply_approved_inputs(workflow, prompt=prompt, seed=seed,
                                     width=width, height=height, steps=steps,
                                     output_prefix=output_prefix)

    t0 = time.time()
    prompt_id = submit(server, workflow, uuid.uuid4().hex)
    hist = wait_for(server, prompt_id)
    duration = round(time.time() - t0, 2)

    src = locate_image(hist)
    dest = out_dir / f"{output_prefix}_seed{seed}.png"
    if src.resolve() != dest.resolve():
        shutil.copy2(src, dest)

    meta = {
        "workflow": WORKFLOWS[workflow_name].name,
        "workflow_key": workflow_name,
        "prompt": prompt,
        "negative": "(zeroed / distilled, cfg 1.0)",
        "seed": seed,
        "width": width,
        "height": height,
        "steps": steps,
        "sampler": "euler",
        "scheduler": "Flux2Scheduler",
        "cfg": 1.0,
        "models": model_provenance(rehash),
        "comfy_prompt_id": prompt_id,
        "comfy_source": str(src),
        "output_image": str(dest),
        "output_sha256": sha256_file(dest),
        "duration_s": duration,
        "server": server,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
    }
    dest.with_suffix(".json").write_text(json.dumps(meta, indent=2),
                                        encoding="utf-8")
    return meta


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Phase 3 texture workflows, local only.")
    ap.add_argument("--workflow", required=True, choices=sorted(WORKFLOWS))
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--output-prefix", default="texture")
    # Tracked, not build/: the raw generation plus its sidecar is the
    # provenance record, and b_back.py consumes it directly.
    ap.add_argument("--output-dir", default=str(HERE / "generations"))
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--rehash", action="store_true",
                    help="recompute model sha256 instead of using the recorded value")
    return ap


def main(argv=None) -> int:
    a = build_arg_parser().parse_args(argv)
    try:
        meta = run(workflow_name=a.workflow, prompt=a.prompt, seed=a.seed,
                   width=a.width, height=a.height, steps=a.steps,
                   output_prefix=a.output_prefix,
                   output_dir=Path(a.output_dir), server=a.server,
                   rehash=a.rehash)
    except ApprovalError as e:
        print(f"REFUSED / ERROR: {e}", file=sys.stderr)
        return 2
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
