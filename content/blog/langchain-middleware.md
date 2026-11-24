---
title: Les middlewares LangChain expliqués avec deux exemples concrets
date: 2026-11-24
excerpt: Un middleware s'insère dans la boucle d'un agent pour agir avant ou après une étape. Deux exemples pour comprendre le principe, le résumé automatique de l'historique et la validation humaine avant une action sensible.
tags: [LangChain, Agents, Middleware, Python]
versions: [langchain 1.5.0, langchain-core 1.8.1, langchain-groq 1.2.0, langgraph 1.2.24]
model: openai/gpt-oss-20b via Groq
---

Un agent LangChain tourne en boucle. Il reçoit un message, appelle le modèle, le modèle demande parfois un outil, l'outil renvoie un résultat au modèle, et ainsi de suite jusqu'à la réponse finale.

Un **middleware** est un bout de code qui s'exécute **à un moment précis de cette boucle**, sans toucher au reste de l'agent. On s'en sert pour journaliser, réessayer en cas d'erreur, limiter les appels, filtrer des données sensibles… ou, comme ici, pour résumer l'historique et demander l'accord d'un humain.

## Où se branche un middleware

Chaque middleware s'accroche à un point de la boucle. Les deux qu'on va voir agissent à deux endroits différents.

<figure class="viz-fig">
<div class="viz" data-viz="agent-loop"></div>
<figcaption>Le résumé intervient avant l'appel au modèle, la validation humaine juste après, avant que l'outil ne s'exécute.</figcaption>
</figure>

- `before_model` s'exécute **avant** chaque appel au modèle. C'est là que le résumé raccourcit l'historique.
- `after_model` s'exécute **après** la réponse du modèle. C'est là que la validation humaine intercepte un appel d'outil avant qu'il parte.

## La mise en place commune

Les deux middlewares ont besoin que l'agent **se souvienne** de la conversation d'un appel à l'autre. Pour ça, on lui donne un *checkpointer* (une mémoire) et on identifie chaque conversation par un `thread_id`.

```python
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.messages import HumanMessage

llm = init_chat_model("groq:openai/gpt-oss-20b")

agent = create_agent(
    model=llm,
    tools=[...],
    checkpointer=InMemorySaver(),   # garde l'historique en mémoire
    middleware=[...],               # une liste, on peut en empiler plusieurs
)

config = {"configurable": {"thread_id": "session-1"}}   # même id = même conversation
agent.invoke({"messages": [HumanMessage("...")]}, config)
```

Sans checkpointer, chaque `invoke` repart de zéro. Avec `InMemorySaver()` et un `thread_id`, chaque appel s'ajoute au même historique.

## Middleware 1. Résumer l'historique automatiquement

### Le problème

Plus une conversation dure, plus l'historique envoyé au modèle grossit. Chaque appel coûte plus de tokens, devient plus lent, et finit par dépasser la fenêtre de contexte du modèle.

### L'idée

Quand l'historique dépasse un seuil, on remplace les **anciens** messages par **un seul résumé**, et on garde les **derniers** messages tels quels. Le modèle conserve l'essentiel du contexte avec beaucoup moins de texte.

<figure class="viz-fig">
<div class="viz" data-viz="summarization"></div>
<figcaption>Avec trigger 10 et keep 4. À la 6e question, l'historique dépasse 10 messages. Les 4 derniers sont gardés, le reste devient un résumé.</figcaption>
</figure>

### Le code

```python
from langchain.agents.middleware import SummarizationMiddleware

agent = create_agent(
    model=llm,
    checkpointer=InMemorySaver(),
    middleware=[
        SummarizationMiddleware(
            model=llm,                  # le modèle qui écrit le résumé
            trigger=("messages", 10),   # quand résumer, dès 10 messages
            keep=("messages", 4),       # ce qui reste intact, les 4 derniers
        )
    ],
)
```

Deux réglages suffisent à comprendre le comportement.

- `trigger` dit **quand** résumer.
- `keep` dit **ce qu'on ne touche pas**.

### Ce qui se passe sur six questions

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

```output
Question 1    2 messages
Question 2    4 messages
Question 3    6 messages
Question 4    8 messages
Question 5   10 messages
Question 6    6 messages   <- résumé déclenché
```

Chaque question ajoute 2 messages (la question et la réponse). À la 6e, l'historique dépasse le seuil. Les anciens messages sont remplacés par un résumé, et l'historique redescend à 6 messages.

Le premier message de l'historique est désormais ce résumé.

