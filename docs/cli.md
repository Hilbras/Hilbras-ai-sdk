# CLI

The `hilbras` CLI provides project scaffolding, provider management, interactive chat, benchmarking, and utilities.

## Installation

```bash
npm install -g hilbras
```

## Commands

### init

Initialize a new project:

```bash
hilbras init
```

### provider add

Add a provider:

```bash
hilbras provider add openai
hilbras provider add anthropic
```

### provider list

List configured providers:

```bash
hilbras provider list
```

### model list

List available models:

```bash
hilbras model list
hilbras model list --provider openai
```

### cost estimate

Estimate request cost:

```bash
hilbras cost estimate --model gpt-4o --tokens 10000
```

### chat (v3.1.0)

Interactive chat REPL with streaming output:

```bash
hilbras chat
hilbras chat --provider openai --model gpt-4o
hilbras chat --temperature 0.5 --max-tokens 2048
```

Type your message and press Enter. The response streams in real-time.
Type `exit` or `quit` to leave.

### bench (v3.1.0)

Benchmark provider latency and throughput:

```bash
hilbras bench
hilbras bench --prompt "Explain quantum computing" --runs 5
hilbras bench --providers openai,anthropic
```

Output includes average latency, tokens/sec, and error count per provider.

### costs (v3.1.0)

Display a cost report from a saved JSON file:

```bash
hilbras costs --file .hilbras-costs.json
```

To capture a cost report programmatically:

```typescript
const report = client.costReport();
import { writeFileSync } from "fs";
writeFileSync(".hilbras-costs.json", JSON.stringify(report, null, 2));
```

### dashboard (v3.1.0)

Render the DevTools dashboard in the terminal:

```bash
hilbras dashboard --file .hilbras-dashboard.json
```

Shows request timeline, latency percentiles, cost breakdown, and provider health.

### doctor

Check system health:

```bash
hilbras doctor
```

## Options

| Option | Description |
|--------|-------------|
| `--provider` | Provider name |
| `--model` | Model ID |
| `--temperature` | Sampling temperature |
| `--max-tokens` | Maximum tokens per response |
| `--prompt` | Benchmark prompt text |
| `--providers` | Comma-separated provider list |
| `--runs` | Number of benchmark runs |
| `--file` | Path to JSON data file |
