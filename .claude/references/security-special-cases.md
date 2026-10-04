# Security special cases

Read only the section relevant to the assigned personal-data or LLM boundary. General authorization, error and isolation rules remain in [Architecture Rules](../../docs/architecture.md).

## Data Privacy & Compliance

Privacy review checks the purpose, retention and allowed use of personal data. Classify fields when adding them so access, export and deletion paths can find them:

| Class | Examples | Handling |
|---|---|---|
| **Non-personal** | Aggregates, anonymized counts | Normal handling |
| **Personal (PII)** | Name, email, IP, device/user IDs | Minimize, access-control, include in export/delete |
| **Sensitive** | Health, finance, location, biometrics, gov IDs, anything about minors | Extra basis to collect, stricter access, often encryption + audit logging |

**Operating rules:**
- Collect each field for a stated purpose. Never log PII into telemetry.
- Define retention and a working deletion path for each personal-data store, including backups, caches, search indexes and analytics copies.
- Support the export, correction and deletion rights required by the applicable jurisdiction. The schema must make the user's data findable and erasable.
- Obtain auditable consent before collection or third-party sharing. Sending PII to an analytics, advertising or LLM vendor is sharing and requires a data-processing agreement.
- Configure residency and legal policy for the applicable user location; do not hardcode one region's law.

Input validation follows REQ-02 and REQ-05 in [Architecture Rules](../../docs/architecture.md#handling-api-requests). When a privacy incident exposes personal data, the breach-notification clock belongs in the postmortem.

## Securing AI / LLM Features

If your app calls an LLM (chatbots, summarizers, agents, RAG), map its attack surface to the [OWASP Top 10 for LLM Applications (2025)](https://genai.owasp.org/llm-top-10/):

- **Treat all model output as untrusted input (LLM05: Improper Output Handling).** Never pass LLM output straight into `eval`, SQL, a shell, `innerHTML`, or a file path. Validate and encode it as you would raw user input.
- **Assume prompts can be hijacked (LLM01: Prompt Injection).** Untrusted text in the context window (a user message, a fetched web page, a PDF) can carry instructions. The system prompt is not a security boundary; enforce permissions in code, not in the prompt.
- **Keep secrets and other users' data out of prompts (LLM02 / LLM07).** Anything in the context can be echoed back. Don't put API keys, cross-tenant data, or the full system prompt where the model can repeat it.
- **Constrain tool and agent permissions (LLM06: Excessive Agency).** Scope tools to the minimum, require confirmation for destructive or irreversible actions, and validate every tool argument.
- **Bound consumption (LLM10: Unbounded Consumption).** Cap tokens, request rate, and loop/recursion depth so a crafted input can't run up cost or hang the system.
- **Isolate retrieval data (LLM08: Vector and Embedding Weaknesses).** In RAG, treat the vector store as a trust boundary: partition embeddings per tenant so one user can't retrieve another's data, and validate documents before indexing.