```output Premier message de l'historique
Here is a summary of the conversation to date:

## SESSION INTENT
The user is asking a series of math questions.

## SUMMARY
2 + 2 = 4, 10 x 3 = 30, 100 / 4 = 25, 7 squared = 49.
```

### Trois façons de fixer le seuil

| Unité | Exemple | Signification |
|---|---|---|
| `messages` | `("messages", 10)` | dès 10 messages dans l'historique |
| `tokens` | `("tokens", 550)` | dès 550 tokens environ |
| `fraction` | `("fraction", 0.005)` | dès 0,5 % de la fenêtre de contexte du modèle |

`keep` accepte les mêmes unités. Avec `fraction`, le calcul se fait sur la taille de contexte du modèle (131 072 tokens pour gpt-oss-20b, donc 0,5 % correspond à environ 650 tokens).

Le résumé est une tâche secondaire. On peut passer un modèle **moins cher** dans `model=` que celui de l'agent.

## Middleware 2. Demander l'accord d'un humain

### Le problème

Un agent qui peut envoyer des emails, écrire en base ou déclencher un paiement peut aussi se tromper. Pour ces actions, on veut qu'un humain **valide avant l'exécution**.

### L'idée

Quand le modèle demande un outil sensible, le middleware **met l'agent en pause**. Un humain regarde l'appel prévu et décide de l'**approuver**, de le **modifier** ou de le **refuser**. L'agent reprend ensuite là où il s'était arrêté.

<figure class="viz-fig">
<div class="viz" data-viz="human-in-the-loop"></div>
<figcaption>Les trois décisions possibles, approve, edit (ici le destinataire est corrigé) et reject.</figcaption>
</figure>

### Étape A. Les outils et l'agent

Deux outils, un qui lit un email (sans risque) et un qui en envoie (sensible).

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
            "read_email": False,                                                # jamais de pause
        })
    ],
)
```

`interrupt_on` liste les outils à surveiller. Pour `send_email`, on autorise les trois décisions. `read_email` s'exécute librement.

### Étape B. L'agent s'arrête

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

```output
Pause sur send_email
  recipient   john@example.com
  subject     Hello
  body        How are you?
  décisions   approve, edit, reject
```

L'outil n'a **pas** été exécuté. Le résultat contient `__interrupt__`, qui décrit l'appel en attente.

### Étape C. On reprend avec une décision

On relance l'agent avec `Command(resume=...)` et **le même `config`**, pour qu'il retrouve la conversation en pause.

**Approuver**, l'outil s'exécute tel quel.

```python
from langgraph.types import Command

result = agent.invoke(
    Command(resume={"decisions": [{"type": "approve"}]}),
    config=config,
)
print(result["messages"][-1].content)
```

```output
Email sent to john@example.com with the subject "Hello".
```

**Modifier**, on corrige les arguments avant l'exécution.

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

```output
Email sent to jane@example.com with the subject "Hello".
```

**Refuser**, l'outil ne s'exécute pas et l'agent en est informé.

```python
Command(resume={"decisions": [{"type": "reject"}]})
```

Deux règles à garder en tête.

- Toujours reprendre avec **le même `thread_id`**, sinon l'agent ne retrouve pas l'appel en pause.
- Envoyer **une décision par appel d'outil en attente**, dans l'ordre.

## Les deux middlewares côte à côte

| | Résumé | Validation humaine |
|---|:---:|:---:|
| Moment | avant l'appel au modèle | après la réponse du modèle |
| Modifie l'historique | :yes: | :no: |
| Met l'agent en pause | :no: | :yes: |
| Demande une action humaine | :no: | :yes: |
| Fait un appel LLM en plus | :yes: | :no: |

## Et les autres middlewares ?

LangChain en fournit d'autres, prêts à l'emploi, qui se branchent exactement de la même façon dans `middleware=[...]`. Par exemple, réessayer un appel au modèle ou à un outil qui échoue, basculer sur un modèle de secours, limiter le nombre d'appels, détecter et masquer des données personnelles, ou ne présenter au modèle que les outils utiles.

La liste complète et leurs paramètres sont dans la documentation officielle.

- [Middlewares prêts à l'emploi](https://docs.langchain.com/oss/python/langchain/middleware/built-in)
- [Fonctionnement général des middlewares](https://docs.langchain.com/oss/python/langchain/middleware/overview)

> Un middleware ne change pas l'agent, il change ce qui se passe autour de chaque étape.
