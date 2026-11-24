---
title: Structured output avec Pydantic : faire répondre un LLM en objets Python
date: 2026-11-24
excerpt: Un LLM répond en texte libre, votre code attend une donnée. Avec Pydantic et with_structured_output de LangChain, il renvoie un objet typé et validé. Ce que j'ai testé, et pourquoi Pydantic bat TypedDict et dataclass.
tags: [Python, Pydantic, LangChain, LLM]
versions: [pydantic 2.14.4, langchain 1.5.0, langchain-core 1.8.1, langchain-groq 1.2.0, "modèle : openai/gpt-oss-20b via Groq"]
---

Demandez à un LLM « donne-moi les infos du film Inception » et vous obtenez un joli paragraphe en markdown : titre en gras, liste à puces, une phrase d'intro. Parfait pour un humain, inutilisable pour du code. Pour insérer ces infos dans une base, les afficher dans une UI ou les passer à l'étape suivante d'un pipeline, il faut un **objet**, pas un texte.

C'est ce que fait le *structured output* : on impose un **schéma** au modèle, et on récupère une donnée qu'on manipule directement en Python. Voici ce que j'ai testé avec LangChain, et pourquoi j'utilise Pydantic plutôt que les alternatives.

## Étape 1 : décrire la donnée avec Pydantic

On décrit ce qu'on attend comme une classe Pydantic. Chaque champ a un type et une description :

```python
from langchain_groq import ChatGroq
from pydantic import BaseModel, Field

model = ChatGroq(model="openai/gpt-oss-20b")

class Movie(BaseModel):
    """a movie with details"""
    title: str    = Field(description="The title of the movie")
    year: int     = Field(description="the year the movie was released")
    director: str = Field(description="the director of the movie")
    rating: float = Field(description="The movie's rating out of 10")
```

Puis on « branche » le schéma sur le modèle avec `with_structured_output` :

```python
model_with_structure = model.with_structured_output(Movie)
r = model_with_structure.invoke("provide details about the movie Inception")

r        # Movie(title='Inception', year=2010, director='Christopher Nolan', rating=8.8)
r.title  # 'Inception'
r.year   # 2010  -> un vrai int, pas la chaîne "2010"
```

Sans le schéma, `model.invoke(...)` renvoyait un long texte markdown dans `.content`. Avec, il n'y a plus de `.content` : on récupère directement un objet `Movie`, avec l'autocomplétion de l'éditeur en prime.

## Ce qui se passe sous le capot

Pour comprendre le mécanisme, `include_raw=True` renvoie aussi la réponse brute du modèle :

```python
model.with_structured_output(Movie, include_raw=True).invoke(
    "provide details about the movie Inception"
)
# {'raw':    AIMessage(content='', tool_calls=[{'name': 'Movie', 'args': {...}}]),
#  'parsed': Movie(title='Inception', year=2010, ...),
#  'parsing_error': None}
```

Le message brut n'a **pas de texte** : il contient un appel d'outil nommé `Movie`. LangChain a transformé la classe en **définition d'outil** (un JSON Schema), et le modèle « appelle » cet outil avec les champs comme arguments. Pydantic parse ensuite ces arguments pour construire l'objet.

On peut voir exactement ce qui est envoyé au modèle :

```python
from langchain_core.utils.function_calling import convert_to_openai_tool
convert_to_openai_tool(Movie)
```

```json
{
  "type": "function",
  "function": {
    "name": "Movie",
    "description": "a movie with details",
    "parameters": {
      "properties": {
        "title": {"description": "The title of the movie", "type": "string"},
        "year":  {"description": "the year the movie was released", "type": "integer"}
      },
      "required": ["title", "year"],
      "type": "object"
    }
  }
}
```

Deux conséquences pratiques :

- **La docstring et les `description` font partie du prompt.** Le modèle les lit. Une description précise (« en millions de dollars », « note sur 10 ») change réellement la réponse.
- Le nom de la classe devient le nom de l'outil : autant qu'il soit explicite.

## Des structures imbriquées

Un schéma peut contenir d'autres schémas, des listes et des champs optionnels :

```python
class Actor(BaseModel):
    name: str
    role: str

class MovieDetails(BaseModel):
    title: str
    year: int
    cast: list[Actor]          # une liste d'objets
    genres: list[str]
    budget: float | None = Field(None, description="Budget in million USD")  # optionnel

model.with_structured_output(MovieDetails).invoke("provide details about the movie Inception")
# MovieDetails(title='Inception', year=2010,
#   cast=[Actor(name='Leonardo DiCaprio', role='Dom Cobb'),
#         Actor(name='Joseph Gordon-Levitt', role='Arthur'), ...], ...)
```

Chaque acteur est un vrai objet `Actor` : `r.cast[0].name` fonctionne directement.

## Les alternatives : TypedDict et dataclass

LangChain accepte aussi un `TypedDict` ou une `dataclass` comme schéma.

**TypedDict** renvoie un simple dictionnaire. Les descriptions passent par `Annotated` :

```python
from typing_extensions import TypedDict, Annotated

class MovieDict(TypedDict):
    """a movie with details"""
    title: Annotated[str, ..., "The title of the movie"]
    year:  Annotated[int, ..., "the year the movie was released"]
    #               type  requis  description

model.with_structured_output(MovieDict).invoke("provide details about the movie Inception")
# {'title': 'Inception', 'year': 2010, ...}
```

Piège rencontré en testant : j'avais écrit `budget: float | None = Field(None, description="Budget in million USD")` dans un TypedDict. La description a été **ignorée**, et le modèle a renvoyé `160000000` au lieu de `160`. Dans un TypedDict, seule la syntaxe `Annotated[type, ..., "description"]` est prise en compte.

