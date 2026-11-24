---
title: Getting Python objects out of an LLM with Pydantic
date: 2026-11-24
excerpt: An LLM answers in free text while your code expects data. With Pydantic and LangChain's with_structured_output, it returns a typed, validated object.
tags: [Python, Pydantic, LangChain, LLM]
versions: [pydantic 2.14.4, langchain 1.5.0, langchain-core 1.8.1, langchain-groq 1.2.0]
model: openai/gpt-oss-20b via Groq
---

Ask an LLM for the details of a movie and you get a nice paragraph. Great for a human, useless for code. To store that information in a database, show it in a UI or pass it to the next step of a pipeline, you need **structured data**, not text.

That is what *structured output* is for. You give the model a **schema** and get back a ready-to-use Python object.

## The problem with free text

```python
from langchain_groq import ChatGroq

model = ChatGroq(model="openai/gpt-oss-20b")
response = model.invoke("Give me the details of the movie Inception.")
print(response.content)
```

```output
**Inception** (2010) is a science-fiction film directed by
**Christopher Nolan**. It has a rating of about 8.8/10 and
follows a thief who steals secrets through dreams...
```

To get the year, you would have to search for "2010" in the text with a regex. And the sentence will never be phrased the same way twice.

## Step 1. Describe the data with Pydantic

Write a class that describes **exactly** what you expect. Each field has a type and a description.

```python
from pydantic import BaseModel, Field

class Movie(BaseModel):
    """A movie with its details."""
    title: str    = Field(description="The title of the movie")
    year: int     = Field(description="The year the movie was released")
    director: str = Field(description="The director of the movie")
    rating: float = Field(description="The rating of the movie, out of 10")
```

## Step 2. Plug the schema into the model

```python
structured_model = model.with_structured_output(Movie)
movie = structured_model.invoke("Give me the details of the movie Inception.")
print(movie)
```

```output Result
Movie(
    title    = "Inception",
    year     = 2010,
    director = "Christopher Nolan",
    rating   = 8.8
)
```

This is no longer text, it is a `Movie` object. You access the fields directly, with the right types.

```python
movie.title     # "Inception"
movie.year + 1  # 2011  -> year is a real integer
```

## How does it work?

LangChain turns the `Movie` class into a **tool** the model has to fill in. In practice, the model receives something that looks like this.

```output What the model receives
Tool "Movie"   A movie with its details.
  title     string    The title of the movie
  year      integer   The year the movie was released
  director  string    The director of the movie
  rating    number    The rating of the movie, out of 10
```

The model returns a value for each field, then Pydantic builds the `Movie` object.

Key takeaway, **the docstring and the descriptions are part of the prompt**. The model reads them. For example, the `rating` description says `out of 10`. Without it, the model could return a score out of 5 or out of 100.

## Objects inside objects

A movie has several actors, and each actor has a name and a role. Instead of flattening everything, you describe **one actor** once, then say the movie contains a **list** of actors.

```python
class Actor(BaseModel):
    name: str = Field(description="The name of the actor")
    role: str = Field(description="The character played by the actor")

class MovieDetails(BaseModel):
    """A movie with its cast."""
    title: str
    year: int
    genres: list[str]   # a list of strings
    cast: list[Actor]   # a list of actors

details = model.with_structured_output(MovieDetails).invoke(
    "Give me the details of the movie Inception."
)
```

```output Result
MovieDetails(
    title  = "Inception",
    year   = 2010,
    genres = ["Science fiction", "Action", "Thriller"],
    cast   = [
        Actor(name="Leonardo DiCaprio",    role="Dom Cobb"),
        Actor(name="Joseph Gordon-Levitt", role="Arthur"),
        Actor(name="Elliot Page",          role="Ariadne"),
    ]
)
```

Each actor is an object too, and you navigate through it naturally.

```python
details.cast[0].name  # "Leonardo DiCaprio"
len(details.cast)     # 3
```

## The alternatives, TypedDict and dataclass

LangChain also accepts two other ways of describing the schema.

### With a TypedDict

```python
from typing_extensions import TypedDict, Annotated

class MovieDict(TypedDict):
    """A movie with its details."""
    title: Annotated[str, ..., "The title of the movie"]
    year: Annotated[int, ..., "The year the movie was released"]

movie = model.with_structured_output(MovieDict).invoke(
    "Give me the details of the movie Inception."
)
```

```output Result
{"title": "Inception", "year": 2010}
```

You get a **dictionary**, so `movie["title"]` instead of `movie.title`.

### With a dataclass

```python
from dataclasses import dataclass
from langchain.agents import create_agent

@dataclass
class MovieData:
    title: str
    year: int

agent = create_agent(model=model, response_format=MovieData)
result = agent.invoke({"messages": "Give me the details of the movie Inception."})
result["structured_response"]
```

```output Result
MovieData(title="Inception", year=2010)
```

You get an **object**, but there is no way to describe the fields to the model. It only sees their names and types.

### The difference with Pydantic

All three give you structured data. But a TypedDict and a dataclass are only **labels**, and Python checks nothing when the data comes in.

