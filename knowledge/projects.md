---
title: Projects
url: /projects
tags: [projects, software, ai, rag, web, research]
---

# Projects

## CS6101 AI Research Retrieval Augmented Speculative Decoding Benchmark Tool
*Jun 2025 - Nov 2025*

Contributed to a modular Retrieval Augmented Speculative Decoding (RASD) framework by translating the RAPID [CFN25] research paper into a production-ready pipeline compatible with Hugging Face Transformers.

**Key contributions:**
- Refactored the prefill forward pass to exclude the output MLP, reducing VRAM usage by approximately 33% compared to baseline.
- Developed the `RASDBenchmark` class to abstract evaluation complexity and support plug-and-play analysis of throughput and generation quality on custom datasets.

**Tech stack:** Python, Hugging Face Transformers, RAG, LLM inference optimization

---

## NUS HealthHack 2025
*Jan 2025 - Feb 2025*

Built a healthcare AI prototype that combines conversational AI and retrieval for realistic patient simulation.

**Key contributions:**
- Deployed Gemini 2.0 Flash to simulate patient interactions across different medical conditions.
- Integrated Health Hub data via function calling to improve factual grounding and medical terminology accuracy.
- Engineered a RAG pipeline with InterSystems IRIS Vector Search and Vector Store to retrieve patient backstories from a custom dataset.

**Tech stack:** Gemini API, InterSystems IRIS, RAG, vector search, function calling


