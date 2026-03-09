---
title: Projects
url: /projects
tags: [projects, software, ai, rag, web, research]
---

# Projects

## Browser-based Hybrid Retrieval for Personal Blog 
*Mar 2026 - present*

This very website features a browser-based hybrid retrieval chat system enabling interactive Q&A over a curated these pages.

**Key features:**
- Fully client-side hybrid retrieval architecture with no backend dependencies hosted on GitHub Pages.
- Custom BM25+ implementation for sparse retrieval and quantized BGE embeddings for dense retrieval, fused with Reciprocal Rank Fusion (RRF).

**Tech stack:** Transformers.js, JavaScript, HTML, CSS

## CS6101 AI Research Retrieval Augmented Speculative Decoding Benchmark Tool
*Jun 2025 - Nov 2025*

[CS6101](https://wing-nus.github.io/cs6101/details/) is a lab-rotation-style reading group to present and discuss research in Information Retrieval and Retrieval-Augmented Generation (RAG). The program culminated in the development of a benchmarking tool for evaluating Retrieval-Augmented Speculative Decoding (RASD) methods, presented at the NUS School of Computing Term Project Showcase (STePS).


**Key features:**
- Contributed to a modular Retrieval Augmented Speculative Decoding (RASD) framework by translating the RAPID [[CFN25](https://arxiv.org/abs/2502.20330)] research paper into a production-ready pipeline compatible with Hugging Face Transformers
- Developed the `RASDBenchmark` class to abstract evaluation complexity and support plug-and-play analysis of throughput and generation quality on custom datasets.

**Tech stack:** Python, Hugging Face Transformers, RAG, LLM inference optimization
