# TextRewrite Remote MCP

Standalone Dockerized remote MCP server for basic academic text rewriting instruction packs and deterministic rewrite guards.

## Boundary

TextRewrite does **not** call an LLM internally and does **not** claim to bypass plagiarism checks. It returns versioned rewrite instructions plus deterministic guard and comparison reports for user-owned drafts.

Use it for:

- basic academic draft rewriting guidance
- plain thesis-style wording
- sentence restructuring and synonym replacement rules
- preservation checks for numbers, citations, and protected terms
- before/after rewrite comparison reports

## Tools

- `textrewrite_instruction_pack` — structured rewrite rules for plain basic-paper style.
- `textrewrite_guard` — checks length drift, missing numbers, missing citations, protected terms, subjective phrases, and style risks.
- `textrewrite_compare` — reports length, punctuation, number/citation preservation, and review focus.

## Docker operation

This project is intended to run in Docker.

```bash
docker compose up -d --build
curl http://127.0.0.1:8793/health
```

MCP endpoint inside the running service:

```text
/mcp
```

## Development notes

The TypeScript source lives in `src/`; tests live in `tests/`. Do not commit local `node_modules/`, `dist/`, or `.env` files.