```python
MovieDict(title="Inception", year="two thousand ten")
```

```output Result
{"title": "Inception", "year": "two thousand ten"}    <- accepted, no error
```

If the model returns a nonsense value, it silently enters your code and breaks something further down. Pydantic **checks every field** on arrival. That is the whole point.

## Pydantic's real strength, validation

### 1. It converts when the intent is obvious

LLMs sometimes add quotes where they should not. Pydantic fixes what is unambiguous.

```python
Movie.model_validate({
    "title": "Inception",
    "year": "2010",      # string
    "director": "Christopher Nolan",
    "rating": "8.8",     # string
})
```

```output Result
Movie(title="Inception", year=2010, director="Christopher Nolan", rating=8.8)
                              ^ integer                            ^ number
```

### 2. It rejects out-of-range values

Add bounds directly in the field. Here, a rating must be between 0 and 10.

```python
class Movie(BaseModel):
    """A movie with its details."""
    title: str
    year: int
    # ge = greater than or equal, le = less than or equal
    rating: float = Field(ge=0, le=10, description="Rating out of 10")
```

If the model returns a rating of 88, the object is rejected.

```output Result
Validation error in Movie
  rating   must be less than or equal to 10 (got 88)
```

These bounds are also sent to the model in the tool description. It knows the rule **before** answering, and Pydantic checks it **after**.

### 3. It applies your own rules with `field_validator`

**The need.** You extract contacts, and the model can write the same number in several ways, like `+33 6 42 75 98 75` or `+33.6.42.75.98.75`. You want one format every time (`+33642759875`) and to reject a number without a country code.

**Step A, the schema**, as usual.

```python
from pydantic import BaseModel, Field, field_validator

class ContactInfo(BaseModel):
    """Contact information for a person."""
    name: str  = Field(description="The full name of the person")
    email: str = Field(description="The email address of the person")
    phone: str = Field(description="The phone number, in international format")
```

**Step B, the rule.** Add a method **in the same class**, with the `@field_validator("phone")` decorator on top.

```python
class ContactInfo(BaseModel):
    """Contact information for a person."""
    name: str  = Field(description="The full name of the person")
    email: str = Field(description="The email address of the person")
    phone: str = Field(description="The phone number, in international format")

    @field_validator("phone")          # the rule applies to the phone field
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        value = value.replace(" ", "").replace(".", "")   # 1. clean
        if not value.startswith("+"):                     # 2. check
            raise ValueError("Missing country code (e.g. +33)")
        return value                                      # 3. keep the value
```

The decorator tells Pydantic to run `phone` through this function **every time a `ContactInfo` is created**. You never call it yourself. Pydantic does it, including when the object is built from the LLM's answer.

**Step C, what happens.**

```python
contact = model.with_structured_output(ContactInfo).invoke(
    "Extract the contact details: John Doe, john@example.com, +33 6 42 75 98 75"
)
```

```output Result
The model returns   phone = "+33 6 42 75 98 75"
                       |
                       v   normalize_phone() called automatically
Final object        phone = "+33642759875"
```

And if the number has no country code (`06 42 75 98 75`), the object is **not** created.

```output Result
Validation error in ContactInfo
  phone   Missing country code (e.g. +33)
```

### 4. It handles failure cleanly

With `include_raw=True`, an invalid answer does not crash the call. You get the error back and decide what to do.

```python
prompt = "Extract the contact details: John Doe, john@example.com, 06 42 75 98 75"
out = model.with_structured_output(ContactInfo, include_raw=True).invoke(prompt)

if out["parsing_error"]:
    ...  # retry, log, or send the error back to the model
else:
    contact = out["parsed"]
```

### 5. It exports in one line

```python
contact.model_dump_json()
```

```output Result
{"name": "John Doe", "email": "john@example.com", "phone": "+33642759875"}
```

The result is ready to be returned by an API or stored in a database.

## In an agent with `response_format`

The same schema works with a LangChain agent. The agent uses its tools as usual, and its final answer comes back validated.

```python
from langchain.agents import create_agent

agent = create_agent(model=model, response_format=ContactInfo)
result = agent.invoke({
    "messages": "Extract the contact details: John Doe, john@example.com, +33 6 42 75 98 75"
})
result["structured_response"]
```

```output Result
ContactInfo(name="John Doe", email="john@example.com", phone="+33642759875")
```

## Which one should you pick?

| | Pydantic | TypedDict | dataclass |
|---|:---:|:---:|:---:|
| Returns | an object | a dictionary | an object |
| Describe each field to the model | :yes: | :yes: | :no: |
| Check the model's answer | :yes: | :no: | :no: |
| Enforce limits (min, max, format) | :yes: | :no: | :no: |
| Clean values with your own rules | :yes: | :no: | :no: |
| Export to JSON natively | :yes: | :no: | :no: |

Pydantic is my default, because **one schema does three jobs**. It guides the model with descriptions and limits, it checks the answer, and it hands it over as JSON. A TypedDict is fine for a quick prototype, but as soon as an LLM's output feeds real code, I want it checked.

> An LLM is a data source you do not control. Pydantic is the checkpoint at the door.
