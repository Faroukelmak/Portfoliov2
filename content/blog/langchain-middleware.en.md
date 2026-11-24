---
title: LangChain middleware explained with two concrete examples
date: 2026-11-24
excerpt: A middleware plugs into an agent's loop to act before or after a step. Two examples to understand the idea, automatic history summarization and human approval before a sensitive action.
tags: [LangChain, Agents, Middleware, Python]
versions: [langchain 1.5.0, langchain-core 1.8.1, langchain-groq 1.2.0, langgraph 1.2.24]
model: openai/gpt-oss-20b via Groq
---

A LangChain agent runs in a loop. It receives a message, calls the model, the model sometimes asks for a tool, the tool sends a result back to the model, and so on until the final answer.

A **middleware** is a piece of code that runs **at a specific point of that loop**, without touching the rest of the agent. You use it to log, retry on errors, cap the number of calls, filter sensitive data… or, as here, to summarize the history and ask a human for approval.

## Where a middleware plugs in

Each middleware hooks into one point of the loop. The two we will look at act in two different places.

<figure class="viz-fig">
<div class="viz" data-viz="agent-loop"></div>
<figcaption>Summarization runs before the model call, human approval right after, before the tool executes.</figcaption>
</figure>

- `before_model` runs **before** every model call. That is where summarization shortens the history.
- `after_model` runs **after** the model answers. That is where human approval catches a tool call before it goes out.

## The common setup

Both middlewares need the agent to **remember** the conversation from one call to the next. For that, you give it a *checkpointer* (a memory) and identify each conversation with a `thread_id`.

```python
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.messages import HumanMessage

llm = init_chat_model("groq:openai/gpt-oss-20b")

agent = create_agent(
    model=llm,
    tools=[...],
    checkpointer=InMemorySaver(),   # keeps the history in memory
    middleware=[...],               # a list, several can be stacked
)

config = {"configurable": {"thread_id": "session-1"}}   # same id = same conversation
agent.invoke({"messages": [HumanMessage("...")]}, config)
```

Without a checkpointer, every `invoke` starts from scratch. With `InMemorySaver()` and a `thread_id`, each call adds to the same history.

## Middleware 1. Summarize the history automatically

### The problem

The longer a conversation runs, the bigger the history sent to the model. Every call costs more tokens, gets slower, and eventually exceeds the model's context window.

### The idea

When the history goes over a threshold, replace the **old** messages with **a single summary**, and keep the **latest** messages as they are. The model keeps the essential context with far less text.

<figure class="viz-fig">
<div class="viz" data-viz="summarization"></div>
<figcaption>With trigger 10 and keep 4. On the 6th question, the history goes over 10 messages. The last 4 are kept, the rest becomes a summary.</figcaption>
</figure>

### The code

```python
from langchain.agents.middleware import SummarizationMiddleware

agent = create_agent(
    model=llm,
    checkpointer=InMemorySaver(),
    middleware=[
        SummarizationMiddleware(
            model=llm,                  # the model that writes the summary
            trigger=("messages", 10),   # when to summarize, from 10 messages
            keep=("messages", 4),       # what stays untouched, the last 4
        )
    ],
)
```

Two settings are enough to understand the behavior.

- `trigger` says **when** to summarize.
- `keep` says **what is left alone**.

### What happens over six questions

```python
config = {"configurable": {"thread_id": "math-session"}}

questions = [
    "What is 2 + 2?",
    "What is 10 x 3?",
    "What is 100 / 4?",
    "What is 7 squared?",
    "What is 15% of 200?",
    "What is the square root of 81?",
]

for i, question in enumerate(questions, start=1):
    result = agent.invoke({"messages": [HumanMessage(question)]}, config)
    print(f"Question {i}", len(result["messages"]), "messages")
```

```output Result
Question 1    2 messages
Question 2    4 messages
Question 3    6 messages
Question 4    8 messages
Question 5   10 messages
Question 6    6 messages   <- summary triggered
```

Each question adds 2 messages (the question and the answer). On the 6th, the history goes over the threshold. The old messages are replaced by a summary, and the history drops back to 6 messages.

The first message of the history is now that summary.

```output First message of the history
Here is a summary of the conversation to date:

## SESSION INTENT
The user is asking a series of math questions.

## SUMMARY
2 + 2 = 4, 10 x 3 = 30, 100 / 4 = 25, 7 squared = 49.
```

### Three ways to set the threshold

