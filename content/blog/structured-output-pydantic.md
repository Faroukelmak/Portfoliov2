---
title: Faire répondre un LLM en objets Python avec Pydantic
date: 2026-11-24
excerpt: Un LLM répond en texte libre alors que votre code attend une donnée. Avec Pydantic et with_structured_output de LangChain, il renvoie un objet typé et validé.
tags: [Python, Pydantic, LangChain, LLM]
versions: [pydantic 2.14.4, langchain 1.5.0, langchain-core 1.8.1, langchain-groq 1.2.0]
model: openai/gpt-oss-20b via Groq
---

Demandez à un LLM les infos d'un film et vous obtenez un joli paragraphe. Parfait pour un humain, inutilisable pour du code. Pour enregistrer ces infos en base, les afficher dans une interface ou les passer à l'étape suivante d'un pipeline, il faut une **donnée structurée**, pas un texte.

C'est le rôle du *structured output*. On impose un **schéma** au modèle et on récupère un objet Python prêt à l'emploi.

## Le problème du texte libre

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

Pour récupérer l'année, il faudrait chercher « 2010 » dans le texte avec une regex. Et la phrase ne sera jamais formulée deux fois de la même façon.

## Étape 1. Décrire la donnée avec Pydantic

On écrit une classe qui décrit **exactement** ce qu'on attend. Chaque champ a un type et une description.

```python
from pydantic import BaseModel, Field

class Movie(BaseModel):
    """A movie with its details."""
    title: str    = Field(description="The title of the movie")
    year: int     = Field(description="The year the movie was released")
    director: str = Field(description="The director of the movie")
    rating: float = Field(description="The rating of the movie, out of 10")
```

## Étape 2. Brancher le schéma sur le modèle

```python
structured_model = model.with_structured_output(Movie)
movie = structured_model.invoke("Give me the details of the movie Inception.")
print(movie)
```

```output
Movie(
    title    = "Inception",
    year     = 2010,
    director = "Christopher Nolan",
    rating   = 8.8
)
```

Ce n'est plus du texte, c'est un objet `Movie`. On accède directement aux champs, avec les bons types.

```python
movie.title     # "Inception"
movie.year + 1  # 2011  -> year est un vrai entier
```

## Comment ça marche ?

LangChain transforme la classe `Movie` en **outil** que le modèle doit remplir. Concrètement, le modèle reçoit quelque chose qui ressemble à ceci.

```output Ce que le modèle reçoit
Outil "Movie"   A movie with its details.
  title     texte    The title of the movie
  year      entier   The year the movie was released
  director  texte    The director of the movie
  rating    nombre   The rating of the movie, out of 10
```

Le modèle renvoie une valeur pour chaque champ, puis Pydantic construit l'objet `Movie`.

À retenir, **la docstring et les descriptions font partie du prompt**. Le modèle les lit. Par exemple, la description de `rating` précise `out of 10`. Sans elle, le modèle pourrait renvoyer une note sur 5 ou sur 100.

## Des objets dans des objets

Un film a plusieurs acteurs, et chaque acteur a un nom et un rôle. Plutôt que de tout mettre à plat, on décrit **un acteur** une seule fois, puis on indique que le film contient une **liste** d'acteurs.

```python
class Actor(BaseModel):
    name: str = Field(description="The name of the actor")
    role: str = Field(description="The character played by the actor")

class MovieDetails(BaseModel):
    """A movie with its cast."""
    title: str
    year: int
    genres: list[str]   # une liste de textes
    cast: list[Actor]   # une liste d'acteurs

details = model.with_structured_output(MovieDetails).invoke(
    "Give me the details of the movie Inception."
)
```

```output
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

Chaque acteur est lui-même un objet, et on navigue dedans naturellement.

```python
details.cast[0].name  # "Leonardo DiCaprio"
len(details.cast)     # 3
```

## Les alternatives TypedDict et dataclass

LangChain accepte aussi deux autres façons de décrire le schéma.

### Avec un TypedDict

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

```output
{"title": "Inception", "year": 2010}
```

On récupère un **dictionnaire**, donc `movie["title"]` au lieu de `movie.title`.

### Avec une dataclass

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

```output
MovieData(title="Inception", year=2010)
```

On récupère un **objet**, mais il n'existe aucun moyen de décrire les champs au modèle. Il ne voit que leurs noms et leurs types.

### La différence avec Pydantic

Les trois donnent une donnée structurée. Mais un TypedDict et une dataclass ne sont que des **étiquettes**, et Python ne vérifie rien quand la donnée arrive.

```python
MovieDict(title="Inception", year="deux mille dix")
```

```output
{"title": "Inception", "year": "deux mille dix"}    <- accepté sans erreur
```

Si le modèle renvoie une valeur farfelue, elle entre silencieusement dans votre code et casse plus loin. Pydantic, lui, **contrôle chaque champ** à l'arrivée. C'est tout l'intérêt.

## Le vrai atout de Pydantic, la validation

### 1. Il convertit quand c'est évident

Les LLM mettent parfois des guillemets en trop. Pydantic corrige ce qui est sans ambiguïté.

```python
Movie.model_validate({
    "title": "Inception",
    "year": "2010",      # texte
    "director": "Christopher Nolan",
    "rating": "8.8",     # texte
})
```

```output
Movie(title="Inception", year=2010, director="Christopher Nolan", rating=8.8)
                              ^ entier                             ^ nombre