**dataclass** renvoie un objet, mais n'a aucun moyen de décrire les champs (les commentaires Python ne sont pas envoyés au modèle).

Les trois fonctionnent. La différence se joue ailleurs.

## Le vrai super-pouvoir de Pydantic : la validation

Un `TypedDict` n'est qu'une indication de type : Python ne vérifie **rien** à l'exécution.

```python
MovieDict(title="Inception", year="deux mille dix")
# {'title': 'Inception', 'year': 'deux mille dix'}   -> aucune erreur
```

Si le modèle renvoie une valeur farfelue, elle passe silencieusement dans votre code et casse plus loin, au pire endroit. Pydantic, lui, **valide chaque champ** au moment où l'objet est construit.

### 1. Conversion automatique quand c'est sans ambiguïté

```python
Movie.model_validate({"title": "Inception", "year": "2010",
                      "director": "Christopher Nolan", "rating": "8.8"})
# Movie(title='Inception', year=2010, director='Christopher Nolan', rating=8.8)
```

`"2010"` devient `2010`, `"8.8"` devient `8.8`. Pratique avec des LLM qui mettent parfois des guillemets là où il n'en faut pas.

### 2. Contraintes métier dans le schéma

On ajoute des bornes directement dans `Field` :

```python
class Movie(BaseModel):
    """a movie with details"""
    title: str
    year: int
    director: str
    rating: float = Field(ge=0, le=10, description="The movie's rating out of 10")
```

Et une donnée invalide est refusée avec un message précis :

```text
2 validation errors for Movie
year
  Input should be a valid integer, unable to parse string as an integer
  [type=int_parsing, input_value='deux mille dix', input_type=str]
rating
  Input should be less than or equal to 10
  [type=less_than_equal, input_value=88, input_type=int]
```

Bonus : `ge` et `le` apparaissent aussi dans le JSON Schema (`"minimum": 0, "maximum": 10`). Le modèle voit donc la contrainte **avant** de répondre, et Pydantic la vérifie **après**.

### 3. Des règles sur mesure avec `field_validator`

Pour les règles qu'un type ne suffit pas à exprimer, on écrit un validateur. Exemple sur l'extraction de contacts que j'ai testée dans un agent :

```python
from pydantic import BaseModel, Field, field_validator

class ContactInfo(BaseModel):
    """contact information for a person"""
    name: str  = Field(description="the name of the person")
    email: str = Field(pattern=r"^[\w.+-]+@[\w-]+\.[\w.]+$",
                       description="the email address of the person")
    phone: str = Field(description="the phone number, international format")

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        v = v.replace(" ", "").replace(".", "")
        if not v.startswith("+"):
            raise ValueError("phone must start with a country code, e.g. +33")
        return v
```

```python
ContactInfo(name="John Doe", email="John@example.com", phone="+33 6 42 75 98 75")
# ContactInfo(name='John Doe', email='John@example.com', phone='+33642759875')

ContactInfo(name="John Doe", email="john-at-example.com", phone="06 42 75 98 75")
# 2 validation errors for ContactInfo
# email  String should match pattern ...
# phone  Value error, phone must start with a country code, e.g. +33
```

Le validateur fait deux choses à la fois : il **nettoie** (espaces et points retirés) et il **refuse** ce qui ne respecte pas la règle.

### 4. Gérer l'échec proprement

Côté LangChain, avec `include_raw=True`, une réponse qui ne passe pas la validation ne fait pas planter l'appel : `parsed` vaut `None` et l'erreur est dans `parsing_error`. On peut alors relancer, ou renvoyer l'erreur au modèle pour qu'il se corrige :

```python
out = model.with_structured_output(Movie, include_raw=True).invoke(prompt)

if out["parsing_error"]:
    ...  # retry, log, ou renvoyer l'erreur au modèle
else:
    movie = out["parsed"]
```

### 5. Sérialiser en une ligne

L'objet validé se convertit directement pour une API ou une base :

```python
movie.model_dump()       # {'title': 'Inception', 'year': 2010, ...}
movie.model_dump_json()  # '{"title":"Inception","year":2010,...}'
```

## Dans un agent : `response_format`

Le même schéma fonctionne avec un agent LangChain. Il suffit de le passer en `response_format` :

```python
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model

llm = init_chat_model(model="groq:openai/gpt-oss-20b")
agent = create_agent(model=llm, response_format=ContactInfo)

response = agent.invoke({"messages": [{"role": "user",
    "content": "Extract contact info from: John Doe, John@example.com +33 642759875"}]})

response["structured_response"]
# ContactInfo(name='John Doe', email='John@example.com', phone='+33642759875')
```

L'agent peut appeler ses outils comme d'habitude, et sa réponse finale arrive dans `structured_response`, validée par le schéma.

## Lequel choisir ?

| | Pydantic | TypedDict | dataclass |
|---|---|---|---|
| Validation à l'exécution | ✅ | ❌ | ❌ |
| Description des champs | `Field(description=...)` | `Annotated[..., "desc"]` | aucune |
| Contraintes (`ge`, `le`, `pattern`…) | ✅ | ❌ | ❌ |
| Résultat | objet, `r.title` | dict, `r["title"]` | objet, `r.title` |
| Sérialisation JSON | `model_dump_json()` | à la main | à la main |

Mon choix par défaut est **Pydantic** : le même schéma sert à guider le modèle (descriptions et contraintes dans le JSON Schema), à vérifier sa réponse (validation) et à la transmettre (sérialisation). Un TypedDict reste pratique pour un prototype rapide où un dict suffit, mais dès que la sortie d'un LLM alimente du code, je veux qu'elle soit vérifiée.

> Un LLM est une source de données non fiable. Pydantic, c'est le contrôle à la frontière.
