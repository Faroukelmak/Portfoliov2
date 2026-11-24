---
title: PaddleOCR in production on CPU, and why I went through ONNX Runtime
date: 2026-11-24
excerpt: No GPU, batches of 200+ PDFs to check and a PaddlePaddle that crashes on startup. A simple architecture choice that unblocked the whole pipeline.
tags: [OCR, ONNX, Production]
---

At Docaposte, I built a platform that compares batches of production PDFs **before and after processing**. A stamp gets added, a format gets converted, and sometimes a word disappears or a character gets corrupted. The check used to be done by eye, on about ten pairs. We needed to handle **200+ PDFs per batch**, automatically.

Some of these documents are scans. So we needed OCR, and that is where the trouble started.

## A CPU-only setup

The platform runs on workstations and servers **without a GPU**. No CUDA, no cluster. OCR has to run on CPU, in reasonable time, with dependencies the team can install without losing a day.

On paper, PaddleOCR ticks a lot of boxes, with good, lightweight, multilingual detection and recognition models. In practice, though, the native **PaddlePaddle framework crashed on our Windows + CPU + Python 3.13 setup**. Not an explicit error you fix in ten minutes, but a crash at load time.

## Keep the models, swap the engine

PaddleOCR models are available in **ONNX** format. So the idea is simple.

- Keep PaddleOCR's weights and its detection → recognition split.
- Replace the PaddlePaddle inference engine with **ONNX Runtime**, which installs with a plain `pip install onnxruntime` and runs everywhere.

You lose a bit of comfort, since pre- and post-processing are yours to write. But you gain exactly what mattered here, **a stable, portable and lightweight runtime**.

## Only run OCR when it is needed

The second win does not come from ONNX, it comes from routing. Most pages already have a native text layer. Sending them through OCR would be slow and *less* reliable than reading the text directly.

So the pipeline picks a strategy **per page**.

1. **Native text.** Direct extraction with PyMuPDF, fast and exact.
2. **Scan.** Render the page as an image, then OCR through ONNX Runtime.
3. **Mixed.** Both, then merge.

In the end, about **3 seconds per PDF** on average on CPU, which makes a full batch checkable without staring at the progress bar.

## What I take away from it

> The right model is useless if the runtime does not fit the target environment.

Before comparing accuracy scores, I now check three things. What hardware the model will run on, who will install it, and whether there is an export (usually ONNX) that decouples the model from its original framework. In this project, that question is what unblocked everything else.