| Unit | Example | Meaning |
|---|---|---|
| `messages` | `("messages", 10)` | from 10 messages in the history |
| `tokens` | `("tokens", 550)` | from about 550 tokens |
| `fraction` | `("fraction", 0.005)` | from 0.5% of the model's context window |

`keep` accepts the same units. With `fraction`, the computation uses the model's context size (131,072 tokens for gpt-oss-20b, so 0.5% is about 650 tokens).

Summarizing is a side task. You can pass a **cheaper** model in `model=` than the one running the agent.

## Middleware 2. Ask a human for approval

### The problem

An agent that can send emails, write to a database or trigger a payment can also get it wrong. For those actions, you want a human to **approve before execution**.

### The idea

When the model asks for a sensitive tool, the middleware **pauses the agent**. A human looks at the planned call and decides to **approve** it, **edit** it or **reject** it. The agent then resumes where it stopped.

<figure class="viz-fig">
<div class="viz" data-viz="human-in-the-loop"></div>
<figcaption>The three possible decisions, approve, edit (here the recipient is corrected) and reject.</figcaption>
</figure>

### Step A. The tools and the agent

Two tools, one that reads an email (harmless) and one that sends one (sensitive).

```python
from langchain.tools import tool
from langchain.agents.middleware import HumanInTheLoopMiddleware

@tool
def read_email(email_id: str) -> str:
    """Read an email by its id."""
    return f"Email content for id {email_id}"

@tool
def send_email(recipient: str, subject: str, body: str) -> str:
    """Send an email."""
    return f"Email sent to {recipient} with subject '{subject}'"

agent = create_agent(
    model=llm,
    tools=[read_email, send_email],
    checkpointer=InMemorySaver(),
    middleware=[
        HumanInTheLoopMiddleware(interrupt_on={
            "send_email": {"allowed_decisions": ["approve", "edit", "reject"]},  # pause
            "read_email": False,                                                # never pause
        })
    ],
)
```

`interrupt_on` lists the tools to watch. For `send_email`, all three decisions are allowed. `read_email` runs freely.

### Step B. The agent stops

```python
config = {"configurable": {"thread_id": "email-session"}}

result = agent.invoke(
    {"messages": [HumanMessage(
        "Send an email to john@example.com with the subject 'Hello' "
        "and the body 'How are you?'"
    )]},
    config=config,
)
result["__interrupt__"]
```

```output Result
Paused on send_email
  recipient   john@example.com
  subject     Hello
  body        How are you?
  decisions   approve, edit, reject
```

The tool has **not** run. The result contains `__interrupt__`, which describes the pending call.

### Step C. Resume with a decision

Run the agent again with `Command(resume=...)` and **the same `config`**, so it finds the paused conversation.

**Approve**, the tool runs as planned.

```python
from langgraph.types import Command

result = agent.invoke(
    Command(resume={"decisions": [{"type": "approve"}]}),
    config=config,
)
print(result["messages"][-1].content)
```

```output Result
Email sent to john@example.com with the subject "Hello".
```

**Edit**, fix the arguments before execution.

```python
Command(resume={"decisions": [{
    "type": "edit",
    "edited_action": {
        "name": "send_email",
        "args": {
            "recipient": "jane@example.com",
            "subject": "Hello",
            "body": "How are you?",
        },
    },
}]})
```

```output Result
Email sent to jane@example.com with the subject "Hello".
```

**Reject**, the tool does not run and the agent is told.

```python
Command(resume={"decisions": [{"type": "reject"}]})
```

Two rules to keep in mind.

- Always resume with **the same `thread_id`**, otherwise the agent cannot find the paused call.
- Send **one decision per pending tool call**, in order.

## The two middlewares side by side

| | Summarization | Human approval |
|---|:---:|:---:|
| When | before the model call | after the model answers |
| Changes the history | :yes: | :no: |
| Pauses the agent | :no: | :yes: |
| Needs a human action | :no: | :yes: |
| Makes an extra LLM call | :yes: | :no: |

## What about the other middlewares?

LangChain ships others, ready to use, that plug in exactly the same way in `middleware=[...]`. For example, retrying a failed model or tool call, falling back to a backup model, capping the number of calls, detecting and masking personal data, or only showing the model the tools it needs.

The full list and their parameters are in the official documentation.

- [Prebuilt middleware](https://docs.langchain.com/oss/python/langchain/middleware/built-in)
- [How middleware works](https://docs.langchain.com/oss/python/langchain/middleware/overview)

> A middleware does not change the agent, it changes what happens around each step.
