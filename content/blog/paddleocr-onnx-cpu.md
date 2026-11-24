---
title: PaddleOCR en production sur CPU, pourquoi je suis passé par ONNX Runtime
date: 2026-11-24
excerpt: Pas de GPU, des lots de 200+ PDF à contrôler et un PaddlePaddle qui plante au démarrage. Retour sur un choix d'architecture simple qui a débloqué tout le pipeline.
tags: [OCR, ONNX, Production]
---

Chez Docaposte, j'ai construit une plateforme qui compare des lots de PDF de production **avant et après traitement**. Un tampon ajouté, une conversion de format, et parfois un mot qui disparaît ou un caractère qui se corrompt. Le contrôle se faisait à l'œil, sur une dizaine de paires. Il fallait passer à **200+ PDF par lot**, automatiquement.

Une partie de ces documents sont des scans. Il faut donc de l'OCR, et c'est là que les ennuis ont commencé.

## Un contexte CPU uniquement

La plateforme tourne sur des postes et des serveurs **sans GPU**. Pas de CUDA, pas de cluster. L'OCR doit tenir sur CPU, dans un temps raisonnable, avec des dépendances que l'équipe peut installer sans y passer la journée.

Sur le papier, PaddleOCR coche beaucoup de cases, avec de bons modèles de détection et de reconnaissance, légers et multilingues. Sauf qu'en pratique, le framework natif **PaddlePaddle plantait sur notre combinaison Windows + CPU + Python 3.13**. Pas une erreur explicite qu'on corrige en dix minutes, mais un crash au chargement.

## Garder les modèles, changer le moteur

Les modèles PaddleOCR existent en version **ONNX**. L'idée est donc simple.

- Garder les poids et le découpage détection → reconnaissance de PaddleOCR.
- Remplacer le moteur d'inférence PaddlePaddle par **ONNX Runtime**, qui s'installe avec un simple `pip install onnxruntime` et tourne partout.

On perd un peu de confort, puisque le pré et post-traitement sont à écrire soi-même. Mais on gagne exactement ce qui comptait ici, **un runtime stable, portable et léger**.

## Ne lancer l'OCR que quand c'est nécessaire

Le deuxième gain ne vient pas d'ONNX, mais du routage. La majorité des pages ont déjà une couche texte native. Les passer à l'OCR serait lent et *moins* fiable que de lire le texte directement.

Le pipeline choisit donc une stratégie **par page**.

1. **Texte natif.** Extraction directe avec PyMuPDF, rapide et exacte.
2. **Scan.** Rendu de la page en image, puis OCR via ONNX Runtime.
3. **Mixte.** Les deux, puis fusion.

Au final, environ **3 secondes par PDF** en moyenne sur CPU, ce qui rend un lot complet contrôlable sans surveiller la barre de progression.

## Ce que j'en retiens

> Le bon modèle ne sert à rien si le runtime ne tient pas dans l'environnement cible.

Avant de comparer des scores de précision, je vérifie maintenant trois choses. Sur quel matériel le modèle va tourner, qui va l'installer, et s'il existe un export (ONNX, en général) qui découple le modèle de son framework d'origine. Dans ce projet, c'est cette question qui a débloqué tout le reste.
