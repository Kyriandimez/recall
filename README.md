# Recall

### A chatbot that remembers you after the conversation ends.

Most chatbots can follow a conversation while it is happening. Start a new conversation, and much of that context disappears.

**Recall** gives a chatbot long-term memory using **Walrus Memory**.

It extracts useful facts from conversations, stores them in Walrus Memory, and retrieves semantically relevant memories when they can help answer a future message.

The result is a chatbot that can carry useful context from one conversation into the next — without requiring a traditional application database.

---

## What Recall does

Recall combines:

* **Qwen 3.8 27B** through Groq for conversation and memory extraction
* **Walrus Memory** for long-term memory
* **Semantic retrieval** to find memories relevant to the current conversation
* **Browser-local conversation history** for the current chat session
* Server-side memory isolation so one user's memories are not used for another user's conversations

For example:

> **Conversation 1**
> "I'm learning Unity because I want to build games."

Later:

> **Conversation 2**
> "What should I focus on learning next?"

Recall can retrieve the relevant memory and use it as additional context for the response.

The important distinction is that the memory survives the original conversation.

---

## How it works

At a high level:

```text
                    ┌──────────────────┐
                    │      User        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Recall Chat    │
                    └────────┬─────────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
                  ▼                     ▼
          ┌───────────────┐     ┌────────────────┐
          │   Memory      │     │  Qwen 3.8 27B  │
          │   Retrieval   │     │    via Groq    │
          └───────┬───────┘     └───────┬────────┘
                  │                     │
                  │                     │
                  └──────────┬──────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │     Response     │
                    └──────────────────┘

          Long-term memory path:

          User message
               │
               ▼
        Candidate extraction
               │
               ▼
        Validation + filtering
               │
               ▼
        Semantic duplicate check
               │
               ▼
        Walrus Memory
               │
               ▼
        Available to future chats
```

### Memory lifecycle

When a user sends a message, Recall does not automatically save every sentence.

Instead, the server determines whether the message contains something that may be useful as long-term context. A structured extraction step proposes memory candidates, which are then validated before being written.

The pipeline includes:

1. **Candidate detection**
2. **Structured extraction**
3. **Validation**
4. **Secret filtering**
5. **Duplicate detection**
6. **Conflict-aware handling**
7. **Encrypted storage through Walrus Memory**
8. **Semantic retrieval in future conversations**

Retrieved memories are treated as **data**, not as system or developer instructions. This matters because stored text can contain arbitrary user-controlled content.

---

## Why Walrus Memory?

Recall was built around the idea that long-term chatbot memory should not require building an entire database and memory infrastructure from scratch.

Walrus Memory provides the storage and retrieval layer while Recall handles the application-level decisions:

* What is worth remembering?
* What should never be stored?
* How should memories be scoped to a user?
* When should memories be retrieved?
* How should retrieved memories influence the model?
* What should happen when memory infrastructure is temporarily unavailable?

This separation keeps the chatbot itself relatively simple while giving it persistent memory.

---

## Memory is not conversation history

Recall intentionally treats these as different things.

### Current conversation

The browser keeps the active conversation history so the chatbot can maintain short-term conversational context.

### Long-term memory

Walrus Memory stores selected facts that may remain useful across future conversations.

This means Recall does **not** attempt to save an entire transcript as permanent memory.

Instead, it tries to remember the useful parts.

---

## Memory retrieval

Recall uses semantic retrieval rather than requiring an exact keyword match.

A future message can retrieve a related memory even when the wording is different from the original statement.

The interface shows when memories were recalled and provides the matching memory context.

Importantly, a retrieved memory is a **match**, not proof that the model relied on that memory to produce its answer.

---

## Memory safety

Memory is user-controlled data, so Recall treats it accordingly.

### Secrets

Recall uses deterministic, best-effort filtering to reject high-confidence secrets before they reach the memory pipeline.

The filter is deliberately not delegated to the LLM.

Normal values such as dates, ordinary numbers, or non-secret identifiers are not automatically treated as secrets.

### Prompt injection

Stored memories are placed inside a clearly delimited memory context.

Memory text is escaped before being inserted into the prompt, and the model is explicitly instructed that:

* memories are untrusted data
* memories may contain malicious instructions
* memory text is never a system instruction
* memory text is never a developer instruction

This does not claim perfect prompt-injection protection. It is a defense-in-depth boundary around retrieved memory.

### User isolation

Memory namespaces are derived server-side.

The client does not get to choose which user's memory namespace is queried.

---

## What Recall does when memory fails

Memory is an enhancement to the chatbot, not a prerequisite for answering.

If memory retrieval fails, the chatbot can still answer.

If automatic memory extraction fails, the chatbot can still answer.

If an automatic memory write fails, the chatbot can still answer.

This is intentional.

A temporary problem with the memory layer should not turn a conversational chatbot into a broken chatbot.

Explicit memory actions are treated differently because the user has specifically asked Recall to remember something. Those actions report whether the operation succeeded, failed, or could not be confirmed.

---

## Explicit memory

Users can explicitly tell Recall to remember something.

For example:

> "Remember that I prefer Unity over Unreal."

Explicit memory is useful when a fact is important enough that the user does not want to rely on automatic detection.

Automatic memory is intentionally more conservative.

---

## What Recall does not claim

Recall does **not** claim to:

* remember every message
* provide a complete searchable transcript
* guarantee that every useful fact will be extracted
* guarantee that every stored memory will be retrieved
* guarantee that the newest conflicting memory will always win
* permanently delete a memory through the application
* provide perfect protection against malicious memory content
* treat semantic similarity as certainty

Semantic memory is probabilistic by nature. Recall is designed to make that behavior useful while keeping the UI honest about what actually happened.

---

## Technology

