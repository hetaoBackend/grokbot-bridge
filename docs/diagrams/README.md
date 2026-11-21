# Documentation diagrams

Each README diagram has two committed forms:

- `*.excalidraw` — editable source; open it in [Excalidraw](https://excalidraw.com/)
- `*.svg` — accessible, responsive export displayed by GitHub

The files use a warm-white background, charcoal text, and restrained orange, green, and purple.
They are documentation diagrams, not screenshots or representations of an official UI.

## Regenerate

From the repository root:

```bash
python3 docs/diagrams/generate_diagrams.py
```

The generator uses only the Python standard library and rewrites all three `.excalidraw` and `.svg`
files. Make content changes in the generator so the editable scenes and GitHub exports stay aligned.
