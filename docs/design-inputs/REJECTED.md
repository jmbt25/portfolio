# Rejected, round one

Round one produced nothing usable and cost a day. Three causes, all avoidable.
The style block was not pasted verbatim into each prompt, so every batch drifted
a little from the agreed look and no two outputs shared a coherent style, which
made comparing candidates meaningless. Diffusion text appeared throughout,
generated lettering on frames and labels that reads as gibberish at any size and
cannot be cleaned up in post, which is why the production label is now SVG
authored by hand in Phase 3 rather than generated. Multi-character prompts
suffered IP drift, with recognizable characters bleeding in from training data
whenever a prompt asked for more than one figure in a scene, making those
outputs unusable on a public portfolio regardless of their quality. Round two
fixed all three by pasting the style block verbatim every time, removing all
text from image prompts, and restricting prompts to a single figure.