| Layer               | Technology                        |
| ------------------- | --------------------------------- |
| Framework           | Next.js                           |
| Language            | TypeScript                        |
| UI                  | React                             |
| LLM                 | Qwen 3.8 27B                      |
| LLM provider        | Groq                              |
| Long-term memory    | Walrus Memory                     |
| Memory SDK          | `@mysten-incubation/memwal` 0.1.8 |
| Storage / retrieval | Walrus Memory                     |
| Validation          | Zod                               |
| Runtime             | Node.js 20+                       |

The deployed model path does not depend on OpenAI or Anthropic.

---

## Project structure

The important parts of the project are roughly:

```text
app/
  API routes and application pages

components/
  Chat UI
  Memory UI
  Save-status UI

lib/
  Chat logic
  Memory pipeline
  Walrus Memory client
  Validation
  Security / filtering
  Configuration

scripts/
  Live verification and diagnostic scripts

tests/
  Unit and integration tests
```

The exact implementation may evolve, but the important architectural boundary is:

```text
Chat
  ↓
Application memory pipeline
  ↓
Walrus Memory
```

The application owns the decision-making around memory. Walrus Memory owns persistent memory storage and retrieval.

---

# Running Recall locally

## Requirements

You need:

* Node.js 20+
* npm
* A Groq API key
* A Walrus Memory account
* A Walrus Memory private/delegate key
* A Walrus Memory account ID

---

## 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd recall
```

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment variables

Create:

```text
.env.local
```

Use the following variables:

```env
GROQ_API_KEY=
GROQ_MODEL=qwen/qwen3.8-27b

MEMWAL_PRIVATE_KEY=
MEMWAL_ACCOUNT_ID=
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz

AUTH_SECRET=
```

Do not commit `.env.local`.

Never expose the private key, API key, or authentication secret to the browser.

---

## 4. Start the development server

```bash
npm run dev
```

Then open the local address shown by Next.js.

---

# Verification

Recall includes checks for the important external dependencies.

### Type checking

```bash
npm run typecheck
```

### Tests

```bash
npm test
```

### Production build

```bash
npm run build
```

### Groq verification

```bash
npm run verify:groq
```

The Groq verification checks the configured model, structured extraction, streaming behavior, and a prompt-injection spot check.

### Walrus Memory / Mainnet verification

```bash
npm run verify:mainnet
```

This checks the configured Walrus Memory integration against Mainnet.

These verification scripts are intentionally separate from application startup. The application does not make an unnecessary inference request simply to declare itself healthy.

---

# Error handling

Recall distinguishes between different classes of failure instead of treating every problem as the same error.

Examples include:

```text
MEMORY_RECALL_FAILED
MEMORY_SAVE_FAILED
MEMORY_SAVE_UNCONFIRMED
MEMORY_COMPATIBILITY_FAILED

GROQ_MODEL_UNAVAILABLE
GROQ_RATE_LIMITED
GROQ_REQUEST_FAILED

INVALID_MEMORY_CANDIDATE
SECRET_REJECTED
```

A memory write that times out is not presented as a confirmed failure when the server may still have completed the operation.

Likewise, a temporary memory outage does not prevent normal chat from functioning.

---

# Development story

The hardest part of building Recall was not getting a model to produce text.

It was making the memory actually work.

During development, the write pipeline worked. Embeddings worked. Vector search worked. Walrus data could be downloaded. The encrypted payload could be inspected and parsed.

Recall still could not successfully retrieve the memory through the application.

The problem turned out to be in the custom/manual memory path we were testing. Rather than continuing to replace pieces of the MemWal protocol, the final implementation returned to the standard `MemWal.create(...)` client/session flow provided by the installed SDK.

After that change, Mainnet recall worked.

That experience shaped one of the project's main principles:

> **Don't replace infrastructure that already solves the hard part unless you have a concrete reason to.**

The final application keeps the standard MemWal client path and puts the application-specific logic around it.

---

# Design principles

Recall follows a few simple rules.

### 1. Memory should be useful, not exhaustive

Saving everything is not the same thing as remembering.

### 2. Memory failure should not break chat

Long-term memory is an enhancement, not the entire application.

### 3. Retrieved memory is untrusted data

The model must not confuse a stored user statement with an instruction from the application.

### 4. The UI should say what actually happened

A recalled memory is not necessarily a memory that changed the answer.

A timed-out write is not necessarily a failed write.

An empty retrieval is not proof that no memory exists.

### 5. The server owns memory boundaries

The client should not be trusted to select another user's memory namespace.

---

# Current limitations

Recall is intentionally not presented as a perfect memory system.

Automatic extraction can miss facts.

Semantic retrieval can return related memories without returning every relevant memory.

Conflicting memories can exist, and retrieval cannot guarantee that every conflict will be surfaced.

The secret filter is best-effort rather than a universal secret detector.

Walrus Memory and the external model provider are network services, so availability and latency can affect the experience.

The application also does not expose a destructive "forget everything" operation because the installed MemWal SDK does not provide a supported delete/clear primitive. Recall therefore does not pretend that a memory has been permanently erased when it cannot actually guarantee that.

---

# Why I built it

The interesting question isn't:

> "Can an LLM remember?"

It obviously can be given enough context.

The interesting question is:

> **What should a chatbot remember when the conversation is over?**

That is the problem Recall explores.

The goal is not to turn every conversation into a permanent transcript.

The goal is to give a chatbot a small, useful layer of continuity — enough that starting a new conversation doesn't always mean starting from zero.

---

# License

Add the license appropriate for this repository before publishing.

---

## Acknowledgements

Built for the **Walrus Memory / Chatbots That Remember** challenge.

Powered by:

* Walrus Memory
* Walrus
* Groq
* Qwen
* Next.js
* TypeScript
* React