```

### 2. Il refuse ce qui est hors limites

On ajoute des bornes directement dans le champ. Ici, une note doit être comprise entre 0 et 10.

```python
class Movie(BaseModel):
    """A movie with its details."""
    title: str
    year: int
    # ge = supérieur ou égal, le = inférieur ou égal
    rating: float = Field(ge=0, le=10, description="Rating out of 10")
```

Si le modèle renvoie une note de 88, l'objet est refusé.

```output
Erreur de validation sur Movie
  rating   doit être inférieur ou égal à 10 (reçu 88)
```

Ces bornes sont aussi envoyées au modèle dans la description de l'outil. Il connaît la règle **avant** de répondre, et Pydantic la vérifie **après**.

### 3. Il applique vos propres règles avec `field_validator`

**Le besoin.** On extrait des contacts, et le modèle peut écrire un même numéro de plusieurs façons, comme `+33 6 42 75 98 75` ou `+33.6.42.75.98.75`. On veut toujours le même format (`+33642759875`) et refuser un numéro sans indicatif pays.

**Étape A, le schéma**, comme d'habitude.

```python
from pydantic import BaseModel, Field, field_validator

class ContactInfo(BaseModel):
    """Contact information for a person."""
    name: str  = Field(description="The full name of the person")
    email: str = Field(description="The email address of the person")
    phone: str = Field(description="The phone number, in international format")
```

**Étape B, la règle.** On ajoute une méthode **dans la même classe**, précédée du décorateur `@field_validator("phone")`.

```python
class ContactInfo(BaseModel):
    """Contact information for a person."""
    name: str  = Field(description="The full name of the person")
    email: str = Field(description="The email address of the person")
    phone: str = Field(description="The phone number, in international format")

    @field_validator("phone")          # la règle s'applique au champ phone
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        value = value.replace(" ", "").replace(".", "")   # 1. nettoie
        if not value.startswith("+"):                     # 2. vérifie
            raise ValueError("Missing country code (e.g. +33)")
        return value                                      # 3. valeur gardée
```

Le décorateur demande à Pydantic de passer `phone` dans cette fonction **chaque fois qu'un `ContactInfo` est créé**. On ne l'appelle jamais soi-même. Pydantic s'en charge, y compris quand l'objet est construit à partir de la réponse du LLM.

**Étape C, ce qui se passe.**

```python
contact = model.with_structured_output(ContactInfo).invoke(
    "Extract the contact details: John Doe, john@example.com, +33 6 42 75 98 75"
)
```

```output
Le modèle renvoie   phone = "+33 6 42 75 98 75"
                       |
                       v   normalize_phone() appelée automatiquement
Objet final         phone = "+33642759875"
```

Et si le numéro n'a pas d'indicatif (`06 42 75 98 75`), l'objet n'est **pas** créé.

```output
Erreur de validation sur ContactInfo
  phone   Missing country code (e.g. +33)
```

### 4. Il gère l'échec proprement

Avec `include_raw=True`, une réponse invalide ne fait pas planter l'appel. On récupère l'erreur et on décide quoi faire.

```python
prompt = "Extract the contact details: John Doe, john@example.com, 06 42 75 98 75"
out = model.with_structured_output(ContactInfo, include_raw=True).invoke(prompt)

if out["parsing_error"]:
    ...  # relancer, logger, ou renvoyer l'erreur au modèle
else:
    contact = out["parsed"]
```

### 5. Il exporte en une ligne

```python
contact.model_dump_json()
```

```output
{"name": "John Doe", "email": "john@example.com", "phone": "+33642759875"}
```

Le résultat est prêt à être renvoyé par une API ou enregistré en base.

## Dans un agent avec `response_format`

Le même schéma fonctionne avec un agent LangChain. L'agent utilise ses outils comme d'habitude, et sa réponse finale arrive validée.

```python
from langchain.agents import create_agent

agent = create_agent(model=model, response_format=ContactInfo)
result = agent.invoke({
    "messages": "Extract the contact details: John Doe, john@example.com, +33 6 42 75 98 75"
})
result["structured_response"]
```

```output
ContactInfo(name="John Doe", email="john@example.com", phone="+33642759875")
```

## Lequel choisir ?

| | Pydantic | TypedDict | dataclass |
|---|:---:|:---:|:---:|
| Renvoie | un objet | un dictionnaire | un objet |
| Décrire chaque champ au modèle | :yes: | :yes: | :no: |
| Vérifier la réponse du modèle | :yes: | :no: | :no: |
| Imposer des limites (min, max, format) | :yes: | :no: | :no: |
| Nettoyer les valeurs avec ses propres règles | :yes: | :no: | :no: |
| Exporter en JSON nativement | :yes: | :no: | :no: |

Pydantic est mon choix par défaut, parce qu'**un seul schéma fait trois choses**. Il guide le modèle avec les descriptions et les limites, il vérifie sa réponse et il la transmet en JSON. Un TypedDict suffit pour un prototype rapide, mais dès que la sortie d'un LLM alimente du vrai code, je veux qu'elle soit contrôlée.

> Un LLM est une source de données qu'on ne contrôle pas. Pydantic, c'est le contrôle à l'entrée.
