# BidPilot AI orchestrator

The TypeScript orchestration boundary owns workflow dispatch and will host the
typed graph implementation in a later horizontal slice. It intentionally
accepts validated JSON rather than model-specific prompts or chat transcripts.

Run locally with:

```powershell
npm --workspace @bidpilot/ai-orchestrator run build
npm --workspace @bidpilot/ai-orchestrator start
```
