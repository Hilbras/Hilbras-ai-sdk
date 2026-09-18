# CLI

The `hilbras` CLI provides project scaffolding, provider management, and utilities.

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
hilbras provider add openai --key $OPENAI_API_KEY
hilbras provider add anthropic --key $ANTHROPIC_API_KEY
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
hilbras cost estimate --provider openai --model gpt-4o --prompt-tokens 1000 --completion-tokens 500
```

### doctor

Check system health:

```bash
hilbras doctor
```

## Options

| Option | Description |
|--------|-------------|
| `--provider` | Provider name |
| `--key` | API key |
| `--model` | Model ID |
| `--format` | Output format (json, table) |
