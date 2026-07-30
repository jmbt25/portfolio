"""
Portfolio Phase 3 seamless-tiling node for local ComfyUI.

Written for this repo rather than installed from a third party, so the whole
texture pipeline stays auditable. Deploy by copying into
ComfyUI/custom_nodes/ and restarting the server.

What it does: switches every Conv2d in the diffusion model and the VAE to
circular padding, so convolutions wrap across the image edges and the decode
is continuous at the boundary. This is the standard seamless-tiling patch.

Known limit, relevant to FLUX.2: Klein is a transformer, so almost all of its
spatial mixing happens in attention rather than in convolutions. Circular
padding therefore mostly buys continuity in the VAE decode, not in the latent
structure itself. Judge the result by eye on a 2x2 offset composite; do not
assume the patch is sufficient.
"""
import torch


def _patch(module, mode):
    n = 0
    for m in module.modules():
        if isinstance(m, torch.nn.Conv2d):
            if not hasattr(m, "_portfolio_orig_padding_mode"):
                m._portfolio_orig_padding_mode = m.padding_mode
            m.padding_mode = mode if mode != "restore" \
                else m._portfolio_orig_padding_mode
            n += 1
    return n


class PortfolioSeamlessTiling:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "vae": ("VAE",),
                "mode": (["circular", "restore"], {"default": "circular"}),
            }
        }

    RETURN_TYPES = ("MODEL", "VAE")
    RETURN_NAMES = ("model", "vae")
    FUNCTION = "apply"
    CATEGORY = "portfolio/seamless"
    DESCRIPTION = "Circular-pad every Conv2d in the model and VAE."

    def apply(self, model, vae, mode):
        a = _patch(model.model, mode)
        b = _patch(vae.first_stage_model, mode)
        print(f"[portfolio-seamless] mode={mode} model_convs={a} vae_convs={b}")
        return (model, vae)


NODE_CLASS_MAPPINGS = {"PortfolioSeamlessTiling": PortfolioSeamlessTiling}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PortfolioSeamlessTiling": "Portfolio Seamless Tiling",
}
